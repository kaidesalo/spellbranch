-- Spellbranch: deck boards (014).
--
-- board is main, side, or maybe. Existing rows and omitted inserts land on
-- main. The same printing may exist once per board. Only main is color-checked.
-- fork_deck and copy_deck copy board. A non-owner still cannot write.
-- Rolled back. Apply 001-014 before this file (014 has its own begin/commit).

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

-- Schema ---------------------------------------------------------------------
select has_column('public', 'deck_cards', 'board', 'deck_cards.board exists');
select col_not_null('public', 'deck_cards', 'board', 'board is required');
select col_has_default('public', 'deck_cards', 'board', 'board has a default');
select ok(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'deck_cards' and column_name = 'board')
    like '%main%',
  'board defaults to main');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.deck_cards'::regclass
      and conname = 'deck_cards_board_check'
      and convalidated
  ),
  'board is checked and validated');
select ok(
  not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.deck_cards'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by u.ord)
        from unnest(c.conkey) with ordinality as u(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      ) = array['deck_id', 'scryfall_id']::text[]
  ),
  'a printing is no longer unique across the whole deck');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.deck_cards'::regclass
      and conname = 'deck_cards_deck_id_scryfall_id_board_key'
  ),
  'a printing is unique per board');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.deck_cards'::regclass),
  'RLS stays enabled on deck_cards');
select policies_are(
  'public', 'deck_cards',
  array['View deck cards with deck access', 'Owners manage deck cards'],
  'deck_cards policies are unchanged');
select has_trigger(
  'public', 'deck_cards', 'deck_cards_category_same_deck',
  'the category same-deck trigger is intact');
select has_trigger(
  'public', 'deck_cards', 'deck_cards_fit_deck_colors',
  'the card color trigger is intact');
select ok(
  pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) ~ 'cards\.board'
  and pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) ~ 'coalesce\(color_identity',
  'fork_deck() copies board and still coalesces color identity; if not, re-run 014 after 002/006/008/010/013');
select ok(
  pg_get_functiondef('public.copy_deck(uuid)'::regprocedure) ~ 'cards\.board',
  'copy_deck() copies board; if not, re-run 014 after 010 or 013');
select ok(
  not (select prosecdef from pg_proc where oid = 'public.fork_deck(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.copy_deck(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.deck_card_fits_colors()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.deck_colors_fit_cards()'::regprocedure),
  'fork, copy, and the color triggers stay security invoker');

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c1400000-0000-4000-8000-000000000001','authenticated','authenticated','boards.ann@example.test','{"username":"boards_ann"}'),
 ('c1400000-0000-4000-8000-000000000002','authenticated','authenticated','boards.bob@example.test','{"username":"boards_bob"}');

insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, colors) values
 ('c1410000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','private dimir','modern','','private', false, array['U','B']),
 ('c1410000-0000-4000-8000-000000000002','c1400000-0000-4000-8000-000000000001','public dimir','modern','','public', true, array['U','B']);

insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity)
values (
  'c1410000-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'Opt', 'Instant', array['U'], array['U'], 1
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1400000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select board from public.deck_cards
    where deck_id = 'c1410000-0000-4000-8000-000000000001'
      and scryfall_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'main',
  'a card inserted without a board is main');

select throws_ok(
  $$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
    values ('c1410000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000010','Null Board','Instant','{}','{}',1, null)$$,
  '23502', null,
  'an explicit null board is refused');

select throws_ok(
  $$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
    values ('c1410000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000011','Extra','Instant','{}','{}',1, 'extra')$$,
  '23514', null,
  'a board outside main, side, and maybe is refused');

select lives_ok(
  $$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
    values ('c1410000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Opt','Instant', array['U'], array['U'], 1, 'side')$$,
  'the same printing can sit on a second board');

select throws_ok(
  $$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
    values ('c1410000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Opt','Instant', array['U'], array['U'], 1, 'main')$$,
  '23505', null,
  'the same printing cannot be inserted twice on one board');

select lives_ok(
  $$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
    values ('c1410000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','Lightning Bolt','Instant', array['R'], array['R'], 1, 'side')$$,
  'an off-color card is allowed on the sideboard');

select throws_matching(
  $$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
    values ('c1410000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','Shock','Instant', array['R'], array['R'], 1, 'main')$$,
  'deck colors',
  'an off-color card is still refused on the mainboard');

select lives_ok(
  $$update public.deck_cards set quantity = 4 where deck_id = 'c1410000-0000-4000-8000-000000000001' and card_name = 'Lightning Bolt' and board = 'side'$$,
  'raising a sideboard quantity is not color-checked');

select throws_matching(
  $$update public.deck_cards set board = 'main' where deck_id = 'c1410000-0000-4000-8000-000000000001' and card_name = 'Lightning Bolt' and board = 'side'$$,
  'deck colors',
  'moving an off-color card onto the mainboard is refused');

select lives_ok(
  $$update public.decks set colors = array['U'] where id = 'c1410000-0000-4000-8000-000000000001'$$,
  'narrowing deck colors ignores the off-color sideboard');

select lives_ok(
  $$update public.deck_cards set board = 'maybe' where deck_id = 'c1410000-0000-4000-8000-000000000001' and card_name = 'Opt' and board = 'main'$$,
  'an on-color mainboard card can move to the maybeboard');
select is(
  (select board from public.deck_cards where card_name = 'Opt' and scryfall_id = 'aaaaaaaa-0000-4000-8000-000000000001' and board = 'maybe'),
  'maybe',
  'that row is now the maybeboard');

-- Public deck: category survives a board change; fork and copy keep board.
insert into public.deck_categories (id, deck_id, name, position)
values ('c1420000-0000-4000-8000-000000000001', 'c1410000-0000-4000-8000-000000000002', 'Draw', 1000);
insert into public.deck_cards (
  id, deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, category_id, board
) values
 ('c1430000-0000-4000-8000-000000000001','c1410000-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000004','Counterspell','Instant', array['U'], array['U'], 1,
  'c1420000-0000-4000-8000-000000000001', 'main'),
 ('c1430000-0000-4000-8000-000000000002','c1410000-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000002','Lightning Bolt','Instant', array['R'], array['R'], 1,
  null, 'side');

update public.deck_cards
set board = 'maybe'
where id = 'c1430000-0000-4000-8000-000000000001';
select is(
  (select category_id::text from public.deck_cards where id = 'c1430000-0000-4000-8000-000000000001'),
  'c1420000-0000-4000-8000-000000000001',
  'moving off the mainboard keeps the category');
update public.deck_cards
set board = 'main'
where id = 'c1430000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.fork_deck('c1410000-0000-4000-8000-000000000002')$$,
  'the owner can fork a deck that has a sideboard');
select is(
  (select cards.board from public.deck_cards cards
    join public.decks d on d.id = cards.deck_id
    where d.forked_from_id = 'c1410000-0000-4000-8000-000000000002'
      and cards.card_name = 'Lightning Bolt'),
  'side',
  'fork_deck copies the sideboard');
select is(
  (select cards.category_id = c.id
   from public.deck_cards cards
   join public.decks d on d.id = cards.deck_id
   join public.deck_categories c on c.deck_id = d.id and c.name = 'Draw'
   where d.forked_from_id = 'c1410000-0000-4000-8000-000000000002'
     and cards.card_name = 'Counterspell'
     and cards.board = 'main'),
  true,
  'fork_deck still copies the mainboard category');

select lives_ok(
  $$select public.copy_deck('c1410000-0000-4000-8000-000000000002')$$,
  'the owner can copy a deck that has a sideboard');
select is(
  (select cards.board from public.deck_cards cards
    join public.decks d on d.id = cards.deck_id
    where d.owner_id = 'c1400000-0000-4000-8000-000000000001'
      and d.name = 'public dimir (copy)'
      and cards.card_name = 'Lightning Bolt'),
  'side',
  'copy_deck copies the sideboard');

-- A viewer can read a public board and cannot write it.
set local "request.jwt.claims" = '{"sub":"c1400000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select board from public.deck_cards where id = 'c1430000-0000-4000-8000-000000000002'),
  'side',
  'a viewer of a public deck can read which board a card is on');
update public.deck_cards set board = 'main' where id = 'c1430000-0000-4000-8000-000000000002';
select is(
  (select board from public.deck_cards where id = 'c1430000-0000-4000-8000-000000000002'),
  'side',
  'a non-owner update matches no deck_cards rows');
select is(
  (select count(*) from public.deck_cards where deck_id = 'c1410000-0000-4000-8000-000000000001'),
  0::bigint,
  'a non-owner cannot read cards on a private deck');

-- Mainboard still blocks a color narrowing. Planted with triggers off.
reset role;
set local session_replication_role = replica;
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, colors) values
 ('c1410000-0000-4000-8000-000000000003','c1400000-0000-4000-8000-000000000001','narrow','modern','','private', false, array['U','B']);
insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity, board)
values (
  'c1410000-0000-4000-8000-000000000003',
  'aaaaaaaa-0000-4000-8000-000000000005',
  'Shock', 'Instant', array['R'], array['R'], 1, 'main'
);
set local session_replication_role = origin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1400000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.decks set colors = array['U'] where id = 'c1410000-0000-4000-8000-000000000003'$$,
  '23514', null,
  'narrowing deck colors still refuses an off-color mainboard card');

select * from finish();
rollback;
