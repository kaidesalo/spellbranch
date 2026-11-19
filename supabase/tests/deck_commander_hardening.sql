-- Spellbranch: migration 007 (Cipher PR #9 review I1/I2). Starts from the
-- 006-only state, writes what an owner could PATCH through the API under
-- 006, then applies 007 twice (psql \ir) and checks the data and the new
-- rules. Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

-- Back to the 006-only state (re-running 006 also restores its \s rule).
alter table public.decks drop constraint if exists decks_commander_colors_shape;
alter table public.decks drop constraint if exists decks_commander_colors_distinct;
alter table public.decks drop constraint if exists decks_commander_name_not_blank;
\ir ../migrations/006_deck_commander.sql

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c7000000-0000-4000-8000-000000000001','authenticated','authenticated','h.ann@example.test','{"username":"h_ann"}');
insert into public.decks (id, owner_id, name, format, visibility) values
 ('c7100000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','dups','commander','private'),
 ('c7100000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000001','2d','commander','private'),
 ('c7100000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000001','blank','commander','private'),
 ('c7100000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000001','emspace','commander','private'),
 ('c7100000-0000-4000-8000-000000000005','c7000000-0000-4000-8000-000000000001','fine','commander','private');

-- Direct API writes by the owner that 006 allows.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.decks set commander_scryfall_id = '11111111-2222-4333-8444-555555555555',
  commander_name = 'Test Legend', commander_type_line = 'Legendary Creature — Elf',
  commander_color_identity = case name
    when 'dups' then array['G','W','W','G']
    when '2d' then '{{W,U},{B,R}}'::text[]
    else array['G','U'] end
  where owner_id = 'c7000000-0000-4000-8000-000000000001';
update public.decks set commander_name = E'  \t ' where name = 'blank';
reset role;
-- U+2003 EM SPACE: 006's \s matches it only in some locales, so plant it as
-- postgres if this database accepts it at all.
do $$
begin
  update public.decks set commander_type_line = E'Legendary\u2003Creature — Elf' where name = 'emspace';
exception when check_violation then
  null;
end $$;

select is(
  (select array_ndims(commander_color_identity) from public.decks where name = '2d'),
  2, 'precondition: 006 accepted a 2-D color array');

-- Apply 007, twice.
\ir ../migrations/007_deck_commander_hardening.sql
\ir ../migrations/007_deck_commander_hardening.sql

select is((select commander_color_identity from public.decks where name = 'dups'),
  array['W','G'], 'duplicate colors are deduplicated into WUBRG order');
select is((select commander_color_identity from public.decks where name = '2d'),
  array['W','U','B','R'], 'a 2-D color array is flattened');
select is((select commander_name from public.decks where name = '2d'),
  'Test Legend', 'normalizing colors keeps the commander');
select is((select row(commander_scryfall_id, commander_name, commander_color_identity)::text
           from public.decks where name = 'blank'),
  row(null::text, null::text, '{}'::text[])::text, 'a blank-name commander is cleared');
select is((select commander_type_line from public.decks where name = 'emspace'),
  null, 'a type line that only passed through a locale-specific space is cleared (or never stored)');
select is((select row(commander_name, commander_color_identity)::text from public.decks where name = 'fine'),
  row('Test Legend'::text, array['G','U'])::text, 'a valid commander is untouched');

select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.decks'::regclass and conname = c and convalidated),
          format('%s exists and is validated', c))
  from unnest(array['decks_commander_colors_shape', 'decks_commander_colors_distinct',
                    'decks_commander_name_not_blank', 'decks_commander_legendary_creature']) as c;
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.decks'::regclass and conname = 'decks_commander_legendary_creature')
    !~ '\\s', 'the legendary-creature CHECK no longer uses \s');

-- The owner, through the API, after 007.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok($$update public.decks set commander_color_identity = '{{W,U},{B,R}}' where name = 'fine'$$,
  '23514', null, 'a 2-D color array is rejected');
select throws_ok($$update public.decks set commander_color_identity = array['W','W'] where name = 'fine'$$,
  '23514', null, 'duplicate colors are rejected');
select throws_ok($$update public.decks set commander_color_identity = array['G','U','G'] where name = 'fine'$$,
  '23514', null, 'a repeated color anywhere is rejected');
select lives_ok($$update public.decks set commander_color_identity = array['W','U','B','R','G'] where name = 'fine'$$,
  'five distinct colors are fine');
select lives_ok($$update public.decks set commander_color_identity = '{}' where name = 'fine'$$,
  'colorless is fine');
select throws_ok($$update public.decks set commander_name = ' ' where name = 'fine'$$,
  '23514', null, 'a whitespace-only name is rejected');
select throws_ok($$update public.decks set commander_name = E'\t\n\r\f\v ' where name = 'fine'$$,
  '23514', null, 'a name of only ASCII whitespace characters is rejected');
select lives_ok($$update public.decks set commander_name = ' Test Legend ' where name = 'fine'$$,
  'a name with surrounding spaces is fine');
select throws_ok($$update public.decks set commander_type_line = E'Legendary\u00a0Creature — Elf' where name = 'fine'$$,
  '23514', null, 'NBSP between Legendary and Creature is rejected (as in the app)');
select throws_ok($$update public.decks set commander_type_line = E'Legendary\u2003Creature — Elf' where name = 'fine'$$,
  '23514', null, 'EM SPACE is rejected whatever the locale (as in the app)');
select throws_ok($$update public.decks set commander_type_line = E'\u00a0Legendary Creature' where name = 'fine'$$,
  '23514', null, 'Legendary after an NBSP is not a whole word');
select lives_ok($$update public.decks set commander_type_line = E'Legendary\tCreature — Elf' where name = 'fine'$$,
  'ASCII whitespace still separates the words');
select lives_ok($$update public.decks set commander_type_line = 'Legendary Enchantment Creature — God' where name = 'fine'$$,
  '006 rules still hold: Legendary Enchantment Creature');
select throws_ok($$update public.decks set commander_type_line = 'Legendary Artifact' where name = 'fine'$$,
  '23514', null, '006 rules still hold: Legendary Artifact is rejected');
select throws_ok($$update public.decks set commander_type_line = 'Legendary Planeswalker — X // Legendary Creature — Y' where name = 'fine'$$,
  '23514', null, '006 rules still hold: back-face creature is rejected');
select throws_ok($$update public.decks set format = 'modern' where name = 'fine'$$,
  '23514', null, '006 rules still hold: leaving Commander needs clearing');
reset role;

select * from finish();
rollback;
