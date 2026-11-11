-- Spellbranch: deck categories (013).
--
-- Owner can create and reorder. A non-owner cannot write. A viewer can read
-- only when can_view_deck already shows them the deck. Deleting a category
-- clears category_id and leaves the card. fork_deck and copy_deck copy the
-- categories and the assignments. Rolled back; does not depend on seed.sql.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

-- Schema ---------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.deck_categories'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.deck_type_orders'::regclass),
  'RLS is enabled on deck_categories and deck_type_orders');

select has_column('public', 'deck_cards', 'category_id', 'deck_cards.category_id exists');
select col_is_null('public', 'deck_cards', 'category_id', 'category_id is nullable');

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'deck_cards_category_id_fkey' and confdeltype = 'n'
  ),
  'deleting a category sets category_id to null');

select policies_are(
  'public', 'deck_categories',
  array[
    'View deck categories with deck access',
    'Owners insert deck categories',
    'Owners update deck categories',
    'Owners delete deck categories'
  ],
  'deck_categories policies');

select policies_are(
  'public', 'deck_type_orders',
  array[
    'View deck type order with deck access',
    'Owners insert deck type order',
    'Owners update deck type order',
    'Owners delete deck type order'
  ],
  'deck_type_orders policies');

select ok(
  has_table_privilege('anon', 'public.deck_categories', 'SELECT')
  and not has_table_privilege('anon', 'public.deck_categories', 'INSERT')
  and not has_table_privilege('anon', 'public.deck_categories', 'UPDATE')
  and not has_table_privilege('anon', 'public.deck_categories', 'DELETE')
  and has_table_privilege('authenticated', 'public.deck_categories', 'SELECT')
  and has_table_privilege('authenticated', 'public.deck_categories', 'INSERT')
  and has_table_privilege('authenticated', 'public.deck_categories', 'UPDATE')
  and has_table_privilege('authenticated', 'public.deck_categories', 'DELETE')
  and has_table_privilege('anon', 'public.deck_type_orders', 'SELECT')
  and not has_table_privilege('anon', 'public.deck_type_orders', 'INSERT'),
  'anon can read category tables; only authenticated can write them');

select ok(
  not has_function_privilege('anon', 'public.set_deck_section_order(uuid, text[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_deck_section_order(uuid, text[])', 'EXECUTE')
  and not (select prosecdef from pg_proc where oid = 'public.set_deck_section_order(uuid, text[])'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.deck_card_category_same_deck()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.fork_deck(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.copy_deck(uuid)'::regprocedure)
  and exists (
    select 1 from pg_proc p
    where p.oid = 'public.set_deck_section_order(uuid, text[])'::regprocedure
      and 'search_path=""' = any (p.proconfig)
  )
  and exists (
    select 1 from pg_proc p
    where p.oid = 'public.deck_card_category_same_deck()'::regprocedure
      and 'search_path=""' = any (p.proconfig)
  ),
  'reorder, the same-deck trigger, fork_deck, and copy_deck are security invoker with an empty search_path');

select ok(
  pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) ~ 'insert into public.deck_categories'
  and pg_get_functiondef('public.copy_deck(uuid)'::regprocedure) ~ 'insert into public.deck_categories'
  and pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) ~ 'category_id'
  and pg_get_functiondef('public.copy_deck(uuid)'::regprocedure) ~ 'coalesce\(color_identity'
  and pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) !~ 'select \*'
  and pg_get_functiondef('public.copy_deck(uuid)'::regprocedure) !~ 'select \*',
  'fork_deck and copy_deck copy categories with an explicit column list');

-- Fixtures (as postgres) ----------------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('c1300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cat.ann@example.test', '{"username":"cat_ann"}'),
  ('c1300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cat.ben@example.test', '{"username":"cat_ben"}'),
  ('c1300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'cat.cat@example.test', '{"username":"cat_cat"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('c1300000-0000-4000-8000-000000000002', 'c1300000-0000-4000-8000-000000000001', 'accepted');

insert into public.decks (id, owner_id, name, format, visibility, allow_forks) values
  ('c1310000-0000-4000-8000-000000000001', 'c1300000-0000-4000-8000-000000000001', 'Public', 'modern', 'public', true),
  ('c1310000-0000-4000-8000-000000000002', 'c1300000-0000-4000-8000-000000000001', 'Friends', 'modern', 'friends', true),
  ('c1310000-0000-4000-8000-000000000003', 'c1300000-0000-4000-8000-000000000001', 'Private', 'modern', 'private', false);

insert into public.deck_categories (id, deck_id, name, position) values
  ('c1320000-0000-4000-8000-000000000001', 'c1310000-0000-4000-8000-000000000001', 'Ramp', 1000),
  ('c1320000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000002', 'Friends only', 1000);

insert into public.deck_cards (id, deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, category_id) values
  ('c1330000-0000-4000-8000-000000000001', 'c1310000-0000-4000-8000-000000000001',
   'sol-ring', 'Sol Ring', 'Artifact', '{}', '{}', 1, 'c1320000-0000-4000-8000-000000000001'),
  ('c1330000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000001',
   'bolt', 'Lightning Bolt', 'Instant', '{}', '{}', 1, null);

insert into public.deck_type_orders (deck_id, type_key, position) values
  ('c1310000-0000-4000-8000-000000000001', 'Artifact', 0);

-- Ann owns the decks --------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1300000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$insert into public.deck_categories (id, deck_id, name, position)
    values ('c1320000-0000-4000-8000-000000000003', 'c1310000-0000-4000-8000-000000000001', 'Card draw', 1001)$$,
  'owner can create a category');

select throws_ok(
  $$insert into public.deck_categories (deck_id, name, position)
    values ('c1310000-0000-4000-8000-000000000001', 'card draw', 1002)$$,
  '23505', null, 'category names are unique per deck, case-insensitively');

select throws_ok(
  $$insert into public.deck_categories (deck_id, name, position)
    values ('c1310000-0000-4000-8000-000000000003', ' Ramp', 1000)$$,
  '23514', null, 'a category name must already be trimmed');

select throws_ok(
  $$insert into public.deck_categories (deck_id, name, position)
    values ('c1310000-0000-4000-8000-000000000003', repeat('a', 41), 1000)$$,
  '23514', null, 'a category name longer than 40 characters is refused');

select lives_ok(
  format(
    $$insert into public.deck_categories (deck_id, name, position)
      values ('c1310000-0000-4000-8000-000000000003', %L, 1000)$$,
    repeat('👍', 40)
  ),
  '40 emoji is 40 characters');

select throws_ok(
  $$update public.deck_cards
      set category_id = 'c1320000-0000-4000-8000-000000000002'
    where id = 'c1330000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a card cannot be filed under another deck''s category');

select lives_ok(
  $$select public.set_deck_section_order(
      'c1310000-0000-4000-8000-000000000001',
      array[
        'c1320000-0000-4000-8000-000000000001',
        'c1320000-0000-4000-8000-000000000003',
        'type:Instant'
      ]::text[])$$,
  'owner can reorder categories and type groups');

select is(
  (select position from public.deck_categories where id = 'c1320000-0000-4000-8000-000000000001'),
  0, 'reorder writes the category position');
select is(
  (select position from public.deck_type_orders
    where deck_id = 'c1310000-0000-4000-8000-000000000001' and type_key = 'Instant'),
  2, 'reorder writes the type-group position');

select throws_ok(
  $$select public.set_deck_section_order(
      'c1310000-0000-4000-8000-000000000001',
      array['c1320000-0000-4000-8000-000000000001']::text[])$$,
  '22023', null, 'a reorder that drops a category is refused');

-- The reorder above listed only Ramp, so Card draw must be included. It was
-- refused and rolled back inside the statement, so both categories remain.
select is(
  (select count(*) from public.deck_categories
    where deck_id = 'c1310000-0000-4000-8000-000000000001'),
  2::bigint, 'a refused reorder does not drop a category');

select lives_ok(
  $$delete from public.deck_categories where id = 'c1320000-0000-4000-8000-000000000001'$$,
  'owner can delete a category');
select is(
  (select count(*) from public.deck_cards where id = 'c1330000-0000-4000-8000-000000000001'),
  1::bigint, 'deleting a category does not delete its card');
select ok(
  (select category_id is null from public.deck_cards where id = 'c1330000-0000-4000-8000-000000000001'),
  'the card falls back to an unassigned type group');

-- Put Ramp back so the fork still has something to copy.
insert into public.deck_categories (id, deck_id, name, position)
  values ('c1320000-0000-4000-8000-000000000001', 'c1310000-0000-4000-8000-000000000001', 'Ramp', 1000);
update public.deck_cards
  set category_id = 'c1320000-0000-4000-8000-000000000001'
  where id = 'c1330000-0000-4000-8000-000000000001';

-- Ben can read what he can already see, and cannot write -----------------
set local "request.jwt.claims" = '{"sub":"c1300000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000001'),
  2::bigint, 'a viewer of a public deck can read its categories');
select is(
  (select count(*) from public.deck_type_orders where deck_id = 'c1310000-0000-4000-8000-000000000001'),
  1::bigint, 'a viewer of a public deck can read its type order');
select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000002'),
  1::bigint, 'a friend can read categories on a friends-only deck');
select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000003'),
  0::bigint, 'a non-owner cannot read categories on a private deck');

select throws_ok(
  $$insert into public.deck_categories (deck_id, name, position)
    values ('c1310000-0000-4000-8000-000000000001', 'Stolen', 1002)$$,
  '42501', null, 'a non-owner cannot create a category');

update public.deck_categories set name = 'Stolen' where id = 'c1320000-0000-4000-8000-000000000001';
select is(
  (select name from public.deck_categories where id = 'c1320000-0000-4000-8000-000000000001'),
  'Ramp', 'a non-owner update matches no category rows');

update public.deck_cards set category_id = null where id = 'c1330000-0000-4000-8000-000000000001';
select is(
  (select category_id::text from public.deck_cards where id = 'c1330000-0000-4000-8000-000000000001'),
  'c1320000-0000-4000-8000-000000000001', 'a non-owner cannot clear a card assignment');

delete from public.deck_categories where id = 'c1320000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.deck_categories where id = 'c1320000-0000-4000-8000-000000000001'),
  1::bigint, 'a non-owner delete matches no category rows');

select throws_ok(
  $$select public.set_deck_section_order(
      'c1310000-0000-4000-8000-000000000001',
      array['c1320000-0000-4000-8000-000000000001']::text[])$$,
  '42501', null, 'a non-owner cannot reorder');

select lives_ok(
  $$select public.fork_deck('c1310000-0000-4000-8000-000000000001')$$,
  'fork_deck copies a deck the caller can fork');

select is(
  (select count(*) from public.deck_categories c
    join public.decks d on d.id = c.deck_id
    where d.owner_id = 'c1300000-0000-4000-8000-000000000002'
      and d.forked_from_id = 'c1310000-0000-4000-8000-000000000001'
      and c.name = 'Ramp'),
  1::bigint, 'the fork has its own Ramp category');

select is(
  (select cards.category_id = c.id
   from public.deck_cards cards
   join public.decks d on d.id = cards.deck_id
   join public.deck_categories c on c.deck_id = d.id and c.name = 'Ramp'
   where d.owner_id = 'c1300000-0000-4000-8000-000000000002'
     and d.forked_from_id = 'c1310000-0000-4000-8000-000000000001'
     and cards.card_name = 'Sol Ring'),
  true, 'the forked Sol Ring points at the new category, not the source one');

select is(
  (select count(*) from public.deck_type_orders t
    join public.decks d on d.id = t.deck_id
    where d.owner_id = 'c1300000-0000-4000-8000-000000000002'
      and d.forked_from_id = 'c1310000-0000-4000-8000-000000000001'
      and t.type_key = 'Instant'),
  1::bigint, 'the fork copies the type-group order');

select lives_ok(
  $$select public.copy_deck('c1310000-0000-4000-8000-000000000001')$$,
  'copy_deck copies a deck the caller can copy');

select is(
  (select count(*) from public.deck_categories c
    join public.deck_cards cards on cards.category_id = c.id
    join public.decks d on d.id = c.deck_id
    where d.owner_id = 'c1300000-0000-4000-8000-000000000002'
      and d.forked_from_id is null
      and c.name = 'Ramp'
      and cards.card_name = 'Sol Ring'),
  1::bigint, 'the copy has Ramp and Sol Ring is assigned to the copy''s category');

-- Cat is not a friend -------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"c1300000-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000002'),
  0::bigint, 'someone who cannot view the deck cannot read its categories');
select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000001'),
  2::bigint, 'a stranger can still read a public deck''s categories');

-- Anon ----------------------------------------------------------------------
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000001'),
  2::bigint, 'anon can read categories on a public deck');
select is(
  (select count(*) from public.deck_categories where deck_id = 'c1310000-0000-4000-8000-000000000003'),
  0::bigint, 'anon cannot read categories on a private deck');
select throws_ok(
  $$insert into public.deck_categories (deck_id, name, position)
    values ('c1310000-0000-4000-8000-000000000001', 'Anon', 1002)$$,
  '42501', null, 'anon cannot create a category');

-- Cap, back as the owner ----------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1300000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $cap$
    do $body$
    declare i integer;
    begin
      for i in 1..39 loop
        insert into public.deck_categories (deck_id, name, position)
        values ('c1310000-0000-4000-8000-000000000003', 'Pile ' || i, 2000 + i);
      end loop;
    end
    $body$
  $cap$,
  'the owner can fill the deck up to 40 categories');

select throws_ok(
  $$insert into public.deck_categories (deck_id, name, position)
    values ('c1310000-0000-4000-8000-000000000003', 'One more', 3000)$$,
  '23514', null, 'the 41st category is refused and the cards are untouched');

select * from finish();
rollback;
