-- Spellbranch: a source owner can see forks their friends make (migration 009).
--
-- Self-contained; rolled back. Ann owns a friends-only deck and a public deck.
-- Ben is Ann's friend. Cat is Ben's friend, not Ann's. Dan starts as a
-- stranger. Eve is Ann's friend, not Ben's.
--
-- F4 defaults stay. Ann can read Ben's private fork and compare it (mark it
-- preferred on her own deck) but cannot edit, delete, add cards, or fork it.
-- Cat and Eve cannot see it. Dan's fork of the public deck stays hidden until
-- they are friends, remains visible after he makes it private, and disappears
-- when they unfriend.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('d0000000-0000-4000-8000-000000000001','authenticated','authenticated','ann@example.test','{"username":"ann"}'),
 ('d0000000-0000-4000-8000-000000000002','authenticated','authenticated','ben@example.test','{"username":"ben"}'),
 ('d0000000-0000-4000-8000-000000000003','authenticated','authenticated','cat@example.test','{"username":"cat"}'),
 ('d0000000-0000-4000-8000-000000000004','authenticated','authenticated','dan@example.test','{"username":"dan"}'),
 ('d0000000-0000-4000-8000-000000000005','authenticated','authenticated','eve@example.test','{"username":"eve"}');
insert into public.friendships (id, requester_id, addressee_id, status) values
 ('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','accepted'),
 ('d1000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','accepted'),
 ('d1000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000005','accepted');
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks) values
 ('d2000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Ann friends','modern','secret','friends',true),
 ('d2000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','Ann public','modern','','public',true);
insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity, color_identity) values
 ('d2000000-0000-4000-8000-000000000001','bolt','Lightning Bolt','Instant',1,'{R}');

select ok(
  (select prosecdef
      and proconfig @> array['search_path=""']
      and prosrc like '%from public.decks src%'
      and prosrc not like '%can_view_deck(%'
   from pg_proc
   where oid = 'public.can_view_deck(public.decks, uuid)'::regprocedure),
  'can_view_deck is security definer, empty search_path, PK lookup, no recursive call');
select ok(
  has_function_privilege('anon', 'public.can_view_deck(public.decks, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.can_view_deck(public.decks, uuid)', 'execute'),
  'can_view_deck stays executable by anon and authenticated');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}';
create temp table f_ben on commit drop as select public.fork_deck('d2000000-0000-4000-8000-000000000001') as id;
grant select on f_ben to anon, authenticated, service_role;
select is(
  (select visibility || '/' || allow_forks::text from public.decks where id = (select id from f_ben)),
  'private/false',
  'F4: fork of a friends-only deck still starts private and not forkable');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}';
create temp table f_dan on commit drop as select public.fork_deck('d2000000-0000-4000-8000-000000000002') as id;
grant select on f_dan to anon, authenticated, service_role;
select is(
  (select visibility || '/' || allow_forks::text from public.decks where id = (select id from f_dan)),
  'friends/true',
  'F4: fork of a public deck is still friends-only and forkable');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  1::bigint,
  'ann (source owner, friends with ben) can see ben''s private fork');
select is(
  (select count(*) from public.deck_cards where deck_id = (select id from f_ben)),
  1::bigint,
  'ann can read cards on that fork');
update public.decks set name = 'hijacked', visibility = 'public', allow_forks = true
  where id = (select id from f_ben);
select is(
  (select name || '/' || visibility || '/' || allow_forks::text from public.decks where id = (select id from f_ben)),
  'Ann friends (branch)/private/false',
  'ann cannot edit the friend fork');
delete from public.decks where id = (select id from f_ben);
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  1::bigint,
  'ann cannot delete the friend fork');
select throws_ok(
  format($$insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity, color_identity)
          values (%L, 'x', 'X', 'Instant', 1, '{}')$$, (select id from f_ben)),
  '42501', null,
  'ann cannot add cards to the friend fork');
select throws_ok(
  format($$select public.fork_deck(%L)$$, (select id from f_ben)),
  '42501', null,
  'ann cannot fork the private friend fork further');
select lives_ok(
  format($$update public.decks set preferred_branch_id = %L where id = 'd2000000-0000-4000-8000-000000000001'$$, (select id from f_ben)),
  'ann may mark the visible friend fork preferred on her own deck');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  0::bigint,
  'cat (ben''s friend, not the source owner) cannot see the private fork');
select is(
  (select count(*) from public.deck_cards where deck_id = (select id from f_ben)),
  0::bigint,
  'cat cannot read cards on the private fork');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  0::bigint,
  'eve (ann''s friend, not ben''s) cannot see ben''s private fork');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  0::bigint,
  'anon cannot see the private fork');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_dan)),
  0::bigint,
  'ann cannot see a non-friend fork of her public deck');
select throws_ok(
  format($$update public.decks set preferred_branch_id = %L where id = 'd2000000-0000-4000-8000-000000000002'$$, (select id from f_dan)),
  '23514', null,
  'ann cannot prefer a fork she cannot see');

reset role;
set local "request.jwt.claims" = '';
insert into public.friendships (id, requester_id, addressee_id, status) values
 ('d1000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000004','accepted');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_dan)),
  1::bigint,
  'once dan and ann are friends, ann can see his fork of her public deck');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}';
update public.decks set visibility = 'private', allow_forks = false where id = (select id from f_dan);
select is(
  (select visibility || '/' || allow_forks::text from public.decks where id = (select id from f_dan)),
  'private/false',
  'dan can make his fork private');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_dan)),
  1::bigint,
  'ann still sees the fork after dan makes it private');

reset role;
set local "request.jwt.claims" = '';
delete from public.friendships where id = 'd1000000-0000-4000-8000-000000000004';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_dan)),
  0::bigint,
  'unfriending hides dan''s private fork from ann again');

set local "request.jwt.claims" = '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  0::bigint,
  'cat still cannot see ben''s private fork of ann''s deck');

select * from finish();
rollback;
