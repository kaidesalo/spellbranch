-- Spellbranch: length limits and restart_friend_request() (migration 003,
-- Cipher PR #3 review L2 and I1). Run with `supabase test db` (or psql on a
-- db with 001-003 applied). Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','authenticated','authenticated','ll1@example.test','{"username":"ll_ann"}'),
 ('d1000000-0000-4000-8000-000000000002','authenticated','authenticated','ll2@example.test','{"username":"ll_ben"}'),
 ('d1000000-0000-4000-8000-000000000003','authenticated','authenticated','ll3@example.test','{"username":"ll_cat"}');

-- Constraints exist and are validated
select ok(exists (select 1 from pg_constraint where conname = c and convalidated),
          format('%s exists and is validated', c))
  from unnest(array['profiles_bio_length','decks_name_length','decks_notes_length',
                    'deck_cards_text_lengths','deck_cards_colors_valid',
                    'favorite_cards_text_lengths']) as c;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- decks.name / decks.notes
select lives_ok($$insert into public.decks (id, owner_id, name, format, visibility, notes)
  values ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001', repeat('n', 80), 'modern', 'private', repeat('x', 2000))$$,
  'deck name of 80 and notes of 2000 characters are accepted');
select throws_ok($$insert into public.decks (owner_id, name, format, visibility)
  values ('d1000000-0000-4000-8000-000000000001', repeat('n', 81), 'modern', 'private')$$,
  '23514', null, 'deck name of 81 characters is rejected');
select throws_ok($$insert into public.decks (owner_id, name, format, visibility)
  values ('d1000000-0000-4000-8000-000000000001', '', 'modern', 'private')$$,
  '23514', null, 'empty deck name is rejected');
select throws_ok($$insert into public.decks (owner_id, name, format, visibility, notes)
  values ('d1000000-0000-4000-8000-000000000001', 'ok', 'modern', 'private', repeat('x', 2001))$$,
  '23514', null, 'notes of 2001 characters are rejected');
select throws_ok($$update public.decks set name = repeat('é', 81) where id = 'd2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'owner PATCH to an 81-character (multibyte) name is rejected');
select throws_ok($$update public.decks set notes = repeat('x', 2001) where id = 'd2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'owner PATCH to 2001-character notes is rejected');

-- deck_cards
select lives_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, mana_cost, oracle_text, image_uri, colors, quantity)
  values ('d2000000-0000-4000-8000-000000000001', repeat('s', 64), repeat('c', 200), repeat('t', 200), repeat('m', 100),
          repeat('o', 4000), 'https://cards.scryfall.io/' || repeat('i', 486), array['W','U','B','R','G'], 1)$$,
  'a card exactly at every limit is accepted');
select is((select char_length(image_uri) from public.deck_cards where scryfall_id = repeat('s', 64)), 512, 'the 512-character image URL was saved');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity)
  values ('d2000000-0000-4000-8000-000000000001', repeat('s', 65), 'c', 't', 1)$$, '23514', null, 'scryfall_id of 65 rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a1', repeat('c', 201), 't', 1)$$, '23514', null, 'card_name of 201 rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a2', 'c', repeat('t', 201), 1)$$, '23514', null, 'type_line of 201 rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, mana_cost, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a3', 'c', 't', repeat('m', 101), 1)$$, '23514', null, 'mana_cost of 101 rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, oracle_text, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a4', 'c', 't', repeat('o', 4001), 1)$$, '23514', null, 'oracle_text of 4001 rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, image_uri, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a5', 'c', 't', 'https://cards.scryfall.io/' || repeat('i', 487), 1)$$, '23514', null, 'image_uri of 513 rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a6', 'c', 't', array['X'], 1)$$, '23514', null, 'a color outside WUBRG rejected');
select throws_ok($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, quantity)
  values ('d2000000-0000-4000-8000-000000000001', 'a7', 'c', 't', array['W','W','W','W','W','W'], 1)$$, '23514', null, 'more than 5 colors rejected');
select throws_ok($$update public.deck_cards set oracle_text = repeat('o', 4001) where scryfall_id = repeat('s', 64)$$,
  '23514', null, 'owner PATCH to a 4001-character oracle_text is rejected');

-- favorite_cards
select lives_ok($$insert into public.favorite_cards (user_id, scryfall_id, card_name, type_line, mana_cost, image_uri)
  values ('d1000000-0000-4000-8000-000000000001', repeat('s', 64), repeat('c', 200), repeat('t', 200), repeat('m', 100),
          'https://cards.scryfall.io/' || repeat('i', 486))$$, 'a favorite exactly at every limit is accepted');
select throws_ok($$insert into public.favorite_cards (user_id, scryfall_id, card_name)
  values ('d1000000-0000-4000-8000-000000000001', repeat('s', 65), 'c')$$, '23514', null, 'favorite scryfall_id of 65 rejected');
select throws_ok($$insert into public.favorite_cards (user_id, scryfall_id, card_name)
  values ('d1000000-0000-4000-8000-000000000001', 'f1', repeat('c', 201))$$, '23514', null, 'favorite card_name of 201 rejected');
select throws_ok($$insert into public.favorite_cards (user_id, scryfall_id, card_name, type_line)
  values ('d1000000-0000-4000-8000-000000000001', 'f2', 'c', repeat('t', 201))$$, '23514', null, 'favorite type_line of 201 rejected');
select throws_ok($$insert into public.favorite_cards (user_id, scryfall_id, card_name, mana_cost)
  values ('d1000000-0000-4000-8000-000000000001', 'f3', 'c', repeat('m', 101))$$, '23514', null, 'favorite mana_cost of 101 rejected');
select throws_ok($$insert into public.favorite_cards (user_id, scryfall_id, card_name, image_uri)
  values ('d1000000-0000-4000-8000-000000000001', 'f4', 'c', 'https://cards.scryfall.io/' || repeat('i', 487))$$, '23514', null, 'favorite image_uri of 513 rejected');

-- restart_friend_request(): definition and grants
reset role;
select is((select prosecdef from pg_proc where oid = 'public.restart_friend_request(uuid)'::regprocedure), false,
  'restart_friend_request is SECURITY INVOKER');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.restart_friend_request(uuid)'::regprocedure),
  'restart_friend_request has search_path=''''');
select ok(not has_function_privilege('anon', 'public.restart_friend_request(uuid)', 'execute'), 'anon cannot execute restart_friend_request');
select ok(has_function_privilege('authenticated', 'public.restart_friend_request(uuid)', 'execute'), 'authenticated can execute restart_friend_request');

-- ben asks ann, ann declines
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.friendships (requester_id, addressee_id, status)
  values ('d1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'pending');
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.friendships set status = 'declined'
  where requester_id = 'd1000000-0000-4000-8000-000000000002' and addressee_id = 'd1000000-0000-4000-8000-000000000001';

-- ben (the declined requester) can't use it to get around the decline
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.restart_friend_request('d1000000-0000-4000-8000-000000000001')$$, 'P0002', null,
  'the declined requester cannot restart (no declined request addressed to them)');
reset role;
select is((select status from public.friendships where requester_id = 'd1000000-0000-4000-8000-000000000002'
            and addressee_id = 'd1000000-0000-4000-8000-000000000001'), 'declined', 'the declined row is unchanged');

-- cat (a stranger) can't clear ann's declined row with it
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$select public.restart_friend_request('d1000000-0000-4000-8000-000000000002')$$, 'P0002', null,
  'a stranger gets P0002');
reset role;
select is((select count(*) from public.friendships where requester_id = 'd1000000-0000-4000-8000-000000000002'
            and status = 'declined'), 1::bigint, 'the declined row survives the stranger''s call');

-- signed out
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$select public.restart_friend_request('d1000000-0000-4000-8000-000000000002')$$, '42501', null,
  'anon cannot call restart_friend_request');

-- ann (the decliner) starts over: one transaction, one row, now ann -> ben pending
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.restart_friend_request('d1000000-0000-4000-8000-000000000002')$$,
  'the decliner can restart');
reset role;
select is((select count(*) from public.friendships
            where least(requester_id, addressee_id) = 'd1000000-0000-4000-8000-000000000001'
              and greatest(requester_id, addressee_id) = 'd1000000-0000-4000-8000-000000000002'), 1::bigint,
  'exactly one row for the pair');
select is((select requester_id::text || '/' || status from public.friendships
            where least(requester_id, addressee_id) = 'd1000000-0000-4000-8000-000000000001'
              and greatest(requester_id, addressee_id) = 'd1000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001/pending', 'the new row is ann -> ben, pending');

-- a second restart has nothing to delete
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.restart_friend_request('d1000000-0000-4000-8000-000000000002')$$, 'P0002', null,
  'restart without a declined row raises P0002');

-- ben is now the addressee, so he can answer it
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
update public.friendships set status = 'accepted' where requester_id = 'd1000000-0000-4000-8000-000000000001';
reset role;
select is((select status from public.friendships where requester_id = 'd1000000-0000-4000-8000-000000000001'),
  'accepted', 'the new addressee (ben) can accept the restarted request');

-- Atomic: if the insert fails, the delete is undone too. Cat's request to ann
-- is declined; a temporary CHECK makes ann's new insert fail.
insert into public.friendships (requester_id, addressee_id, status)
  values ('d1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'declined');
alter table public.friendships add constraint tmp_block_new_pending
  check (not (requester_id = 'd1000000-0000-4000-8000-000000000001' and addressee_id = 'd1000000-0000-4000-8000-000000000003'));
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.restart_friend_request('d1000000-0000-4000-8000-000000000003')$$, '23514', null,
  'a failing insert makes the whole call fail');
reset role;
select is((select status from public.friendships where requester_id = 'd1000000-0000-4000-8000-000000000003'
            and addressee_id = 'd1000000-0000-4000-8000-000000000001'), 'declined',
  'and the declined row is still there (delete rolled back)');

select * from finish();
rollback;
