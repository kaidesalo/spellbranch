-- Spellbranch: deck commander (migration 006). RLS, constraints and forks.
--
-- Run with `supabase test db` (or psql on a database with 001-006 applied;
-- look for "not ok"). Self-contained: its own throwaway users and decks in a
-- transaction that is rolled back, so it doesn't depend on seed.sql.
-- Impersonation: SET LOCAL ROLE + request.jwt.claims, like rls_checks.sql.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(55);

grant all on all tables in schema pg_temp to anon, authenticated;
grant all on all sequences in schema pg_temp to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
-- ann: owner. ben: ann's accepted friend. cat: a stranger.
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cmd.ann@example.test', '{"username":"cmd_ann"}'),
  ('c0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cmd.ben@example.test', '{"username":"cmd_ben"}'),
  ('c0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'cmd.cat@example.test', '{"username":"cmd_cat"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'accepted');

insert into public.decks (id, owner_id, name, format, visibility, allow_forks) values
  ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Public EDH',  'commander', 'public',  true),
  ('c1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Friends EDH', 'commander', 'friends', true),
  ('c1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Private EDH', 'commander', 'private', false),
  ('c1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Modern deck', 'modern',    'public',  true);

insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity) values
  ('c1000000-0000-4000-8000-000000000001', 'test-sol-ring', 'Sol Ring', 'Artifact', 1);

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select has_column('public', 'decks', c, format('decks.%s exists', c))
  from unnest(array['commander_scryfall_id', 'commander_name', 'commander_type_line',
                    'commander_mana_cost', 'commander_image_uri', 'commander_art_uri',
                    'commander_color_identity']) as c;

select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.decks'::regclass and conname = c and convalidated),
          format('%s exists and is validated', c))
  from unnest(array['decks_commander_complete', 'decks_commander_format',
                    'decks_commander_legendary_creature', 'decks_commander_scryfall_id_format',
                    'decks_commander_text_lengths', 'decks_commander_images_scryfall',
                    'decks_commander_colors_valid']) as c;

-- No new policies: the commander is covered by the existing deck policies.
select policies_are('public', 'decks',
  array['View decks by visibility', 'Owners insert decks', 'Owners update decks', 'Owners delete decks'],
  'decks keeps exactly the four deck policies from 001');

-- ---------------------------------------------------------------------------
-- Owner (ann): set, read, constraints
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok($$
  update public.decks set
    commander_scryfall_id = '11111111-2222-4333-8444-555555555555',
    commander_name = 'Test Legend',
    commander_type_line = 'Legendary Creature — Elf Druid',
    commander_mana_cost = '{1}{G}{U}',
    commander_image_uri = 'https://cards.scryfall.io/normal/front/1/1/11111111-2222-4333-8444-555555555555.jpg',
    commander_art_uri = 'https://cards.scryfall.io/art_crop/front/1/1/11111111-2222-4333-8444-555555555555.jpg',
    commander_color_identity = array['G','U']
  where id in ('c1000000-0000-4000-8000-000000000001',
               'c1000000-0000-4000-8000-000000000002',
               'c1000000-0000-4000-8000-000000000003')$$,
  'owner can set a legendary creature commander on their Commander decks');

select is(
  (select commander_name from public.decks where id = 'c1000000-0000-4000-8000-000000000001'),
  'Test Legend', 'owner reads the commander back');

select throws_ok($$
  update public.decks set commander_scryfall_id = '11111111-2222-4333-8444-555555555555',
    commander_name = 'Test Legend', commander_type_line = 'Legendary Creature — Elf'
  where id = 'c1000000-0000-4000-8000-000000000004'$$,
  '23514', null, 'a non-Commander deck cannot have a commander');

-- Type line rule (front face, card types only, whole words, case-sensitive)
create temp table type_cases (type_line text, ok boolean, label text) on commit drop;
insert into type_cases values
  ('Legendary Creature — Human Wizard',                          true,  'Legendary Creature'),
  ('Legendary Enchantment Creature — God',                       true,  'Legendary Enchantment Creature'),
  ('Legendary Artifact Creature — Golem',                        true,  'Legendary Artifact Creature'),
  ('Legendary Creature — Human // Legendary Planeswalker — Nissa', true, 'front face Legendary Creature (DFC)'),
  ('Legendary Artifact',                                         false, 'Legendary Artifact (not a creature)'),
  ('Creature — Elf Druid',                                       false, 'non-legendary Creature'),
  ('Legendary Planeswalker — Teferi',                            false, 'Legendary Planeswalker (out of scope)'),
  ('Legendary Enchantment — Background',                         false, 'Background (out of scope)'),
  ('Legendary Planeswalker — Nissa // Legendary Creature — Elf', false, 'only the back face is a creature'),
  ('Artifact — Equipment Legendary Creature',                    false, 'words only after the em dash'),
  ('legendary creature — elf',                                   false, 'lowercase'),
  ('LegendaryCreature — Elf',                                    false, 'not whole words');
grant select on type_cases to authenticated;

select is(
  (select array_agg(label order by label) from type_cases t
    where t.ok is distinct from (
      split_part(split_part(t.type_line, '//', 1), '—', 1) ~ '(^|\s)Legendary(\s|$)'
      and split_part(split_part(t.type_line, '//', 1), '—', 1) ~ '(^|\s)Creature(\s|$)')),
  null::text[], 'the type-line rule classifies every case as expected');

select lives_ok($$
  update public.decks set commander_type_line = 'Legendary Enchantment Creature — God'
  where id = 'c1000000-0000-4000-8000-000000000002'$$,
  'Legendary Enchantment Creature is accepted');
select lives_ok($$
  update public.decks set commander_type_line = 'Legendary Creature — Human // Legendary Planeswalker — Nissa'
  where id = 'c1000000-0000-4000-8000-000000000003'$$,
  'a DFC whose front face is a Legendary Creature is accepted');
select throws_ok($$
  update public.decks set commander_type_line = 'Legendary Artifact'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'Legendary Artifact is rejected');
select throws_ok($$
  update public.decks set commander_type_line = 'Creature — Elf Druid'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a non-legendary creature is rejected');
select throws_ok($$
  update public.decks set commander_type_line = 'Legendary Planeswalker — Teferi'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a planeswalker is rejected (out of scope)');
select throws_ok($$
  update public.decks set commander_type_line = 'Legendary Planeswalker — Nissa // Legendary Creature — Elf'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a card that is only a creature on its back face is rejected');

-- All or nothing
select throws_ok($$
  update public.decks set commander_name = null
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a commander id without a name is rejected');
select throws_ok($$
  update public.decks set commander_scryfall_id = null, commander_name = null, commander_type_line = null
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'clearing the id but leaving image/mana/colors is rejected');
select throws_ok($$
  update public.decks set commander_image_uri = 'https://cards.scryfall.io/normal/front/x.jpg'
  where id = 'c1000000-0000-4000-8000-000000000004'$$,
  '23514', null, 'commander details without a commander are rejected');

-- Values
select throws_ok($$
  update public.decks set commander_image_uri = 'https://evil.example/pixel.png'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a non-Scryfall image URL is rejected');
select throws_ok($$
  update public.decks set commander_art_uri = 'javascript:alert(1)'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a javascript: art URL is rejected');
select throws_ok($$
  update public.decks set commander_color_identity = array['G','X']
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a color outside WUBRG is rejected');
select throws_ok($$
  update public.decks set commander_scryfall_id = 'not-a-scryfall-id'
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a commander id that is not a lowercase UUID is rejected');
select throws_ok($$
  update public.decks set commander_name = repeat('n', 201)
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a 201-character commander name is rejected');
select throws_ok($$
  update public.decks set commander_type_line = 'Legendary Creature — ' || repeat('x', 200)
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a type line over 200 characters is rejected');
select throws_ok($$
  update public.decks set commander_name = ''
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an empty commander name is rejected');

-- Format changes
select throws_ok($$
  update public.decks set format = 'modern'
  where id = 'c1000000-0000-4000-8000-000000000003'$$,
  '23514', null, 'leaving Commander without clearing the commander is rejected');
select lives_ok($$
  update public.decks set format = 'modern',
    commander_scryfall_id = null, commander_name = null, commander_type_line = null,
    commander_mana_cost = null, commander_image_uri = null, commander_art_uri = null,
    commander_color_identity = '{}'
  where id = 'c1000000-0000-4000-8000-000000000003'$$,
  'leaving Commander and clearing the commander in one UPDATE works (what the app does)');
select is(
  (select row(format, commander_name) from public.decks where id = 'c1000000-0000-4000-8000-000000000003'),
  row('modern'::text, null::text), 'the private deck is now modern with no commander');

-- Insert path: a new deck can't start with someone's invalid commander either
select throws_ok($$
  insert into public.decks (owner_id, name, format, visibility, commander_scryfall_id, commander_name, commander_type_line)
  values ('c0000000-0000-4000-8000-000000000001', 'x', 'standard', 'private',
          '11111111-2222-4333-8444-555555555555', 'Test Legend', 'Legendary Creature — Elf')$$,
  '23514', null, 'an INSERT with a commander on a non-Commander deck is rejected');

-- ---------------------------------------------------------------------------
-- Friend (ben): reads friends-only commander, can't write
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select commander_name from public.decks where id = 'c1000000-0000-4000-8000-000000000002'),
  'Test Legend', 'a friend reads the commander of a friends-only deck');

create temp table ben_writes (deck text, n int) on commit drop;
grant all on ben_writes to authenticated;
with u as (
  update public.decks set commander_name = 'Hijacked', commander_type_line = 'Legendary Creature — Rat'
  where id = 'c1000000-0000-4000-8000-000000000002' returning 1)
insert into ben_writes select 'friends', count(*) from u;
with u as (
  update public.decks set commander_scryfall_id = null, commander_name = null, commander_type_line = null,
    commander_mana_cost = null, commander_image_uri = null, commander_art_uri = null, commander_color_identity = '{}'
  where id = 'c1000000-0000-4000-8000-000000000001' returning 1)
insert into ben_writes select 'public-clear', count(*) from u;

select is((select n from ben_writes where deck = 'friends'), 0,
  'a friend cannot change the commander of a deck they can see');
select is((select n from ben_writes where deck = 'public-clear'), 0,
  'a non-owner cannot clear the commander of a public deck');

-- ---------------------------------------------------------------------------
-- Forks carry the commander over
-- ---------------------------------------------------------------------------
select lives_ok($$
  create temp table ben_fork on commit drop as
    select public.fork_deck('c1000000-0000-4000-8000-000000000001') as id$$,
  'a friend forks the public Commander deck');
select is(
  (select row(d.format, d.commander_scryfall_id, d.commander_name, d.commander_type_line,
              d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri, d.commander_color_identity)
   from public.decks d where d.id = (select id from ben_fork)),
  (select row(s.format, s.commander_scryfall_id, s.commander_name, s.commander_type_line,
              s.commander_mana_cost, s.commander_image_uri, s.commander_art_uri, s.commander_color_identity)
   from public.decks s where s.id = 'c1000000-0000-4000-8000-000000000001'),
  'fork_deck() copies every commander column');
select is(
  (select count(*) from public.deck_cards where deck_id = (select id from ben_fork)),
  1::bigint, 'fork_deck() still copies the card list (commander is not a deck card)');
select lives_ok($$
  update public.decks set commander_name = 'Ben Pick', commander_type_line = 'Legendary Creature — Rat Rogue'
  where id = (select id from ben_fork)$$,
  'the fork owner can change the commander on their branch');
select is(
  (select commander_name from public.decks where id = 'c1000000-0000-4000-8000-000000000001'),
  'Test Legend', 'changing the branch commander leaves the source alone');
select lives_ok($$
  create temp table ben_fork_modern on commit drop as
    select public.fork_deck('c1000000-0000-4000-8000-000000000004') as id$$,
  'a friend forks the public modern deck');
select is(
  (select commander_scryfall_id from public.decks where id = (select id from ben_fork_modern)),
  null, 'a fork of a non-Commander deck has no commander');

-- ---------------------------------------------------------------------------
-- Stranger (cat) and anon: read only where the deck is readable
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  (select commander_name from public.decks where id = 'c1000000-0000-4000-8000-000000000001'),
  'Test Legend', 'a stranger reads the commander of a public deck');
select is(
  (select count(*) from public.decks where id = 'c1000000-0000-4000-8000-000000000002'),
  0::bigint, 'a stranger cannot see a friends-only deck or its commander');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select is(
  (select commander_name from public.decks where id = 'c1000000-0000-4000-8000-000000000001'),
  'Test Legend', 'anon reads the commander of a public deck');
select is(
  (select count(*) from public.decks where commander_name is not null
     and owner_id = 'c0000000-0000-4000-8000-000000000001'),
  1::bigint, 'anon sees only the public deck''s commander');
select throws_ok($$
  update public.decks set commander_name = null, commander_scryfall_id = null, commander_type_line = null
  where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'anon cannot update a commander (no UPDATE grant)');

reset role;
select is(
  (select commander_name from public.decks where id = 'c1000000-0000-4000-8000-000000000001'),
  'Test Legend', 'after all non-owner attempts the public deck keeps its commander');

select * from finish();
rollback;
