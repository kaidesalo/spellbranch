-- Spellbranch: profiles.bio is owner and accepted-friend only (migration 012).
--
-- Direct SELECT of the column is denied for every API role, including the
-- owner. profile_bio() is the only read. Pending, declined, a public-deck
-- viewer, a stranger, and anon get no bio.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

select ok(
  not has_column_privilege('anon', 'public.profiles', 'bio', 'SELECT')
  and not has_column_privilege('authenticated', 'public.profiles', 'bio', 'SELECT')
  and not has_table_privilege('anon', 'public.profiles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profiles', 'SELECT')
  and has_column_privilege('anon', 'public.profiles', 'username', 'SELECT')
  and has_column_privilege('anon', 'public.profiles', 'avatar_url', 'SELECT')
  and not has_column_privilege('anon', 'public.profiles', 'created_at', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'username', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'created_at', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE')
  and has_column_privilege('service_role', 'public.profiles', 'bio', 'SELECT'),
  'bio SELECT is revoked from API roles; other columns and the owner UPDATE stay');

select ok(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_proc where oid = 'public.profile_bio(uuid)'::regprocedure)
  and not has_function_privilege('public', 'public.profile_bio(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.profile_bio(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.profile_bio(uuid)', 'EXECUTE'),
  'profile_bio is security definer, empty search_path, authenticated only');

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('b1200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'bio-owner@example.test', '{"username":"bio_owner","display_name":"Owner"}'),
  ('b1200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'bio-friend@example.test', '{"username":"bio_friend","display_name":"Friend"}'),
  ('b1200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'bio-pending@example.test', '{"username":"bio_pending","display_name":"Pending"}'),
  ('b1200000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'bio-declined@example.test', '{"username":"bio_declined","display_name":"Declined"}'),
  ('b1200000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'bio-viewer@example.test', '{"username":"bio_viewer","display_name":"Viewer"}'),
  ('b1200000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'bio-stranger@example.test', '{"username":"bio_stranger","display_name":"Stranger"}'),
  ('b1200000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'bio-quiet@example.test', '{"username":"bio_quiet","display_name":"Quiet"}');

update public.profiles set bio = 'graveyard secret' where id = 'b1200000-0000-4000-8000-000000000001';
update public.profiles set bio = 'quiet secret' where id = 'b1200000-0000-4000-8000-000000000007';

insert into public.decks (id, owner_id, name, format, visibility, allow_forks) values
  ('b1210000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'Public list', 'modern', 'public', true);

insert into public.friendships (id, requester_id, addressee_id, status) values
  ('b1220000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000001', 'accepted'),
  ('b1220000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000003', 'b1200000-0000-4000-8000-000000000001', 'pending'),
  ('b1220000-0000-4000-8000-000000000003', 'b1200000-0000-4000-8000-000000000004', 'b1200000-0000-4000-8000-000000000001', 'declined');

-- Owner: column SELECT is denied; the function returns the text; UPDATE still works.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'owner cannot select profiles.bio directly');

select throws_ok(
  $$select * from public.profiles$$,
  '42501', null,
  'select * on profiles is denied because bio is not granted');

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000001'),
  'graveyard secret',
  'owner reads their own bio through profile_bio()');

select lives_ok(
  $$update public.profiles set bio = '' where id = 'b1200000-0000-4000-8000-000000000001'$$,
  'owner can still update bio');

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000001'),
  '',
  'an empty bio is an empty string, not null, for the owner');

update public.profiles set bio = 'graveyard secret' where id = 'b1200000-0000-4000-8000-000000000001';

-- Accepted friend.
set local "request.jwt.claims" = '{"sub":"b1200000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000001'),
  'graveyard secret',
  'accepted friend reads the bio');

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'accepted friend cannot select profiles.bio directly');

-- Pending.
set local "request.jwt.claims" = '{"sub":"b1200000-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000001'),
  null::text,
  'pending friendship does not reveal the bio');

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'pending counterpart cannot select profiles.bio');

-- Declined.
set local "request.jwt.claims" = '{"sub":"b1200000-0000-4000-8000-000000000004","role":"authenticated"}';

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000001'),
  null::text,
  'declined friendship does not reveal the bio');

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'declined counterpart cannot select profiles.bio');

-- Signed-in viewer of a public deck, not a friend.
set local "request.jwt.claims" = '{"sub":"b1200000-0000-4000-8000-000000000005","role":"authenticated"}';

select is(
  (select username from public.profiles where id = 'b1200000-0000-4000-8000-000000000001'),
  'bio_owner',
  'public-deck viewer can still read the username');

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000001'),
  null::text,
  'public-deck viewer does not read the bio');

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'public-deck viewer cannot select profiles.bio');

-- Stranger, and a profile with no public content.
set local "request.jwt.claims" = '{"sub":"b1200000-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.profiles where id = 'b1200000-0000-4000-8000-000000000007'),
  0::bigint,
  'stranger cannot read a profile with no shared deck, comment, or friendship');

select is(
  public.profile_bio('b1200000-0000-4000-8000-000000000007'),
  null::text,
  'stranger does not read a hidden bio');

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'stranger cannot select profiles.bio');

-- Anon.
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok(
  $$select bio from public.profiles$$,
  '42501', null,
  'anon cannot select profiles.bio');

select throws_ok(
  $$select public.profile_bio('b1200000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'anon cannot call profile_bio()');

select is(
  (select username from public.public_profiles where id = 'b1200000-0000-4000-8000-000000000001'),
  'bio_owner',
  'anon can still read a public profile name');

select * from finish();
rollback;
