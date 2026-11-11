-- Spellbranch 016: collection row cap, atomic printing merges, grant hygiene.
--
-- Apply after 001-015, in order. 011 is reserved and is not used. This file
-- does not edit earlier migrations. It is its own transaction (BEGIN/COMMIT)
-- and is safe to re-run.
--
-- Do not apply this from the app deploy or from CI. Run it by hand in the
-- Supabase SQL editor after 001-015.
--
-- 1. collection_cards_limit: at most 5000 rows per user (COLLECTION_MAX_ROWS
--    in src/lib/collection.ts). Modeled on deck_categories_limit (013).
--    auth.uid() null (migrations, seed, table owner) is not capped. A
--    signed-in insert locks the owner's profile row first so two sessions
--    cannot both count 4999 and both insert. Existing rows above the cap
--    are left in place; only a new insert is refused.
-- 2. merge_deck_card_printing / merge_collection_card_printing: the printing
--    change that used to update one row and delete another in two PostgREST
--    calls now does both in one function. Security invoker, so RLS still
--    applies. The quantity is recomputed from the locked rows (least 99 for
--    a deck, least 9999 for a collection).
-- 3. Grant hygiene: comments have no UPDATE policy, so UPDATE is revoked
--    from authenticated. friendships and favorite_cards have no anon SELECT
--    policy, so anon SELECT is revoked. Grants a real policy uses stay.

begin;

-- ---------------------------------------------------------------------------
-- 1. Per-user collection row cap.
-- ---------------------------------------------------------------------------

create or replace function public.collection_cards_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  -- auth.uid() is null for the table owner (migrations and seed).
  if auth.uid() is null then
    return new;
  end if;
  -- Lock the owner's profile so two sessions cannot both pass the count.
  -- A non-owner finds no row (RLS) and the insert's own policy refuses them.
  perform 1
  from public.profiles p
  where p.id = new.user_id
    and p.id = auth.uid()
  for update;
  if not found then
    return new;
  end if;
  select count(*) into n
  from public.collection_cards c
  where c.user_id = new.user_id;
  if n >= 5000 then
    raise exception 'Your collection already has 5000 cards'
      using errcode = '23514', hint = 'spellbranch_collection_cap';
  end if;
  return new;
end;
$$;

drop trigger if exists collection_cards_limit on public.collection_cards;
create trigger collection_cards_limit
  before insert on public.collection_cards
  for each row execute function public.collection_cards_limit();

revoke execute on function public.collection_cards_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Atomic printing merges.
-- ---------------------------------------------------------------------------

create or replace function public.merge_deck_card_printing(target uuid, source uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  first_id uuid;
  second_id uuid;
  deck uuid;
  target_board text;
  target_qty integer;
  source_deck uuid;
  source_board text;
  source_qty integer;
begin
  if caller is null or target is null or source is null or target = source then
    raise exception 'Card not found in deck' using errcode = 'P0002';
  end if;

  -- Lock in id order so two overlapping merges cannot deadlock.
  if target < source then
    first_id := target;
    second_id := source;
  else
    first_id := source;
    second_id := target;
  end if;
  perform 1 from public.deck_cards c where c.id = first_id for update;
  perform 1 from public.deck_cards c where c.id = second_id for update;

  select c.deck_id, c.board, c.quantity
    into deck, target_board, target_qty
  from public.deck_cards c
  where c.id = target;
  if not found then
    raise exception 'Card not found in deck' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.decks d
    where d.id = deck
      and d.owner_id = caller
  ) then
    raise exception 'You cannot edit this deck' using errcode = '42501';
  end if;

  select c.deck_id, c.board, c.quantity
    into source_deck, source_board, source_qty
  from public.deck_cards c
  where c.id = source;
  if not found
     or source_deck is distinct from deck
     or source_board is distinct from target_board then
    raise exception 'Card not found in deck' using errcode = 'P0002';
  end if;

  update public.deck_cards
  set quantity = least(99, target_qty + source_qty)
  where id = target
    and deck_id = deck;

  delete from public.deck_cards
  where id = source
    and deck_id = deck;
end;
$$;

revoke all on function public.merge_deck_card_printing(uuid, uuid) from public, anon;
grant execute on function public.merge_deck_card_printing(uuid, uuid) to authenticated;

create or replace function public.merge_collection_card_printing(target uuid, source uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  first_id uuid;
  second_id uuid;
  target_qty integer;
  target_trade boolean;
  target_condition text;
  source_qty integer;
  source_trade boolean;
  source_condition text;
begin
  if caller is null or target is null or source is null or target = source then
    raise exception 'Card not found in your collection' using errcode = 'P0002';
  end if;

  if target < source then
    first_id := target;
    second_id := source;
  else
    first_id := source;
    second_id := target;
  end if;
  perform 1
  from public.collection_cards c
  where c.id = first_id
    and c.user_id = caller
  for update;
  perform 1
  from public.collection_cards c
  where c.id = second_id
    and c.user_id = caller
  for update;

  select c.quantity, c.for_trade, c.condition
    into target_qty, target_trade, target_condition
  from public.collection_cards c
  where c.id = target
    and c.user_id = caller;
  if not found then
    raise exception 'Card not found in your collection' using errcode = 'P0002';
  end if;

  select c.quantity, c.for_trade, c.condition
    into source_qty, source_trade, source_condition
  from public.collection_cards c
  where c.id = source
    and c.user_id = caller;
  if not found then
    raise exception 'Card not found in your collection' using errcode = 'P0002';
  end if;

  update public.collection_cards
  set quantity = least(9999, target_qty + source_qty),
      for_trade = target_trade or source_trade,
      condition = coalesce(target_condition, source_condition)
  where id = target
    and user_id = caller;

  delete from public.collection_cards
  where id = source
    and user_id = caller;
end;
$$;

revoke all on function public.merge_collection_card_printing(uuid, uuid) from public, anon;
grant execute on function public.merge_collection_card_printing(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Fail-closed grants that no policy uses.
-- ---------------------------------------------------------------------------

revoke update on table public.comments from public, authenticated;
revoke select on table public.friendships from public, anon;
revoke select on table public.favorite_cards from public, anon;

commit;
