-- Spellbranch 019: legendary planeswalker and spacecraft commanders.
--
-- Apply after 018. Safe to re-run. Does not change decks_precon_official,
-- the precon seed, or who can write a precon. 011 is reserved.
--
-- 018 allows a planeswalker or spacecraft commander only when is_precon is
-- true. This replaces that CHECK so the same front face is valid on every
-- deck: Legendary, and Creature or Planeswalker, or an Artifact whose
-- subtype is Spacecraft. Partners and backgrounds stay out. The app uses
-- the same rule in src/lib/commander-legality.ts.

begin;

alter table public.decks drop constraint if exists decks_commander_legendary_creature;
alter table public.decks
  add constraint decks_commander_legendary_creature check (
    commander_type_line is null
    or (
      split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Legendary([ \t\n\r\f\v]|$)'
      and (
        split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Creature([ \t\n\r\f\v]|$)'
        or split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Planeswalker([ \t\n\r\f\v]|$)'
        or (
          split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|[ \t\n\r\f\v])Artifact([ \t\n\r\f\v]|$)'
          and split_part(split_part(commander_type_line, '//', 1), '—', 2) ~ '(^|[ \t\n\r\f\v])Spacecraft([ \t\n\r\f\v]|$)'
        )
      )
    )
  );

commit;
