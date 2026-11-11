-- Spellbranch 014: sideboard and maybeboard on deck_cards.
--
-- Apply after 001-013, in its own transaction (this file is BEGIN/COMMIT).
-- Do not apply it to the hosted project from the app deploy. Run it in the
-- Supabase SQL editor before the app that selects deck_cards.board.
-- 011 is reserved and is not used. This file does not edit 012 or 013.
--
-- Every deck card sits on one board: main (the deck), side, or maybe.
-- Existing rows are backfilled to main. The same printing may exist once
-- per board. Custom categories (013) are unchanged: category_id stays on
-- the row when it moves, and the same-deck trigger is left in place.
-- Categories are a mainboard idea in the app; the database does not
-- restrict category_id by board.
--
-- Only the mainboard is color-checked. Side and maybe may be off-color.
-- Moving a card onto main, or narrowing the deck's colors, re-checks main
-- only. The triggers stay security invoker, so a caller who cannot update
-- the deck is still refused with 42501 before any color comparison.
--
-- fork_deck() and copy_deck() copy board. They stay security invoker with
-- an empty search_path and an explicit column list, and they still coalesce
-- color_identity the way 008 and 013 do.
--
-- Re-run this file after any re-run of 002, 006, 008, 010, or 013. Those
-- migrations replace fork_deck() (and 010/013 also replace copy_deck())
-- with a version that does not copy board, so a fork would land every card
-- on main. 008 also replaces the two color triggers; re-run 014 after 008
-- or sideboard cards become color-checked again. The board column itself
-- survives those re-runs.

begin;

-- ---------------------------------------------------------------------------
-- 1. deck_cards.board
-- ---------------------------------------------------------------------------

alter table public.deck_cards
  add column if not exists board text;

update public.deck_cards
set board = 'main'
where board is null;

alter table public.deck_cards
  alter column board set default 'main';

alter table public.deck_cards
  alter column board set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deck_cards'::regclass
      and conname = 'deck_cards_board_check'
  ) then
    alter table public.deck_cards
      add constraint deck_cards_board_check
      check (board in ('main', 'side', 'maybe'));
  end if;
end $$;

comment on column public.deck_cards.board is
  'main (the deck), side, or maybe. Only main counts toward size and color legality.';

-- The old unique (deck_id, scryfall_id) allowed one row per printing. The
-- same printing may now sit on two boards, so uniqueness includes board.
do $$
declare
  old_name text;
begin
  select c.conname into old_name
  from pg_constraint c
  where c.conrelid = 'public.deck_cards'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by u.ord)
      from unnest(c.conkey) with ordinality as u(attnum, ord)
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = u.attnum
    ) = array['deck_id', 'scryfall_id']::text[];
  if old_name is not null then
    execute format('alter table public.deck_cards drop constraint %I', old_name);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deck_cards'::regclass
      and conname = 'deck_cards_deck_id_scryfall_id_board_key'
  ) then
    alter table public.deck_cards
      add constraint deck_cards_deck_id_scryfall_id_board_key
      unique (deck_id, scryfall_id, board);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Color triggers: mainboard only.
--    Same functions as 008, plus the board exceptions. Still security
--    invoker. An update that does not raise a mainboard quantity, change a
--    mainboard identity, or move a card onto main returns before the deck
--    is read, so an off-color mainboard card can still be cut down.
-- ---------------------------------------------------------------------------

create or replace function public.deck_card_fits_colors()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deck_colors text[];
  identity text[];
begin
  if tg_op = 'UPDATE'
     and new.deck_id = old.deck_id
     and new.board is not distinct from old.board
     and (
       new.board <> 'main'
       or (
         new.quantity <= old.quantity
         and new.colors is not distinct from old.colors
         and new.color_identity is not distinct from old.color_identity
       )
     ) then
    return new;
  end if;

  -- FOR SHARE follows the decks UPDATE policy: only the owner (or a role
  -- that bypasses RLS) finds the row. Anyone else is refused here, before
  -- anything about the deck is compared, so the answer never depends on it.
  select d.colors into deck_colors
  from public.decks d
  where d.id = new.deck_id
  for share;
  if not found then
    raise exception 'You cannot edit this deck' using errcode = '42501';
  end if;

  -- New rows from the API must say what their identity is (legacy rows with
  -- NULL keep it; the server's own roles may still write NULL). Side and
  -- maybe included: the app stores an identity on every board.
  if new.color_identity is null
     and (tg_op = 'INSERT' or old.color_identity is not null)
     and current_user in ('anon', 'authenticated') then
    raise exception 'Card "%" needs a color identity', new.card_name
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;

  -- Sideboard and maybeboard are not part of the deck's colors.
  if new.board <> 'main' then
    return new;
  end if;

  identity := coalesce(new.color_identity, new.colors);
  if deck_colors is not null and not (identity <@ deck_colors) then
    raise exception 'Card "%" is outside the deck colors', new.card_name
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;
  return new;
end;
$$;

create or replace function public.deck_colors_fit_cards()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  misfits integer;
begin
  if new.colors is not distinct from old.colors then
    return new;
  end if;
  if new.colors is null then
    raise exception 'Deck colors cannot be cleared once picked'
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;

  select count(*) into misfits
  from public.deck_cards c
  where c.deck_id = new.id
    and c.board = 'main'
    and not (coalesce(c.color_identity, c.colors) <@ new.colors);

  if misfits > 0 then
    raise exception '% card(s) in this deck are outside the new deck colors', misfits
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;
  return new;
end;
$$;

revoke execute on function public.deck_card_fits_colors() from public, anon, authenticated;
revoke execute on function public.deck_colors_fit_cards() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. fork_deck() and copy_deck(): 013's functions, plus each card's board.
--    Inlined (not a helper granted to API roles) so a visible deck cannot
--    be copied into an unrelated deck by calling the helper directly.
-- ---------------------------------------------------------------------------

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
    null::uuid
  into src
  from public.decks d
  where d.id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  -- ' (branch)' is 9 characters. decks.name is at most 80 (003). Shorten the
  -- source name so the default always fits; a caller-supplied name is applied
  -- by the app afterwards and is checked there.
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
    null::uuid
  into src
  from public.decks d
  where d.id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  -- ' (copy)' is 7 characters. decks.name is at most 80 (003). Shorten the
  -- source name so the default always fits; a caller-supplied name is applied
  -- by the app afterwards and is checked there.
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
