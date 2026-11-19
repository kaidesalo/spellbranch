-- Spellbranch 018: official Commander precons.
--
-- Apply after 001-017, in the SQL editor, as the database owner. Do not
-- apply it from the app deploy and do not run it as anon or authenticated.
-- Run supabase/checks/precon_preflight.sql first (read-only), then this file,
-- then supabase/seed/precons.sql. 011 is reserved.
--
-- A precon is a public, forkable Commander deck with no owner. decks.owner_id
-- references profiles, and profiles.id references auth.users, so a system
-- account would mean inserting an auth.users row. This migration leaves
-- owner_id nullable instead. is_precon marks the row. The seed inserts those
-- rows as the table owner, which bypasses RLS. No client role can insert,
-- update, or delete them.
--
-- Normal decks are unchanged: is_precon defaults to false, and the owner
-- policies still require auth.uid() = owner_id. The extra "is_precon = false"
-- checks refuse a client flip of the flag. They do not grant any new write.
--
-- Every deck may have a front-face legendary creature, planeswalker, or
-- spacecraft commander. The app uses the same rule
-- (src/lib/commander-legality.ts). Partners and backgrounds stay out.
--
-- fork_deck() and copy_deck() are 014's functions. The new column is selected
-- into the deck row type and is not copied: the new row uses the column
-- default, so a copy or branch is the caller's deck. Re-run 018 after any
-- re-run of 014, or those functions will not know about is_precon.

begin;

alter table public.decks
  alter column owner_id drop not null;

alter table public.decks
  add column if not exists is_precon boolean not null default false;

alter table public.decks drop constraint if exists decks_precon_official;
alter table public.decks
  add constraint decks_precon_official check (
    (
      is_precon = false
      and owner_id is not null
    )
    or (
      is_precon = true
      and owner_id is null
      and visibility = 'public'
      and allow_forks
      and forked_from_id is null
      and copied_from_id is null
      and format = 'commander'
    )
  );

comment on column public.decks.is_precon is
  'Official Commander precon. Public, unowned, and not writable by a client role.';

-- Readable wherever the deck is readable. anon and authenticated already
-- have column SELECT on decks (010); a new column stays hidden until granted.
grant select (is_precon) on table public.decks to anon, authenticated;

alter table public.decks drop constraint if exists decks_commander_legendary_creature;
alter table public.decks
  add constraint decks_commander_legendary_creature check (
    commander_type_line is null
    or (
      split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\s)Legendary(\s|$)'
      and (
        split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\s)Creature(\s|$)'
        or split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\s)Planeswalker(\s|$)'
        or (
          split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\s)Artifact(\s|$)'
          and split_part(split_part(commander_type_line, '//', 1), '—', 2) ~ '(^|\s)Spacecraft(\s|$)'
        )
      )
    )
  );

drop policy if exists "Owners insert decks" on public.decks;
create policy "Owners insert decks"
  on public.decks for insert
  to authenticated
  with check (auth.uid() = owner_id and is_precon = false);

drop policy if exists "Owners update decks" on public.decks;
create policy "Owners update decks"
  on public.decks for update
  to authenticated
  using (auth.uid() = owner_id and not is_precon)
  with check (auth.uid() = owner_id and is_precon = false);

drop policy if exists "Owners delete decks" on public.decks;
create policy "Owners delete decks"
  on public.decks for delete
  to authenticated
  using (auth.uid() = owner_id and not is_precon);

-- 014's functions, plus is_precon on the row type. The inserted row omits
-- is_precon, so it stays false.
create or replace function public.fork_deck(source uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  new_id uuid;
  branch_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  perform public.lock_visible_deck(source);

  select
    d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
    d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
    d.commander_scryfall_id, d.commander_name, d.commander_type_line,
    d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
    d.commander_color_identity, d.colors,
    null::uuid,
    d.is_precon
  into src
  from public.decks d
  where d.id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  branch_name := src.name || ' (branch)';
  if char_length(branch_name) > 80 then
    branch_name := left(src.name, 80 - char_length(' (branch)')) || ' (branch)';
  end if;

  insert into public.decks (
    owner_id, name, format, notes, visibility, allow_forks, forked_from_id,
    commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,
    commander_image_uri, commander_art_uri, commander_color_identity, colors
  )
  values (
    auth.uid(),
    branch_name,
    src.format,
    src.notes,
    case when src.visibility = 'public' then 'friends' else 'private' end,
    src.visibility = 'public',
    src.id,
    src.commander_scryfall_id,
    src.commander_name,
    src.commander_type_line,
    src.commander_mana_cost,
    src.commander_image_uri,
    src.commander_art_uri,
    src.commander_color_identity,
    src.colors
  )
  returning id into new_id;

  insert into public.deck_categories (deck_id, name, position)
  select new_id, c.name, c.position
  from public.deck_categories c
  where c.deck_id = src.id;

  insert into public.deck_type_orders (deck_id, type_key, position)
  select new_id, t.type_key, t.position
  from public.deck_type_orders t
  where t.deck_id = src.id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity, category_id, board)
  select new_id, cards.scryfall_id, cards.card_name, cards.image_uri, cards.mana_cost,
         cards.type_line, cards.colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         cards.oracle_text, cards.quantity,
         newc.id,
         cards.board
  from public.deck_cards cards
  left join public.deck_categories oldc
    on oldc.id = cards.category_id
   and oldc.deck_id = src.id
  left join public.deck_categories newc
    on newc.deck_id = new_id
   and newc.name = oldc.name
  where cards.deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.fork_deck(uuid) from public, anon;
grant execute on function public.fork_deck(uuid) to authenticated;

create or replace function public.copy_deck(source uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  new_id uuid;
  copy_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  perform public.lock_visible_deck(source);

  select
    d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
    d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
    d.commander_scryfall_id, d.commander_name, d.commander_type_line,
    d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
    d.commander_color_identity, d.colors,
    null::uuid,
    d.is_precon
  into src
  from public.decks d
  where d.id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  copy_name := src.name || ' (copy)';
  if char_length(copy_name) > 80 then
    copy_name := left(src.name, 80 - char_length(' (copy)')) || ' (copy)';
  end if;

  insert into public.decks (
    owner_id, name, format, notes, visibility, allow_forks, copied_from_id,
    commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,
    commander_image_uri, commander_art_uri, commander_color_identity, colors
  )
  values (
    auth.uid(),
    copy_name,
    src.format,
    src.notes,
    case when src.visibility = 'public' then 'friends' else 'private' end,
    src.visibility = 'public',
    src.id,
    src.commander_scryfall_id,
    src.commander_name,
    src.commander_type_line,
    src.commander_mana_cost,
    src.commander_image_uri,
    src.commander_art_uri,
    src.commander_color_identity,
    src.colors
  )
  returning id into new_id;

  insert into public.deck_categories (deck_id, name, position)
  select new_id, c.name, c.position
  from public.deck_categories c
  where c.deck_id = src.id;

  insert into public.deck_type_orders (deck_id, type_key, position)
  select new_id, t.type_key, t.position
  from public.deck_type_orders t
  where t.deck_id = src.id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity, category_id, board)
  select new_id, cards.scryfall_id, cards.card_name, cards.image_uri, cards.mana_cost,
         cards.type_line, cards.colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         cards.oracle_text, cards.quantity,
         newc.id,
         cards.board
  from public.deck_cards cards
  left join public.deck_categories oldc
    on oldc.id = cards.category_id
   and oldc.deck_id = src.id
  left join public.deck_categories newc
    on newc.deck_id = new_id
   and newc.name = oldc.name
  where cards.deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.copy_deck(uuid) from public, anon;
grant execute on function public.copy_deck(uuid) to authenticated;

commit;
