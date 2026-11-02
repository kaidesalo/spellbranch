-- Spellbranch: migration 008 (deck colors). Run after 001-008 are applied
-- (008 has its own begin/commit, so it isn't \ir'd from inside this test's
-- transaction). Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(68);

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
select ok(not p.prosecdef, format('%s runs as the caller (security invoker)', p.proname))
from pg_proc p
where p.oid in ('public.deck_card_fits_colors()'::regprocedure, 'public.deck_colors_fit_cards()'::regprocedure,
                'public.deck_inherit_fork_colors()'::regprocedure)
order by p.proname;
-- Guard: 002 and 006 define an older fork_deck() that copies no card
-- identity. If either was re-run without 008 after it, this fails: re-run 008.
select ok(pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) ~ 'coalesce\(color_identity',
          'fork_deck() is 008''s (copies card color identity); if not, re-run 008 after 002/006');

-- Fixtures (as postgres) ----------------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c8000000-0000-4000-8000-000000000001','authenticated','authenticated','dc.ann@example.test','{"username":"dc_ann"}'),
 ('c8000000-0000-4000-8000-000000000002','authenticated','authenticated','dc.bob@example.test','{"username":"dc_bob"}');
insert into public.decks (id, owner_id, name, format, visibility, colors) values
 ('c8100000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','dimir','commander','private', array['U','B']),
 ('c8100000-0000-4000-8000-000000000002','c8000000-0000-4000-8000-000000000001','legacy','modern','private', null),
 ('c8100000-0000-4000-8000-000000000003','c8000000-0000-4000-8000-000000000001','colorless','modern','private', '{}'),
 ('c8100000-0000-4000-8000-000000000004','c8000000-0000-4000-8000-000000000001','public dimir','modern','public', array['U','B']),
 ('c8100000-0000-4000-8000-000000000005','c8000000-0000-4000-8000-000000000001','empty grixis','modern','private', array['U','B','R']);

select is((select colors from public.decks where name = 'legacy'), null::text[],
  'a deck without colors stays NULL (unrestricted)');

-- An off-color card left over from before (planted with triggers off).
set local session_replication_role = replica;
insert into public.deck_cards (id, deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity) values
 ('c8200000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001','Lightning Bolt','Instant', array['R'], array['R'], 2),
-- A card added before 008 (no identity), off-color by its colors.
 ('c8200000-0000-4000-8000-000000000002','c8100000-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000008','Old Shock','Instant', array['R'], null, 2),
-- A legacy on-color card, for the fork test.
 ('c8200000-0000-4000-8000-000000000003','c8100000-0000-4000-8000-000000000004',
  'aaaaaaaa-0000-4000-8000-000000000009','Old Opt','Instant', array['U'], null, 1);
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
select throws_matching($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000006','Old Bolt','Instant', array['R'], null, 1)$$,
  'needs a color identity', 'a new card from the API must carry a color identity (I1)');
select throws_matching($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000006','Old Bolt','Instant', '{}', null, 1)$$,
  'needs a color identity', '...so NULL identity + colorless colors can''t slip an off-color card in');
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
select throws_ok($$update public.deck_cards set quantity = 3 where card_name = 'Old Shock'$$,
  '23514', null, 'a legacy card without identity is checked by its colors');
select lives_ok($$update public.deck_cards set quantity = 1 where card_name = 'Old Shock'$$,
  'a legacy card without identity can still be cut down (its NULL is kept)');
select throws_matching($$update public.deck_cards set color_identity = null where card_name = 'Counterspell'$$,
  'needs a color identity', 'a stored identity can''t be cleared back to NULL');
select lives_ok($$delete from public.deck_cards where card_name = 'Old Shock'$$,
  'removing a legacy off-color card is allowed');

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
select public.fork_deck('c8100000-0000-4000-8000-000000000004') as legacy_fork_id \gset
select is((select c.color_identity from public.deck_cards c
           where c.deck_id = :'legacy_fork_id' and c.card_name = 'Old Opt'),
  array['U'], 'fork_deck() gives a legacy card its colors as identity');
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

-- A stranger writing cards into someone else's deck gets 42501 whatever the
-- card's identity, so the error can't reveal whether a private deck exists
-- or what its colors are (Cipher, PR #14 L1).
select throws_ok(format($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values (%L, 'bbbbbbbb-0000-4000-8000-000000000001', 'Probe', 'Instant', %L, %L, 1)$$, d, ci, ci),
  '42501', null, format('stranger insert into %s deck with identity %s: 42501', v, ci))
from (values ('c8100000-0000-4000-8000-000000000001', 'a private colored', '{R}'),
             ('c8100000-0000-4000-8000-000000000001', 'a private colored', '{U}'),
             ('c8100000-0000-4000-8000-000000000001', 'a private colored', '{}'),
             ('c8100000-0000-4000-8000-000000000002', 'a private uncolored', '{R}'),
             ('c8100000-0000-4000-8000-000000000004', 'a public colored', '{R}'),
             ('c8100000-0000-4000-8000-000000000004', 'a public colored', '{U}'),
             ('c8100000-0000-4000-8000-0000000000ff', 'a nonexistent', '{R}')) as t(d, v, ci);
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'Probe', 'Instant', '{R}', null, 1)$$,
  '42501', null, 'stranger insert with no identity: 42501 too');
select is((select count(*)::int from public.deck_cards where card_name = 'Probe'), 0, 'no probe card was written');
update public.decks set colors = array['W'] where id = 'c8100000-0000-4000-8000-000000000004';
update public.deck_cards set quantity = 99 where deck_id = 'c8100000-0000-4000-8000-000000000004';
reset role;
select is((select colors from public.decks where id = 'c8100000-0000-4000-8000-000000000004'), array['U','B'],
  'a stranger''s colors update on a public deck changes nothing');
select is((select max(quantity)::int from public.deck_cards where deck_id = 'c8100000-0000-4000-8000-000000000004'), 1,
  'a stranger''s quantity update on a public deck changes nothing');
set local role authenticated;

-- The owner's rules are unchanged under RLS (the owner reads their whole deck).
set local "request.jwt.claims" = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_matching($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
  values ('c8100000-0000-4000-8000-000000000004','bbbbbbbb-0000-4000-8000-000000000003','Shock','Instant', array['R'], array['R'], 1)$$,
  'outside the deck colors', 'the owner still gets 23514 for an off-color card');
select throws_matching($$update public.decks set colors = array['W'] where id = 'c8100000-0000-4000-8000-000000000004'$$,
  'outside the new deck colors', 'the owner still can''t narrow past a card');

-- Re-running 006 brings back its fork_deck() (no colors, no card identity).
-- Forks still keep the colors through decks_inherit_fork_colors, forking a
-- deck with cards is refused (loudly) until 008 runs again, the guard above
-- spots it, and 006 leaves 008's CHECKs alone.
reset role;
\ir ../migrations/006_deck_commander.sql
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) !~ 'coalesce\(color_identity',
  'after re-running 006, the fork_deck() guard would fail (it spots the old function)');
select throws_matching($$select public.fork_deck('c8100000-0000-4000-8000-000000000001')$$,
  'needs a color identity', 'after re-running 006, forking a deck with cards is refused until 008 runs again');
select public.fork_deck('c8100000-0000-4000-8000-000000000005') as old_fork_id \gset
select is((select colors from public.decks where id = :'old_fork_id'),
  array['U','B','R'], 'after re-running 006, a fork still keeps the deck colors');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.decks'::regclass and conname = 'decks_commander_fits_colors' and convalidated),
          'after re-running 006, decks_commander_fits_colors is still there');

select * from finish();
rollback;
