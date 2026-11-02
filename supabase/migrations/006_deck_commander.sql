-- Spellbranch 006: a commander for Commander decks.
--
-- Apply after 001-005 (it uses the decks table from 001 and replaces
-- fork_deck() from 002). Deploy order: apply this migration BEFORE deploying
-- the app version that reads it: the app selects the new columns, and
-- PostgREST rejects a select of columns that don't exist yet. The old app
-- keeps working with the migration applied (it never selects or writes
-- these columns, and the format CHECK can't fire while they are all null).
--
-- Design:
--   * The commander lives on the deck row (commander_* columns), not in
--     deck_cards: it is never one of "the 99", never has a quantity, and
--     needs no new table, policy or grant. RLS is therefore exactly the deck
--     policies from 001/002: readable wherever the deck is readable
--     ("View decks by visibility"), set or cleared only by the owner
--     ("Owners update decks"); anon has no UPDATE grant on decks (002).
--   * Stored like deck cards: Scryfall id, name, type line, mana cost, card
--     image and art crop (Scryfall CDN only), plus the color identity for a
--     later deck-color check.
--   * CHECKs back up the app: all-or-nothing columns, Commander format only,
--     the front face must be a Legendary Creature, the same length limits as
--     deck_cards (003, src/lib/data/limits.ts) and Scryfall-only image URLs.
--     A signed-in owner can PATCH their deck row through the API directly, so
--     these are what holds then. (The database can't prove a type line is
--     Scryfall's; the app fetches it from Scryfall itself.)
--   * Changing the format away from 'commander' must clear the commander in
--     the same UPDATE (the app does); otherwise decks_commander_format
--     rejects it with 23514.
--   * fork_deck() copies the commander along with the cards.
--
-- Safe to re-run: columns use "if not exists", each constraint is dropped
-- (if it exists) and added again, and fork_deck() is create or replace.
-- No existing data can violate the constraints (every new column starts
-- null / '{}').

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.decks
  add column if not exists commander_scryfall_id text,
  add column if not exists commander_name text,
  add column if not exists commander_type_line text,
  add column if not exists commander_mana_cost text,
  add column if not exists commander_image_uri text,
  add column if not exists commander_art_uri text,
  add column if not exists commander_color_identity text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 2. Constraints
-- ---------------------------------------------------------------------------

-- All or nothing: id, name and type line are set together; with no
-- commander every other commander column is empty too.
alter table public.decks drop constraint if exists decks_commander_complete;
alter table public.decks
  add constraint decks_commander_complete check (
    (commander_scryfall_id is null) = (commander_name is null)
    and (commander_scryfall_id is null) = (commander_type_line is null)
    and (
      commander_scryfall_id is not null
      or (
        commander_mana_cost is null
        and commander_image_uri is null
        and commander_art_uri is null
        and cardinality(commander_color_identity) = 0
      )
    )
  );

-- Only Commander decks have a commander.
alter table public.decks drop constraint if exists decks_commander_format;
alter table public.decks
  add constraint decks_commander_format check (
    commander_scryfall_id is null or format = 'commander'
  );

-- Front face ("A // B" -> "A"), card types only (before the em dash), whole
-- words, case-sensitive. Same rule as isLegendaryCreatureTypeLine() in
-- src/lib/commander.ts.
alter table public.decks drop constraint if exists decks_commander_legendary_creature;
alter table public.decks
  add constraint decks_commander_legendary_creature check (
    commander_type_line is null
    or (
      split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\s)Legendary(\s|$)'
      and split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\s)Creature(\s|$)'
    )
  );

-- Scryfall ids are lowercase UUIDs (the app looks the card up by this id).
alter table public.decks drop constraint if exists decks_commander_scryfall_id_format;
alter table public.decks
  add constraint decks_commander_scryfall_id_format check (
    commander_scryfall_id is null
    or commander_scryfall_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- Same limits as deck_cards (003).
alter table public.decks drop constraint if exists decks_commander_text_lengths;
alter table public.decks
  add constraint decks_commander_text_lengths check (
    (commander_name is null or char_length(commander_name) between 1 and 200)
    and (commander_type_line is null or char_length(commander_type_line) <= 200)
    and (commander_mana_cost is null or char_length(commander_mana_cost) <= 100)
    and (commander_image_uri is null or char_length(commander_image_uri) <= 512)
    and (commander_art_uri is null or char_length(commander_art_uri) <= 512)
  );

-- Rendered to anon visitors on public decks: Scryfall CDN only (002, F8).
alter table public.decks drop constraint if exists decks_commander_images_scryfall;
alter table public.decks
  add constraint decks_commander_images_scryfall check (
    (commander_image_uri is null or commander_image_uri ~ '^https://cards\.scryfall\.io/')
    and (commander_art_uri is null or commander_art_uri ~ '^https://cards\.scryfall\.io/')
  );

alter table public.decks drop constraint if exists decks_commander_colors_valid;
alter table public.decks
  add constraint decks_commander_colors_valid check (
    commander_color_identity <@ array['W','U','B','R','G']::text[]
    and cardinality(commander_color_identity) <= 5
  );

-- ---------------------------------------------------------------------------
-- 3. fork_deck(): unchanged from 002 except that the commander is copied.
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
    commander_image_uri, commander_art_uri, commander_color_identity
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
    src.commander_color_identity
  )
  returning id into new_id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, oracle_text, quantity)
  select new_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, oracle_text, quantity
  from public.deck_cards
  where deck_id = src.id;

  return new_id;
end;
$$;

-- create or replace keeps the existing grants; restated so this file alone
-- leaves fork_deck() signed-in only, as in 002.
revoke execute on function public.fork_deck(uuid) from public, anon;
grant execute on function public.fork_deck(uuid) to authenticated;
