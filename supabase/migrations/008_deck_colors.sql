-- Spellbranch 008: deck colors (color identity restriction).
--
-- Apply after 001-007, BEFORE deploying the app version that reads these
-- columns (the app selects decks.colors and deck_cards.color_identity, and
-- PostgREST rejects a select of columns that don't exist yet). The old app
-- keeps working with 008 applied: it never writes colors, so every deck it
-- creates stays unrestricted (NULL) and nothing it does can trip the rules.
--
-- Safe to re-run, and runs in one transaction (all or nothing):
--   * columns use "add column if not exists";
--   * each constraint and trigger is dropped (if it exists) and added again,
--     fully validated (no NOT VALID);
--   * functions are create or replace.
-- It changes no rows: the new columns start NULL, so existing decks stay
-- unrestricted until their owner picks colors. The NOTICEs say so.
--
-- Constraint, trigger and function names are all new, so re-running an
-- older migration can't replace them with a weaker version (Cipher, PR #10).
-- The one exception is fork_deck(), which 002 and 006 also define: re-run
-- 008 after re-running either of them. Until then forks still keep the deck
-- colors (decks_inherit_fork_colors copies them on insert), but forking a
-- deck that has cards is refused, because the old fork_deck() copies no
-- card identity.
--
-- Rules (same as src/lib/deck-colors.ts and src/lib/data/deck-color-rules.ts):
--   * decks.colors: NULL = no colors picked (unrestricted); '{}' = Colorless;
--     otherwise W/U/B/R/G, once each, 1-D, no NULL entries.
--   * deck_cards.color_identity: the card's Scryfall color identity, stored
--     by the app from its own Scryfall lookup. NULL for cards added before
--     008; card colors stand in for those. New rows written through the API
--     (anon / authenticated) must carry one; legacy NULL rows stay as they are.
--     The DB checks the identity's shape, not its truth: an owner writing
--     straight to PostgREST can still label a card in their own deck with any
--     identity. That only affects their own deck.
--   * A card fits when its identity is a subset of the deck colors
--     (colorless cards fit every deck). Adding a card or raising its quantity
--     needs a fit; lowering or removing never does.
--   * The commander's identity must fit the deck colors.
--   * Changing a deck's colors is refused while any card wouldn't fit (the
--     app lists them); nothing is ever deleted. Once picked, colors can't be
--     cleared back to NULL.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.decks add column if not exists colors text[];
alter table public.deck_cards add column if not exists color_identity text[];

-- ---------------------------------------------------------------------------
-- 2. Constraints
-- ---------------------------------------------------------------------------
-- Shape: NULL, '{}' or a 1-D array of W/U/B/R/G with no NULLs and no
-- duplicates. CASE so array_positions() (1-D only) never sees a 2-D array.
-- array_ndims('{}') is null.
alter table public.decks drop constraint if exists decks_colors_wubrg;
alter table public.decks
  add constraint decks_colors_wubrg check (
    colors is null
    or case
      when array_ndims(colors) is null then true
      when array_ndims(colors) <> 1 then false
      else colors <@ array['W','U','B','R','G']::text[]
       and array_position(colors, null) is null
       and cardinality(array_positions(colors, 'W')) <= 1
       and cardinality(array_positions(colors, 'U')) <= 1
       and cardinality(array_positions(colors, 'B')) <= 1
       and cardinality(array_positions(colors, 'R')) <= 1
       and cardinality(array_positions(colors, 'G')) <= 1
    end
  );

alter table public.deck_cards drop constraint if exists deck_cards_color_identity_wubrg;
alter table public.deck_cards
  add constraint deck_cards_color_identity_wubrg check (
    color_identity is null
    or case
      when array_ndims(color_identity) is null then true
      when array_ndims(color_identity) <> 1 then false
      else color_identity <@ array['W','U','B','R','G']::text[]
       and array_position(color_identity, null) is null
       and cardinality(array_positions(color_identity, 'W')) <= 1
       and cardinality(array_positions(color_identity, 'U')) <= 1
       and cardinality(array_positions(color_identity, 'B')) <= 1
       and cardinality(array_positions(color_identity, 'R')) <= 1
       and cardinality(array_positions(color_identity, 'G')) <= 1
    end
  );

-- The commander fits the deck colors. With no commander the identity is
-- '{}' (decks_commander_complete), which fits everything.
alter table public.decks drop constraint if exists decks_commander_fits_colors;
alter table public.decks
  add constraint decks_commander_fits_colors check (
    colors is null or commander_color_identity <@ colors
  );

-- ---------------------------------------------------------------------------
-- 3. Triggers: cards fit the deck colors
-- ---------------------------------------------------------------------------
-- Both run as the caller (security invoker), so RLS applies to what they
-- read. Running as definer let a stranger's insert reach the deck's colors
-- before RLS refused it: a 23514 instead of 42501 showed that a private deck
-- exists and what its colors are (Cipher, PR #14 L1). Now a deck the caller
-- can't update reads as "not found" and is refused with 42501 straight away,
-- whatever the colors; only an owner ever sees a colors error. (Only owners
-- can write deck_cards or decks, so the owner's view is the whole deck.)
--
-- Races: the card trigger reads the deck row FOR SHARE and a colors change
-- holds that row's lock, so an add and a narrowing can't both pass on stale
-- data: whichever comes second waits, then checks against the other's
-- committed result (each query in the trigger takes a fresh snapshot).
--
-- Known, not reachable today: two transactions that each add a card to the
-- same deck (FOR SHARE) and THEN update that deck in the same transaction
-- can deadlock; Postgres aborts one of them. The app adds a card and touches
-- the deck in separate requests, and fork_deck() only locks its own new
-- deck. If a future RPC adds cards and updates the deck in one transaction,
-- take the deck row FOR NO KEY UPDATE here instead (serializes adds per deck).

-- deck_cards insert / update: refused (23514) when the card doesn't fit.
-- An update only needs to fit when it raises the quantity or changes the
-- card's colors, identity or deck, so an off-color card can be cut down.
-- The colors errors carry hint 'spellbranch_deck_colors', which the app maps
-- to a readable message.
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
     and new.quantity <= old.quantity
     and new.colors is not distinct from old.colors
     and new.color_identity is not distinct from old.color_identity then
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
  -- NULL keep it; the server's own roles may still write NULL).
  if new.color_identity is null
     and (tg_op = 'INSERT' or old.color_identity is not null)
     and current_user in ('anon', 'authenticated') then
    raise exception 'Card "%" needs a color identity', new.card_name
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;

  identity := coalesce(new.color_identity, new.colors);
  if deck_colors is not null and not (identity <@ deck_colors) then
    raise exception 'Card "%" is outside the deck colors', new.card_name
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_cards_fit_deck_colors on public.deck_cards;
create trigger deck_cards_fit_deck_colors
  before insert or update on public.deck_cards
  for each row execute function public.deck_card_fits_colors();

-- decks colors change: refused (23514) while any card wouldn't fit, and
-- picked colors can't be cleared back to NULL.
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
    and not (coalesce(c.color_identity, c.colors) <@ new.colors);

  if misfits > 0 then
    raise exception '% card(s) in this deck are outside the new deck colors', misfits
      using errcode = '23514', hint = 'spellbranch_deck_colors';
  end if;
  return new;
end;
$$;

drop trigger if exists decks_colors_fit_cards on public.decks;
create trigger decks_colors_fit_cards
  before update of colors on public.decks
  for each row execute function public.deck_colors_fit_cards();

-- A fork (forked_from_id set, colors not given) keeps the source's colors.
-- fork_deck() below copies them itself; this keeps that true even if an
-- older fork_deck() (002/006) is re-applied. Runs as the caller, so it only
-- sees a source deck the caller can see.
create or replace function public.deck_inherit_fork_colors()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.colors is null and new.forked_from_id is not null then
    select d.colors into new.colors
    from public.decks d
    where d.id = new.forked_from_id;
  end if;
  return new;
end;
$$;

drop trigger if exists decks_inherit_fork_colors on public.decks;
create trigger decks_inherit_fork_colors
  before insert on public.decks
  for each row execute function public.deck_inherit_fork_colors();

-- Trigger functions only; nobody calls them directly.
revoke execute on function public.deck_card_fits_colors() from public, anon, authenticated;
revoke execute on function public.deck_colors_fit_cards() from public, anon, authenticated;
revoke execute on function public.deck_inherit_fork_colors() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. fork_deck(): 006's, plus the deck colors and each card's identity.
-- ---------------------------------------------------------------------------
-- A legacy card with no stored identity gets its WUBRG colors as identity
-- (the same fallback the checks use), since new API rows need one. Re-running
-- 002 or 006 brings back a fork_deck() that copies no identity, so forks of
-- decks with cards are refused until 008 runs again; supabase/tests/
-- deck_colors.sql fails in that state too.
create or replace function public.fork_deck(source uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into src from public.decks where id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  insert into public.decks (
    owner_id, name, format, notes, visibility, allow_forks, forked_from_id,
    commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,
    commander_image_uri, commander_art_uri, commander_color_identity, colors
  )
  values (
    auth.uid(),
    src.name || ' (branch)',
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

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity)
  select new_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         oracle_text, quantity
  from public.deck_cards
  where deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.fork_deck(uuid) from public, anon;
grant execute on function public.fork_deck(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Report
-- ---------------------------------------------------------------------------
do $$
declare
  uncolored integer;
  no_identity integer;
begin
  select count(*) into uncolored from public.decks where colors is null;
  select count(*) into no_identity from public.deck_cards where color_identity is null;
  raise notice '008_deck_colors: 0 rows changed.';
  raise notice '008_deck_colors: % deck(s) have no colors yet (unrestricted until the owner picks).', uncolored;
  raise notice '008_deck_colors: % deck card(s) have no stored color identity (their card colors are used).', no_identity;
end;
$$;

commit;
