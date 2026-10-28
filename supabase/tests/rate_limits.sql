-- Spellbranch: rate-limit counters and the find_profile() backstop
-- (migration 004; security review M1/I2, Cipher plan review F3/F7/F8).
-- Run with `supabase test db` (or psql on a db with 001-004 applied).
-- Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(42);

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('e1000000-0000-4000-8000-000000000001','authenticated','authenticated','rl1@example.test','{"username":"rl_ann"}'),
 ('e1000000-0000-4000-8000-000000000002','authenticated','authenticated','rl2@example.test','{"username":"rl_ben"}');

-- ---------------------------------------------------------------------------
-- Grants (has_function_privilege accounts for PUBLIC)
-- ---------------------------------------------------------------------------
select is(has_function_privilege(r, 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE'), r = 'service_role',
          format('rate_limit_hit(): EXECUTE for %s is %s', r, r = 'service_role'))
  from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r, 'private.rate_limit_hit_core(text,integer,integer)', 'EXECUTE'),
          format('private.rate_limit_hit_core(): no EXECUTE for %s', r))
  from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege('anon', 'public.find_profile(text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.find_profile(text)', 'EXECUTE'),
          'find_profile(): authenticated only (anon refused)');
-- Unchanged until the secret-key commit:
select ok(has_function_privilege('anon', 'public.username_available(text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.username_available(text)', 'EXECUTE'),
          'username_available(): grants unchanged by 004 (anon + authenticated)');
select ok(not exists (
            select 1 from pg_proc p, unnest(p.proacl) a
            where p.oid in ('public.rate_limit_hit(text,integer,integer)'::regprocedure,
                            'private.rate_limit_hit_core(text,integer,integer)'::regprocedure,
                            'public.find_profile(text)'::regprocedure,
                            'public.username_available(text)'::regprocedure)
              and a::text like '=%'),
          'no PUBLIC EXECUTE grant on any of the four functions');
select ok(not has_schema_privilege(r, 'private', 'USAGE'), format('no USAGE on schema private for %s', r))
  from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_table_privilege(r, 'private.rate_limits', 'SELECT,INSERT,UPDATE,DELETE'),
          format('no table privileges on private.rate_limits for %s', r))
  from unnest(array['anon','authenticated','service_role']) r;

-- ---------------------------------------------------------------------------
-- Function shape
-- ---------------------------------------------------------------------------
select ok((select prosecdef and proconfig @> array['search_path=""'] and provolatile = 'v'
             from pg_proc where oid = f::regprocedure),
          format('%s is VOLATILE SECURITY DEFINER with an empty search_path', f))
  from unnest(array['public.rate_limit_hit(text,integer,integer)', 'public.find_profile(text)']) f;
select ok((select not prosecdef and proconfig @> array['search_path=""']
             from pg_proc where oid = 'private.rate_limit_hit_core(text,integer,integer)'::regprocedure),
          'private.rate_limit_hit_core() is SECURITY INVOKER with an empty search_path');
select is((select prorettype::regtype::text from pg_proc where oid = 'public.find_profile(text)'::regprocedure),
          'public_profiles', 'find_profile() still returns public_profiles rows');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and tablename = 'rate_limits'
                    and indexdef like '%(window_start)%'),
          'private.rate_limits has an index on window_start');
select ok((select relrowsecurity from pg_class where oid = 'private.rate_limits'::regclass),
          'RLS is enabled on private.rate_limits');

-- ---------------------------------------------------------------------------
-- Counting (as service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
select is(array(select (public.rate_limit_hit('t:k1', 3, 300)).allowed from generate_series(1, 4)),
          array[true, true, true, false], 'rate_limit_hit(): 3 allowed, the 4th refused');
select ok((select retry_after between 1 and 300 from public.rate_limit_hit('t:k1', 3, 300)),
          'a refused hit returns retry_after within the window');
select is((select retry_after from public.rate_limit_hit('t:k2', 3, 300)), 0, 'an allowed hit returns retry_after 0');
select is((select allowed from public.rate_limit_hit('t:k2', 3, 60)), true,
          'the same key with another window is a separate counter');

select throws_ok($$select * from public.rate_limit_hit('t:k', 0, 60)$$, '22023', null, 'limit 0 is rejected');
select throws_ok($$select * from public.rate_limit_hit('t:k', 1, 0)$$, '22023', null, 'window 0 is rejected');
select throws_ok($$select * from public.rate_limit_hit('t:k', 1, 86401)$$, '22023', null, 'a window over a day is rejected');
select throws_ok($$select * from public.rate_limit_hit(null, 1, 60)$$, '22023', null, 'a null key is rejected');
select throws_ok($$select * from public.rate_limit_hit(repeat('k', 201), 1, 60)$$, '22023', null, 'a key over 200 characters is rejected');
reset role;

select is((select count from private.rate_limits where key = 't:k1'), 5,
          'the counter holds every hit in the window (stored on the DB clock)');
select ok((select bool_and(extract(epoch from window_start)::bigint % 300 = 0) from private.rate_limits where key = 't:k1'),
          'window_start is a multiple of the window');

set local role anon;
select throws_ok($$select * from public.rate_limit_hit('t:x', 1, 60)$$, '42501', null, 'anon cannot call rate_limit_hit()');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select * from public.rate_limit_hit('t:x', 1, 60)$$, '42501', null, 'authenticated cannot call rate_limit_hit()');
select throws_ok($$select * from private.rate_limits$$, '42501', null, 'authenticated cannot read private.rate_limits');

-- ---------------------------------------------------------------------------
-- find_profile() backstop: 60 lookups / 10 min per auth.uid()
-- ---------------------------------------------------------------------------
select is((select username from public.find_profile('RL_BEN')), 'rl_ben', 'find_profile() still finds an exact name');
-- The argument references g so the function really runs once per row.
select is((select count(*) from generate_series(1, 59) g,
                  lateral public.find_profile(case when g > 0 then 'rl_ben' end) f), 59::bigint,
          'calls 2-60 in the window return the row');
select throws_ok($$select * from public.find_profile('rl_ben')$$, 'PT429', 'too many lookups',
                 'call 61 raises PT429');
select throws_ok($$select * from public.find_profile('nobody_here')$$, 'PT429', null,
                 'the limit counts every lookup, found or not');
reset role;
select is((select count from private.rate_limits
            where key = 'db:find_profile:uid:e1000000-0000-4000-8000-000000000001'), 60,
          'refused calls roll back their own increment (count stays 60)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select username from public.find_profile('rl_ann')), 'rl_ann', 'another user has their own counter');
reset role;

set local role anon;
select throws_ok($$select * from public.find_profile('rl_ann')$$, '42501', null, 'anon still cannot call find_profile()');
reset role;

select * from finish();
rollback;
