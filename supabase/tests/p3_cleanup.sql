-- Spellbranch: P3 cleanup (016).
--
-- Collection row cap, atomic printing merges, and the revoked grants.
-- Rolled back. Does not depend on seed.sql.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

select ok(
  not (select prosecdef from pg_proc where oid = 'public.collection_cards_limit()'::regprocedure)
  and exists (
    select 1 from pg_proc p
    where p.oid = 'public.collection_cards_limit()'::regprocedure
      and 'search_path=""' = any (p.proconfig)
  ),
  'collection cap trigger function is security invoker with an empty search_path');

select ok(
  not (select prosecdef from pg_proc where oid = 'public.merge_deck_card_printing(uuid, uuid)'::regprocedure)
  and exists (
    select 1 from pg_proc p
    where p.oid = 'public.merge_deck_card_printing(uuid, uuid)'::regprocedure
      and 'search_path=""' = any (p.proconfig)
  )
  and not (select prosecdef from pg_proc where oid = 'public.merge_collection_card_printing(uuid, uuid)'::regprocedure)
  and exists (
    select 1 from pg_proc p
    where p.oid = 'public.merge_collection_card_printing(uuid, uuid)'::regprocedure
      and 'search_path=""' = any (p.proconfig)
  ),
  'printing merges are security invoker with an empty search_path');

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'collection_cards_limit'
      and tgrelid = 'public.collection_cards'::regclass
      and not tgisinternal
  ),
  'collection_cards_limit fires on insert');

select ok(
  not has_function_privilege('anon', 'public.merge_deck_card_printing(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.merge_deck_card_printing(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.merge_collection_card_printing(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.merge_collection_card_printing(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.collection_cards_limit()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.collection_cards_limit()', 'EXECUTE'),
  'signed-in users can merge their own rows; the cap function is not callable');

select ok(
  not has_table_privilege('authenticated', 'public.comments', 'UPDATE')
  and has_table_privilege('authenticated', 'public.comments', 'SELECT')
  and has_table_privilege('authenticated', 'public.comments', 'INSERT')
  and has_table_privilege('authenticated', 'public.comments', 'DELETE')
  and not has_table_privilege('anon', 'public.friendships', 'SELECT')
  and has_table_privilege('authenticated', 'public.friendships', 'SELECT')
  and not has_table_privilege('anon', 'public.favorite_cards', 'SELECT')
  and has_table_privilege('authenticated', 'public.favorite_cards', 'SELECT'),
  'unused UPDATE and anon SELECT grants are revoked; grants a policy uses remain');

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c1600000-0000-4000-8000-000000000001','authenticated','authenticated','p3.ann@example.test','{"username":"p3_ann"}'),
 ('c1600000-0000-4000-8000-000000000002','authenticated','authenticated','p3.bob@example.test','{"username":"p3_bob"}');

insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, colors) values
 ('c1610000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','public pile','modern','','public', true, null);

insert into public.deck_cards (id, deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board) values
 ('c1620000-0000-4000-8000-000000000001','c1610000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Bolt','Instant','{}','{}',60,'main'),
 ('c1620000-0000-4000-8000-000000000002','c1610000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','Shock','Instant','{}','{}',50,'main'),
 ('c1620000-0000-4000-8000-000000000003','c1610000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','Opt','Instant','{}','{}',3,'side');

insert into public.collection_cards (id, user_id, scryfall_id, card_name, quantity, finish, for_trade, condition) values
 ('c1630000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000011','Bolt',4000,'nonfoil', false, null),
 ('c1630000-0000-4000-8000-000000000002','c1600000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000012','Bolt',7000,'foil', true, 'LP');

-- Someone else cannot merge a visible deck's cards, and nothing changes.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1600000-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.merge_deck_card_printing(
      'c1620000-0000-4000-8000-000000000001',
      'c1620000-0000-4000-8000-000000000002')$$,
  '42501', null,
  'a non-owner cannot merge deck cards');

select is(
  (select quantity from public.deck_cards where id = 'c1620000-0000-4000-8000-000000000001'),
  60,
  'a refused deck merge leaves the target quantity');

select is(
  (select count(*)::int from public.deck_cards where id = 'c1620000-0000-4000-8000-000000000002'),
  1,
  'a refused deck merge leaves the source row');

select throws_ok(
  $$select public.merge_collection_card_printing(
      'c1630000-0000-4000-8000-000000000001',
      'c1630000-0000-4000-8000-000000000002')$$,
  'P0002', null,
  'someone else cannot merge collection rows');

-- Bob cannot see Ann's collection, so count as the table owner.
reset role;
select is(
  (select count(*)::int from public.collection_cards where user_id = 'c1600000-0000-4000-8000-000000000001'),
  2,
  'a refused collection merge leaves both rows');

-- The owner: a missing source and a cross-board pair change nothing.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1600000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.merge_deck_card_printing(
      'c1620000-0000-4000-8000-000000000001',
      'c1620000-0000-4000-8000-000000000099')$$,
  'P0002', null,
  'a missing source refuses the deck merge');

select is(
  (select quantity from public.deck_cards where id = 'c1620000-0000-4000-8000-000000000001'),
  60,
  'a missing source does not change the target');

select throws_ok(
  $$select public.merge_deck_card_printing(
      'c1620000-0000-4000-8000-000000000001',
      'c1620000-0000-4000-8000-000000000003')$$,
  'P0002', null,
  'cards on different boards are not merged');

select is(
  (select quantity from public.deck_cards where id = 'c1620000-0000-4000-8000-000000000003'),
  3,
  'a cross-board refusal leaves the sideboard card');

select lives_ok(
  $$select public.merge_deck_card_printing(
      'c1620000-0000-4000-8000-000000000001',
      'c1620000-0000-4000-8000-000000000002')$$,
  'the owner merges two mainboard printings in one call');

select is(
  (select quantity from public.deck_cards where id = 'c1620000-0000-4000-8000-000000000001'),
  99,
  'the merged quantity is capped at 99');

select is(
  (select count(*)::int from public.deck_cards where id = 'c1620000-0000-4000-8000-000000000002'),
  0,
  'the source row is deleted in the same merge');

select lives_ok(
  $$select public.merge_collection_card_printing(
      'c1630000-0000-4000-8000-000000000001',
      'c1630000-0000-4000-8000-000000000002')$$,
  'the owner merges two collection piles in one call');

select is(
  (select quantity from public.collection_cards where id = 'c1630000-0000-4000-8000-000000000001'),
  9999,
  'the merged collection quantity is capped at 9999');

select is(
  (select for_trade from public.collection_cards where id = 'c1630000-0000-4000-8000-000000000001'),
  true,
  'for trade stays on if either pile was for trade');

select is(
  (select condition from public.collection_cards where id = 'c1630000-0000-4000-8000-000000000001'),
  'LP',
  'a missing condition is filled from the pile that was removed');

select is(
  (select count(*)::int from public.collection_cards where id = 'c1630000-0000-4000-8000-000000000002'),
  0,
  'the source collection row is deleted in the same merge');

-- Cap: 5000 rows, then the next insert is refused and does not stick.
select lives_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, quantity)
    select 'c1600000-0000-4000-8000-000000000001', gen_random_uuid()::text, 'Pile', 1
    from generate_series(1, 4999)$$,
  'the owner can store 5000 collection rows');

select is(
  (select count(*)::int from public.collection_cards where user_id = 'c1600000-0000-4000-8000-000000000001'),
  5000,
  'the cap count includes the merged row');

select throws_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, quantity)
    values ('c1600000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000099', 'One more', 1)$$,
  '23514', null,
  'the 5001st collection row is refused');

select is(
  (select count(*)::int from public.collection_cards where user_id = 'c1600000-0000-4000-8000-000000000001'),
  5000,
  'a refused insert does not leave a row');

set local "request.jwt.claims" = '{"sub":"c1600000-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, quantity)
    values ('c1600000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000098', 'Other', 1)$$,
  'another person is not blocked by the first collection cap');

select * from finish();
rollback;
