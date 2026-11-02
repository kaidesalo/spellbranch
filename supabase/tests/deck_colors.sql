-- Spellbranch: migration 008 (deck colors). Run after 001-008 are applied
-- (008 has its own begin/commit, so it isn't \ir'd from inside this test's
-- transaction). Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(43);

-- Schema --------------------------------------------------------------------
select has_column('public', 'decks', 'colors', 'decks.colors exists');
select col_is_null('public', 'decks', 'colors', 'decks.colors is nullable (NULL = no colors picked)');
select has_column('public', 'deck_cards', 'color_identity', 'deck_cards.color_identity exists');

select ok(exists (select 1 from pg_constraint
                  where conrelid = t::regclass and conname = c and convalidated),
          format('%s exists and is validated', c))
from (values ('public.decks', 'decks_colors_wubrg'),
             ('public.decks', 'decks_commander_fits_colors'),
             ('public.deck_cards', 'deck_cards_color_identity_wubrg')) as v(t, c);

select has_trigger('public', 'deck_cards', 'deck_cards_fit_deck_colors', 'card trigger exists');
select has_trigger('public', 'decks', 'decks_colors_fit_cards', 'deck colors trigger exists');
select has_trigger('public', 'decks', 'decks_inherit_fork_colors', 'fork colors trigger exists');
select ok(not has_function_privilege('authenticated', 'public.deck_card_fits_colors()', 'execute')
          and not has_function_privilege('anon', 'public.deck_colors_fit_cards()', 'execute'),
          'trigger functions are not callable by API roles');

-- Fixtures (as postgres) ----------------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c8000000-0000-4000-8000-000000000001','authenticated','authenticated','dc.ann@example.test','{"username":"dc_ann"}'),
 ('c8000000-0000-4000-8000-000000000002','authenticated','authenticated','dc.bob@example.test','{"username":"dc_bob"}');
insert into public.decks (id, owner_id, name, format, visibility, colors) values
 ('c8100000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','dimir','commander','private', array['U','B']),
 ('c8100000-0000-4000-8000-000000000002','c8000000-0000-4000-8000-000000000001','legacy','modern','private', null),
 ('c8100000-0000-4000-8000-000000000003','c8000000-0000-4000-8000-000000000001','colorless','modern','private', '{}');

select is((select colors from public.decks where name = 'legacy'), null::text[],
  'a deck without colors stays NULL (unrestricted)');

-- An off-color card left over from before (planted with triggers off).
set local session_replication_role = replica;
insert into public.deck_cards (id, deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity) values
 ('c8200000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001','Lightning Bolt','Instant', array['R'], array['R'], 2);
set local session_replication_role = origin;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Shape of decks.colors -----------------------------------------------------
select throws_ok($$update public.decks set colors = array['W','W'] where name = 'legacy'$$,
  '23514', null, 'duplicate deck colors are refused');
select throws_ok($$update public.decks set colors = '{{W,U},{B,R}}'::text[] where name = 'legacy'$$,
  '23514', null, 'a 2-D colors array is refused');
select throws_ok($$update public.decks set colors = array['X'] where name = 'legacy'$$,
  '23514', null, 'a non-WUBRG color is refused');
select throws_ok($$update public.decks set colors = array['W', null] where name = 'legacy'$$,
  '23514', null, 'a NULL entry is refused');
select throws_ok($$update public.deck_cards set color_identity = array['U','U'] where card_name = 'Lightning Bolt'$$,
  '23514', null, 'duplicate card identity colors are refused');

-- Adding cards --------------------------------------------------------------
select throws_matching($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','Shock','Instant', array['R'], array['R'], 1)$$,
  'deck colors', 'an off-color card is refused (message names the deck colors)');
select lives_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','Counterspell','Instant', array['U'], array['U'], 1)$$,
  'an on-color card is added');
select lives_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000004','Sol Ring','Artifact', '{}', '{}', 1)$$,
  'a colorless card fits a colored deck');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000005','Kitchen Finks','Creature', array['G','W'], array['G','W'], 1)$$,
  '23514', null, 'a multicolor off-color card is refused');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000006','Old Bolt','Instant', array['R'], null, 1)$$,
  '23514', null, 'without a stored identity the card colors are checked');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000007','Black Card With Red Ability','Creature', array['B'], array['B','R'], 1)$$,
  '23514', null, 'identity, not card colors, decides (a black card with a red ability)');
select lives_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000004','Sol Ring','Artifact', '{}', '{}', 1)$$,
  'a Colorless deck takes colorless cards');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000003','Counterspell','Instant', array['U'], array['U'], 1)$$,
  '23514', null, 'a Colorless deck refuses colored cards');
select lives_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002','Shock','Instant', array['R'], array['R'], 1)$$,
  'a deck without colors takes any card');

-- Quantities of an off-color card --------------------------------------------
select throws_ok($$update public.deck_cards set quantity = 3 where card_name = 'Lightning Bolt'$$,
  '23514', null, 'raising an off-color card''s quantity is refused');
select lives_ok($$update public.deck_cards set quantity = 1 where card_name = 'Lightning Bolt'$$,
  'lowering an off-color card''s quantity is allowed');
select throws_ok($$update public.deck_cards set color_identity = array['R','G'] where card_name = 'Counterspell'$$,
  '23514', null, 'changing a card''s identity to off-color is refused');
select lives_ok($$delete from public.deck_cards where card_name = 'Lightning Bolt'$$,
  'removing an off-color card is allowed');

-- Changing deck colors ------------------------------------------------------
select throws_matching($$update public.decks set colors = array['U'] where name = 'legacy'$$,
  'deck colors', 'picking colors a card doesn''t fit is refused');
select is((select count(*)::int from public.deck_cards where deck_id = 'c8100000-0000-4000-8000-000000000002'),
  1, 'a refused narrowing deletes nothing');
select lives_ok($$update public.decks set colors = array['B','R'] where name = 'legacy'$$,
  'picking colors every card fits works');
select throws_ok($$update public.decks set colors = null where name = 'legacy'$$,
  '23514', null, 'picked colors cannot be cleared back to NULL');
select lives_ok($$update public.decks set colors = array['W','U','B','R','G'] where name = 'legacy'$$,
  'widening works');

-- Commander -----------------------------------------------------------------
select throws_matching($$update public.decks set commander_scryfall_id = '11111111-2222-4333-8444-555555555555',
  commander_name = 'Rakdos, Lord of Riots', commander_type_line = 'Legendary Creature — Demon',
  commander_color_identity = array['B','R'] where name = 'dimir'$$,
  'decks_commander_fits_colors', 'a commander outside the deck colors is refused');
select lives_ok($$update public.decks set commander_scryfall_id = '11111111-2222-4333-8444-555555555556',
  commander_name = 'Lazav', commander_type_line = 'Legendary Creature — Shapeshifter',
  commander_color_identity = array['U','B'] where name = 'dimir'$$,
  'a commander inside the deck colors is set');
select throws_matching($$update public.decks set colors = array['U'] where name = 'dimir'$$,
  'decks_commander_fits_colors', 'narrowing below the commander''s identity is refused');

-- Forks keep the colors ------------------------------------------------------
select public.fork_deck('c8100000-0000-4000-8000-000000000001') as fork_id \gset
select is((select colors from public.decks where id = :'fork_id'),
  array['U','B'], 'fork_deck() copies the deck colors');
select is((select c.color_identity from public.deck_cards c join public.decks d on d.id = c.deck_id
           where d.id = :'fork_id' and c.card_name = 'Counterspell'),
  array['U'], 'fork_deck() copies each card''s color identity');
insert into public.decks (owner_id, name, format, visibility, forked_from_id)
  values ('c8000000-0000-4000-8000-000000000001', 'manual branch', 'modern', 'private',
          'c8100000-0000-4000-8000-000000000003');
select is((select colors from public.decks where name = 'manual branch'), '{}'::text[],
  'a fork inserted without colors inherits the source''s (even with an older fork_deck())');

-- Another user's private deck: refused (002), so no colors can leak through it.
set local "request.jwt.claims" = '{"sub":"c8000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$insert into public.decks (owner_id, name, format, visibility, forked_from_id)
  values ('c8000000-0000-4000-8000-000000000002', 'bob branch', 'modern', 'private',
          'c8100000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a fork of a deck the caller can''t see is refused');

-- Re-running 006 brings back its fork_deck() (no colors); forks still keep
-- them through decks_inherit_fork_colors, and 006 leaves 008's CHECKs alone.
reset role;
\ir ../migrations/006_deck_commander.sql
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.fork_deck('c8100000-0000-4000-8000-000000000001') as old_fork_id \gset
select is((select colors from public.decks where id = :'old_fork_id'),
  array['U','B'], 'after re-running 006, a fork still keeps the deck colors');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.decks'::regclass and conname = 'decks_commander_fits_colors' and convalidated),
          'after re-running 006, decks_commander_fits_colors is still there');

select * from finish();
rollback;
