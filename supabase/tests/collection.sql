-- Spellbranch: card collection (015).
--
-- Owner can write. A private collection is invisible to everyone else.
-- for_trade rows show up when the owner's setting is public, or friends and
-- the viewer is an accepted friend. Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.collection_cards'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.collection_settings'::regclass),
  'RLS is enabled on collection tables');

select policies_are(
  'public', 'collection_cards',
  array[
    'View collection cards',
    'Owners insert collection cards',
    'Owners update collection cards',
    'Owners delete collection cards'
  ],
  'collection card policies');

select ok(
  has_table_privilege('anon', 'public.collection_cards', 'SELECT')
  and not has_table_privilege('anon', 'public.collection_cards', 'INSERT')
  and has_table_privilege('authenticated', 'public.collection_cards', 'INSERT')
  and has_table_privilege('authenticated', 'public.collection_cards', 'UPDATE')
  and has_table_privilege('authenticated', 'public.collection_cards', 'DELETE')
  and not has_table_privilege('anon', 'public.collection_settings', 'INSERT'),
  'anon can read a collection; only authenticated can write it');

select ok(
  not (select prosecdef from pg_proc where oid = 'public.collection_card_visible(uuid, boolean, uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.collection_cards_keep_owner()'::regprocedure)
  and exists (
    select 1 from pg_proc p
    where p.oid = 'public.collection_card_visible(uuid, boolean, uuid)'::regprocedure
      and 'search_path=""' = any (p.proconfig)
  ),
  'collection visibility runs as the caller with an empty search_path');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_cards'::regclass
      and conname = 'collection_cards_user_scryfall_finish_key'
  ),
  'one row per person, printing, and finish');

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c1500000-0000-4000-8000-000000000001','authenticated','authenticated','col.ann@example.test','{"username":"col_ann"}'),
 ('c1500000-0000-4000-8000-000000000002','authenticated','authenticated','col.bob@example.test','{"username":"col_bob"}'),
 ('c1500000-0000-4000-8000-000000000003','authenticated','authenticated','col.cara@example.test','{"username":"col_cara"}');

insert into public.friendships (requester_id, addressee_id, status) values
 ('c1500000-0000-4000-8000-000000000001', 'c1500000-0000-4000-8000-000000000002', 'accepted');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, type_line, quantity, finish, for_trade)
    values ('c1500000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Lightning Bolt','Instant', 4, 'nonfoil', true)$$,
  'the owner can add a card');
select lives_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, type_line, quantity, finish, for_trade)
    values ('c1500000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','Opt','Instant', 2, 'nonfoil', false)$$,
  'a pile that is not for trade is still stored');
select throws_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, type_line, quantity, finish)
    values ('c1500000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Lightning Bolt','Instant', 1, 'nonfoil')$$,
  '23505', null,
  'the same printing and finish cannot be inserted twice');
select throws_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, type_line, quantity, finish)
    values ('c1500000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','Zero','Instant', 0, 'nonfoil')$$,
  '23514', null,
  'quantity must be greater than zero');
select is(
  (select count(*) from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  2::bigint,
  'the owner sees both piles while the collection is private');

set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  0::bigint,
  'a stranger cannot read a private collection');
select throws_ok(
  $$insert into public.collection_cards (user_id, scryfall_id, card_name, type_line, quantity)
    values ('c1500000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000009','Stolen','Instant', 1)$$,
  '42501', null,
  'a non-owner cannot insert into someone else''s collection');
update public.collection_cards set quantity = 9 where card_name = 'Lightning Bolt';
set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select quantity from public.collection_cards where card_name = 'Lightning Bolt'),
  4,
  'a non-owner update matches no rows');

set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into public.collection_settings (user_id, visibility)
    values ('c1500000-0000-4000-8000-000000000001', 'public')$$,
  'the owner can publish cards marked for trade');

set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select card_name from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  'Lightning Bolt',
  'a public collection shows the for-trade pile only');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select is(
  (select card_name from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  'Lightning Bolt',
  'anonymous visitors can see a public for-trade pile');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$update public.collection_settings set visibility = 'friends' where user_id = 'c1500000-0000-4000-8000-000000000001'$$,
  'the owner can limit the collection to friends');

set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select card_name from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  'Lightning Bolt',
  'an accepted friend sees the for-trade pile');

set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  0::bigint,
  'someone who is not a friend cannot read a friends-only collection');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select is(
  (select count(*) from public.collection_cards where user_id = 'c1500000-0000-4000-8000-000000000001'),
  0::bigint,
  'anonymous visitors cannot read a friends-only collection');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1500000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.collection_cards set user_id = 'c1500000-0000-4000-8000-000000000002' where card_name = 'Lightning Bolt'$$,
  '42501', null,
  'a collection card cannot be moved to another person');

select * from finish();
rollback;
