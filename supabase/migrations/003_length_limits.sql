-- Spellbranch 003: database length limits + atomic friend-request restart.
--
-- Cipher reviews: PR #2 N1 (bio), PR #3 L2 (deck and card text), L3 (never
-- abort on existing data), I1 (atomic "decliner starts over").
--
-- A signed-in user can PATCH their own rows through the API directly (RLS
-- allows it), so the app's limits (src/lib/data/limits.ts, used by the zod
-- schemas in src/lib/actions/schemas.ts) are enforced here too. Keep the two
-- in sync.
--
-- Safe to re-run: step 1 only touches rows that are over a limit, and each
-- constraint is dropped (if it exists) and added again.

-- 1. Bring existing over-limit values within the limits first (L3), so the
--    constraints below can't fail on existing data.
update public.profiles set bio = left(bio, 280) where char_length(bio) > 280;

update public.decks set name = left(name, 80) where char_length(name) > 80;
update public.decks set name = 'Untitled deck' where char_length(name) = 0;
update public.decks set notes = left(notes, 2000) where char_length(notes) > 2000;

-- An over-long scryfall_id isn't a real card id. Replace it with a value that
-- is unique per original (unique (deck_id, scryfall_id) / (user_id, scryfall_id)).
update public.deck_cards set scryfall_id = 'invalid-' || md5(scryfall_id)
  where char_length(scryfall_id) > 64;
update public.deck_cards set card_name = left(card_name, 200) where char_length(card_name) > 200;
update public.deck_cards set type_line = left(type_line, 200) where char_length(type_line) > 200;
update public.deck_cards set mana_cost = left(mana_cost, 100) where char_length(mana_cost) > 100;
update public.deck_cards set oracle_text = left(oracle_text, 4000) where char_length(oracle_text) > 4000;
-- A cut-off URL is useless: drop it (the UI shows a placeholder).
update public.deck_cards set image_uri = null where char_length(image_uri) > 512;
-- Keep only W/U/B/R/G, once each, in WUBRG order.
update public.deck_cards
  set colors = array(
    select c from unnest(array['W','U','B','R','G']) with ordinality as t(c, n)
    where c = any(colors) order by n)
  where not (colors <@ array['W','U','B','R','G']::text[]) or cardinality(colors) > 5;

update public.favorite_cards set scryfall_id = 'invalid-' || md5(scryfall_id)
  where char_length(scryfall_id) > 64;
update public.favorite_cards set card_name = left(card_name, 200) where char_length(card_name) > 200;
update public.favorite_cards set type_line = left(type_line, 200) where char_length(type_line) > 200;
update public.favorite_cards set mana_cost = left(mana_cost, 100) where char_length(mana_cost) > 100;
update public.favorite_cards set image_uri = null where char_length(image_uri) > 512;

-- 2. The constraints. char_length counts characters, not bytes.
alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length check (char_length(bio) <= 280);

alter table public.decks drop constraint if exists decks_name_length;
alter table public.decks
  add constraint decks_name_length check (char_length(name) between 1 and 80);
alter table public.decks drop constraint if exists decks_notes_length;
alter table public.decks
  add constraint decks_notes_length check (char_length(notes) <= 2000);

alter table public.deck_cards drop constraint if exists deck_cards_text_lengths;
alter table public.deck_cards
  add constraint deck_cards_text_lengths check (
    char_length(scryfall_id) <= 64
    and char_length(card_name) <= 200
    and char_length(type_line) <= 200
    and (mana_cost is null or char_length(mana_cost) <= 100)
    and (oracle_text is null or char_length(oracle_text) <= 4000)
    and (image_uri is null or char_length(image_uri) <= 512)
  );
alter table public.deck_cards drop constraint if exists deck_cards_colors_valid;
alter table public.deck_cards
  add constraint deck_cards_colors_valid check (
    colors <@ array['W','U','B','R','G']::text[] and cardinality(colors) <= 5
  );

alter table public.favorite_cards drop constraint if exists favorite_cards_text_lengths;
alter table public.favorite_cards
  add constraint favorite_cards_text_lengths check (
    char_length(scryfall_id) <= 64
    and char_length(card_name) <= 200
    and (type_line is null or char_length(type_line) <= 200)
    and (mana_cost is null or char_length(mana_cost) <= 100)
    and (image_uri is null or char_length(image_uri) <= 512)
  );

-- 3. restart_friend_request(other): the caller declined `other`'s request
--    and now asks `other` themselves. Deletes the declined row and inserts
--    the caller's pending request in one transaction (review I1), so the
--    declined requester can't slip their own request into a gap.
--    SECURITY INVOKER: the caller's RLS applies to both statements (the
--    addressee may delete any of their rows; inserts must be pending and
--    come from the caller). Raises P0002 if there is no such declined row.
create or replace function public.restart_friend_request(other uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  delete from public.friendships
   where requester_id = other
     and addressee_id = me
     and status = 'declined';
  if not found then
    raise exception 'no declined request from this user' using errcode = 'P0002';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (me, other, 'pending')
  returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.restart_friend_request(uuid) from public, anon;
grant execute on function public.restart_friend_request(uuid) to authenticated;
