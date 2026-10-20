-- Spellbranch RLS / integrity checks (pgTAP).
--
-- Run locally with:   supabase test db
-- (or plain psql against a database with 001 + 002 applied; look for "not ok").
--
-- Self-contained: creates its own throwaway users/decks inside a transaction
-- and rolls everything back, so it does not depend on seed.sql.
-- Impersonation follows the Supabase convention: SET LOCAL ROLE plus
-- request.jwt.claims carrying sub/role, which is what auth.uid()/auth.role() read.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

-- pgTAP keeps its bookkeeping in temp tables owned by the session user; let the
-- impersonated API roles write to them.
grant all on all tables in schema pg_temp to anon, authenticated;
grant all on all sequences in schema pg_temp to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
-- tess: deck owner; uma: requests tess (later accepted); vic: requests tess (stays pending)
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tess@example.test', '{"username":"tess","display_name":"Tess"}'),
  ('a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'uma@example.test',  '{"username":"uma","display_name":"Uma"}'),
  ('a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'vic@example.test',  '{"username":"vic","display_name":"Vic"}');

insert into public.friendships (id, requester_id, addressee_id, status) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'pending'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'pending');

insert into public.decks (id, owner_id, name, format, visibility, allow_forks, updated_at) values
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Public no forks', 'modern',    'public',  false, '2000-01-01'),
  ('a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Public forks',    'modern',    'public',  true,  '2000-01-01'),
  ('a2000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Friends deck',    'commander', 'friends', true,  '2000-01-01'),
  ('a2000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Private deck',    'casual',    'private', false, '2000-01-01');

insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity) values
  ('a2000000-0000-4000-8000-000000000002', 'test-bolt', 'Lightning Bolt', 'Instant', 4),
  ('a2000000-0000-4000-8000-000000000002', 'test-island', 'Island', 'Basic Land — Island', 20);

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------
select hasnt_column('public', 'profiles', 'email', 'profiles.email is gone (email stays in auth.users)');
select has_view('public', 'public_profiles', 'public_profiles view exists');

-- ---------------------------------------------------------------------------
-- Friendships: requester (uma) cannot self-accept
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.decks where id = 'a2000000-0000-4000-8000-000000000003'),
  0::bigint, 'uma cannot see friends-only deck before acceptance');

update public.friendships set status = 'accepted' where id = 'a1000000-0000-4000-8000-000000000001';
select is(
  (select status from public.friendships where id = 'a1000000-0000-4000-8000-000000000001'),
  'pending', 'requester cannot self-accept (update matches no rows)');

select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id, status)
    values ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'accepted')$$,
  '42501', null, 'cannot insert a pre-accepted friendship');

select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id, status)
    values ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'pending')$$,
  '42501', null, 'cannot create a request on behalf of someone else');

-- ---------------------------------------------------------------------------
-- Friendships: addressee (tess) accepts; cannot rewrite participants
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id, status)
    values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'pending')$$,
  '23505', null, 'reverse-direction duplicate friendship is rejected');

select throws_ok(
  $$update public.friendships set requester_id = 'a0000000-0000-4000-8000-000000000003'
    where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'addressee cannot rewrite requester_id (column not updatable)');

select throws_ok(
  $$update public.friendships set status = 'pending'
    where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'addressee can only move status to accepted/declined');

update public.friendships set status = 'accepted' where id = 'a1000000-0000-4000-8000-000000000001';
select is(
  (select status from public.friendships where id = 'a1000000-0000-4000-8000-000000000001'),
  'accepted', 'addressee can accept');

-- ---------------------------------------------------------------------------
-- Visibility after acceptance
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = 'a2000000-0000-4000-8000-000000000003'),
  1::bigint, 'uma sees friends-only deck after acceptance');
select is(
  (select count(*) from public.decks where id = 'a2000000-0000-4000-8000-000000000004'),
  0::bigint, 'private deck hidden from a friend');

set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = 'a2000000-0000-4000-8000-000000000003'),
  0::bigint, 'vic (still pending) cannot see friends-only deck');
select is(
  public.is_friend('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  false, 'is_friend() does not reveal friendships between other users');

delete from public.friendships where id = 'a1000000-0000-4000-8000-000000000002';
reset role;
select is(
  (select count(*) from public.friendships where id = 'a1000000-0000-4000-8000-000000000002'),
  0::bigint, 'requester can cancel (delete) their pending request');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Forks
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$insert into public.decks (owner_id, name, format, visibility, forked_from_id)
    values ('a0000000-0000-4000-8000-000000000002', 'sneaky', 'modern', 'private', 'a2000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'direct insert of a fork is blocked when allow_forks = false');

select throws_ok(
  $$select public.fork_deck('a2000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'fork_deck() is blocked when allow_forks = false');

select throws_ok(
  $$insert into public.decks (owner_id, name, format, visibility, forked_from_id)
    values ('a0000000-0000-4000-8000-000000000002', 'sneaky', 'casual', 'private', 'a2000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'cannot fork a private deck you cannot view');

update public.decks set name = 'hijacked' where id = 'a2000000-0000-4000-8000-000000000002';
select is(
  (select name from public.decks where id = 'a2000000-0000-4000-8000-000000000002'),
  'Public forks', 'non-owner update of someone else''s deck changes nothing');

select lives_ok(
  $$create temp table uma_fork on commit drop as
    select public.fork_deck('a2000000-0000-4000-8000-000000000002') as id$$,
  'fork_deck() works on a public deck that allows forks');

select is(
  (select count(*) from public.deck_cards where deck_id = (select id from uma_fork)),
  2::bigint, 'fork_deck() copies the card list');

select is(
  (select visibility || '/' || owner_id::text from public.decks where id = (select id from uma_fork)),
  'friends/a0000000-0000-4000-8000-000000000002', 'fork is owned by caller; public source -> friends-only branch');

set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.fork_deck('a2000000-0000-4000-8000-000000000003')$$,
  'P0002', null, 'non-friend cannot fork (or even see) a friends-only deck');

set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.fork_deck('a2000000-0000-4000-8000-000000000004')$$,
  'owner may branch their own deck even with allow_forks = false');

-- ---------------------------------------------------------------------------
-- Preferred branch + updated_at
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.decks set preferred_branch_id = 'a2000000-0000-4000-8000-000000000001'
    where id = 'a2000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'preferred_branch_id must be a fork of the deck');

select lives_ok(
  $$update public.decks set preferred_branch_id = (select id from uma_fork)
    where id = 'a2000000-0000-4000-8000-000000000002'$$,
  'owner can set a real fork as preferred branch');

select is(
  (select updated_at from public.decks where id = 'a2000000-0000-4000-8000-000000000002'),
  now(), 'updated_at trigger bumps decks.updated_at');

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.profiles set username = 'UMA' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23505', null, 'usernames are unique case-insensitively');

select throws_ok(
  $$update public.profiles set username = 'no spaces!' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'username format is enforced');

reset role;
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'tess@another.test', '{"username":"TESS"}');
select ok(
  (select username ~ '^TESS_[0-9a-f]{4}$'
   from public.profiles where id = 'a0000000-0000-4000-8000-000000000009'),
  'handle_new_user: colliding username (TESS vs tess) gets a unique fallback');

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'xavier.y+test@example.test', '{"username":"bad name"}');
select ok(
  (select username ~ '^player_[0-9a-f]{6}$' and username !~* 'xavier'
   from public.profiles where id = 'a0000000-0000-4000-8000-00000000000a'),
  'handle_new_user: invalid requested username falls back to player_xxxxxx (not the email prefix)');

-- uma comments on a public deck (so anon may see uma's public profile below)
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.comments (deck_id, author_id, body)
  values ('a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'nice list');

-- ---------------------------------------------------------------------------
-- Anonymous visitors
-- ---------------------------------------------------------------------------
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select is(
  (select username from public.public_profiles where id = 'a0000000-0000-4000-8000-000000000001'),
  'tess', 'anon can read the public profile of a public deck''s owner');

select is(
  (select count(*) from public.public_profiles where id = 'a0000000-0000-4000-8000-000000000002'),
  1::bigint, 'anon can read the public profile of a commenter on a public deck');

select is(
  (select count(*) from public.public_profiles where id = 'a0000000-0000-4000-8000-000000000003'),
  0::bigint, 'anon cannot read profiles with no public content');

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null, 'anon cannot read non-public profile columns');

select is(
  (select count(*) from public.decks where owner_id = 'a0000000-0000-4000-8000-000000000001'),
  2::bigint, 'anon sees only public decks (2 of 4)');

select throws_ok(
  $$select public.fork_deck('a2000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'anon cannot call fork_deck()');

select * from finish();
rollback;
