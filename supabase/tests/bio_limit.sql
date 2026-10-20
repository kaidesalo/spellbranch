-- Spellbranch: profiles.bio length limit (migration 003, review N1).
-- Run with `supabase test db` (or psql on a db with 001-003 applied).
-- Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','bio1@example.test','{"username":"bio_one"}');

select has_check('public', 'profiles', 'profiles has a check constraint');
select ok(
  exists (select 1 from pg_constraint
          where conname = 'profiles_bio_length' and conrelid = 'public.profiles'::regclass and convalidated),
  'profiles_bio_length exists and is validated');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$update public.profiles set bio = repeat('a', 280) where id = 'b1000000-0000-4000-8000-000000000001'$$,
  'a 280-character bio is accepted');
select is((select char_length(bio) from public.profiles where id = 'b1000000-0000-4000-8000-000000000001'),
  280, 'the 280-character bio was saved');
select throws_ok(
  $$update public.profiles set bio = repeat('a', 281) where id = 'b1000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a 281-character bio is rejected for the owner via the API role');
select throws_ok(
  $$update public.profiles set bio = repeat('é', 281) where id = 'b1000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'the limit counts characters, not bytes (281 multibyte chars rejected)');

select * from finish();
rollback;
