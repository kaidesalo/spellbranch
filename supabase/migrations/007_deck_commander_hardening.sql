-- Spellbranch 007: tighter deck commander CHECKs (Cipher PR #9 review, I1/I2).
--
-- Apply after 006 (006 then 007), both BEFORE deploying the app version
-- that reads the commander columns. Safe to re-run: existing rows are
-- normalized first, then each constraint is dropped (if it exists) and
-- added again. No columns, policies, grants or functions change.
--
--   * decks_commander_colors_shape: color identity is a 1-D array (or empty);
--     a direct API write could store {{W,U},{B,R}}.
--   * decks_commander_colors_distinct: no duplicate colors ({W,W,W}).
--   * decks_commander_name_not_blank: the name has a non-whitespace character.
--   * decks_commander_legendary_creature (replaced): same rule as 006, but
--     whitespace is spelled out as [ \t\n\r\f\v] instead of \s. Postgres's \s
--     depends on the database locale (it matches U+2003 EM SPACE but not
--     NBSP), JavaScript's matches both; the app now uses this exact class,
--     so the app and the database accept the same type lines.
--
-- Whitespace below is the same class everywhere: the six ASCII whitespace
-- characters (src/lib/commander.ts, PG_SPACE).

-- ---------------------------------------------------------------------------
-- 1. Normalize existing rows so the constraints can be added
-- ---------------------------------------------------------------------------
-- Colors: flatten, keep W/U/B/R/G once each, in WUBRG order (what the app
-- writes). "= any" flattens multi-dimensional arrays.
update public.decks d
set commander_color_identity = array(
  select w.c
  from unnest(array['W','U','B','R','G']) with ordinality as w(c, i)
  where w.c = any (d.commander_color_identity)
  order by w.i
)
where array_ndims(d.commander_color_identity) > 1
   or cardinality(d.commander_color_identity) <> (
        select count(distinct x) from unnest(d.commander_color_identity) as x
      );

-- A commander the tightened rules would refuse (blank name, or a type line
-- that only passed 006 through a locale-specific space) is cleared, like a
-- format change does. Only possible through a direct API write.
update public.decks
set commander_scryfall_id = null,
    commander_name = null,
    commander_type_line = null,
    commander_mana_cost = null,
    commander_image_uri = null,
    commander_art_uri = null,
    commander_color_identity = '{}'
where commander_scryfall_id is not null
  and (
    commander_name !~ '[^ \t\n\r\f\v]'
    or not (
      split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Legendary([ \t\n\r\f\v]|$)'
      and split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Creature([ \t\n\r\f\v]|$)'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Constraints
-- ---------------------------------------------------------------------------
-- array_ndims('{}') is null.
alter table public.decks drop constraint if exists decks_commander_colors_shape;
alter table public.decks
  add constraint decks_commander_colors_shape check (
    array_ndims(commander_color_identity) is null
    or array_ndims(commander_color_identity) = 1
  );

-- One entry per color. CASE so array_positions() (1-D only) never sees a
-- 2-D array; decks_commander_colors_shape reports those.
alter table public.decks drop constraint if exists decks_commander_colors_distinct;
alter table public.decks
  add constraint decks_commander_colors_distinct check (
    case
      when coalesce(array_ndims(commander_color_identity), 1) <> 1 then true
      else cardinality(array_positions(commander_color_identity, 'W')) <= 1
       and cardinality(array_positions(commander_color_identity, 'U')) <= 1
       and cardinality(array_positions(commander_color_identity, 'B')) <= 1
       and cardinality(array_positions(commander_color_identity, 'R')) <= 1
       and cardinality(array_positions(commander_color_identity, 'G')) <= 1
    end
  );

alter table public.decks drop constraint if exists decks_commander_name_not_blank;
alter table public.decks
  add constraint decks_commander_name_not_blank check (
    commander_name is null or commander_name ~ '[^ \t\n\r\f\v]'
  );

alter table public.decks drop constraint if exists decks_commander_legendary_creature;
alter table public.decks
  add constraint decks_commander_legendary_creature check (
    commander_type_line is null
    or (
      split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Legendary([ \t\n\r\f\v]|$)'
      and split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Creature([ \t\n\r\f\v]|$)'
    )
  );
