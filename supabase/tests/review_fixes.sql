-- Spellbranch: checks for the PR #1 security review fixes (pgTAP).
--
-- Adapted from Cipher's review harness (tests/cipher_fixed.sql, PR #1 security
-- review, 2026-10-20) -- credit to Cipher for the original checks. Finding
-- labels follow the review's numbering (F1-F10).
--
-- Run with `supabase test db` (or psql on a db with 001-005 applied).
-- Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(42);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c0000000-0000-4000-8000-000000000001','authenticated','authenticated','ann@example.test','{"username":"ann"}'),
 ('c0000000-0000-4000-8000-000000000002','authenticated','authenticated','ben@example.test','{"username":"ben"}'),
 ('c0000000-0000-4000-8000-000000000003','authenticated','authenticated','cat@example.test','{"username":"cat"}'),
 ('c0000000-0000-4000-8000-000000000004','authenticated','authenticated','dan.smith@corp.example','{}');
insert into public.friendships (id, requester_id, addressee_id, status) values
 ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','accepted'),
 ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003','accepted'),
 ('c1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000001','declined'),
 ('c1000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001','pending');
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks) values
 ('c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Ann public','modern','','public',true),
 ('c2000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','Ann friends','modern','secret','friends',true);
insert into public.comments (id, deck_id, author_id, body) values
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003','cat 1'),
 ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003','cat 2');

select ok((select username ~ '^player_[0-9a-f]{6}$' from public.profiles where id='c0000000-0000-4000-8000-000000000004'),
  'F2: no-username signup gets player_xxxxxx, not the email prefix');

set local role authenticated;
-- dan (declined requester)
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}';
delete from public.friendships where id='c1000000-0000-4000-8000-000000000003';
select is((select count(*) from public.friendships where id='c1000000-0000-4000-8000-000000000003'),1::bigint,'F1: requester cannot delete a declined request');
select throws_ok($$insert into public.friendships (requester_id,addressee_id,status) values ('c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000001','pending')$$,'23505',null,'F1: so cannot re-send it');
-- F5: no profile directory; exact-username lookup only.
select is((select count(*) from public.profiles where id::text like 'c0000000%'), 3::bigint, 'F5: dan sees himself, ann (shared request row), cat (comment on a public deck) only');
select is((select count(*) from public.profiles where id='c0000000-0000-4000-8000-000000000002'), 0::bigint, 'F5: dan cannot read unrelated ben');
select is((select username from public.find_profile('BEN')), 'ben', 'F5: find_profile() exact match is case-insensitive');
select is((select count(*) from public.find_profile('be%')) + (select count(*) from public.find_profile('b_n'))
          + (select count(*) from public.find_profile('be')) + (select count(*) from public.find_profile('%')), 0::bigint,
  'F5: find_profile() has no prefix/wildcard semantics (be%, b_n, be, %)');
select is((select count(*) from public.find_profile('nobody_here')), 0::bigint, 'F5: find_profile() unknown username -> no rows');
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
           where attrelid = 'public.public_profiles'::regclass and attnum > 0 and not attisdropped)
          || '|' || (select prorettype::regtype::text from pg_proc where oid = 'public.find_profile(text)'::regprocedure),
  'id,username,display_name,avatar_url|public_profiles', 'F5: find_profile() returns only the public columns');
select is((select count(*) from public.public_profiles where id='c0000000-0000-4000-8000-000000000002'), 0::bigint, 'F5: public_profiles view does not bypass the narrower policy');
select throws_ok($$select public.username_available('ben_new')$$,'42501',null,
  'I2: authenticated cannot call username_available() (005: service_role only)');
-- cat (pending requester) can still cancel
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';
delete from public.friendships where id='c1000000-0000-4000-8000-000000000004';
select is((select count(*) from public.friendships where id='c1000000-0000-4000-8000-000000000004'),0::bigint,'F1: requester can still cancel a pending request');
delete from public.comments where id='c3000000-0000-4000-8000-000000000002';
select is((select count(*) from public.comments where id='c3000000-0000-4000-8000-000000000002'),0::bigint,'F7: author can delete own comment');
-- ann
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
delete from public.friendships where id='c1000000-0000-4000-8000-000000000003';
select is((select count(*) from public.friendships where id='c1000000-0000-4000-8000-000000000003'),0::bigint,'F1: addressee can clear a declined row');
delete from public.comments where id='c3000000-0000-4000-8000-000000000001';
select is((select count(*) from public.comments where id='c3000000-0000-4000-8000-000000000001'),0::bigint,'F7: deck owner can remove a comment');
select throws_ok($$update public.profiles set avatar_url='http://x.invalid/a.gif' where id='c0000000-0000-4000-8000-000000000001'$$,'23514',null,'F8: non-https avatar rejected');
select throws_ok($$insert into public.deck_cards (deck_id,scryfall_id,card_name,type_line,quantity,image_uri) values ('c2000000-0000-4000-8000-000000000001','e','e','e',1,'javascript:alert(1)')$$,'23514',null,'F8: non-Scryfall image_uri rejected');
-- ben forks ann's decks
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}';
create temp table f_friends on commit drop as select public.fork_deck('c2000000-0000-4000-8000-000000000002') as id;
create temp table f_public on commit drop as select public.fork_deck('c2000000-0000-4000-8000-000000000001') as id;
grant select on f_friends, f_public to anon, authenticated, service_role;
select is((select visibility||'/'||allow_forks from public.decks where id=(select id from f_friends)),'private/false','F4: fork of friends-only deck starts private, not forkable');
select is((select visibility||'/'||allow_forks from public.decks where id=(select id from f_public)),'friends/true','F4: fork of public deck unchanged (friends, forkable)');
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.decks where id=(select id from f_friends)),0::bigint,'F4: cat (ben''s friend) cannot see the fork of ann''s friends-only deck');
-- Cat is not friends with Ann. 009 still lets Ann see Cat's direct fork.
create temp table f_stranger on commit drop as select public.fork_deck('c2000000-0000-4000-8000-000000000001') as id;
grant select on f_stranger to anon, authenticated, service_role;
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.decks where id=(select id from f_friends)),1::bigint,'009: ann (source owner, friends with ben) can see ben''s private fork of her friends-only deck');
select is((select count(*) from public.decks where id=(select id from f_stranger)),1::bigint,'009: ann sees a non-friend fork of her public deck');
select lives_ok(format($$update public.decks set preferred_branch_id=%L where id='c2000000-0000-4000-8000-000000000001'$$,(select id from f_public)),'F3: can point at a visible fork');
select throws_ok($$insert into public.decks (owner_id,name,format,visibility,forked_from_id) values ('c0000000-0000-4000-8000-000000000001','p','modern','private','c2000000-0000-4000-8000-0000000000ee')$$,'42501',null,'F3: missing source -> same 42501 as invisible source');
-- id-reuse probe: API INSERT with a preferred_branch_id always fails the same way
select throws_ok(format($$insert into public.decks (id,owner_id,name,format,visibility,preferred_branch_id) values ('c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','p','modern','private',%L)$$,(select id from f_public)),'23514',null,'F3: reused deck id + real visible fork -> 23514 (no 23505 oracle)');
select throws_ok($$insert into public.decks (id,owner_id,name,format,visibility,preferred_branch_id) values ('c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','p','modern','private','c2000000-0000-4000-8000-000000000002')$$,'23514',null,'F3: reused deck id + non-fork -> same 23514');
-- trusted roles still work
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(format($$insert into public.decks (owner_id,name,format,visibility,forked_from_id) values ('c0000000-0000-4000-8000-000000000003','svc','modern','private',%L)$$,(select id from f_friends)),'F3: service_role (BYPASSRLS) still trusted');
reset role;
set local "request.jwt.claims" = '';
select lives_ok(format($$update public.decks set preferred_branch_id=%L where id='c2000000-0000-4000-8000-000000000002'$$,(select id from f_friends)),'F3: postgres (migrations/seed) still trusted');
-- N1 (re-review of 75c3c9f, based on Cipher's cipher_head #54): a SECURITY
-- DEFINER function owned by the migration owner runs the trigger with
-- current_user = postgres. With an end-user identity present it must NOT be
-- trusted, so allow_forks / visibility still apply.
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks) values
 ('c2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001','Ann no forks','modern','','public',false);
create function public.zz_definer_fork(src uuid) returns void language sql security definer set search_path = '' as
  $f$ insert into public.decks (owner_id,name,format,visibility,forked_from_id) values (auth.uid(),'via definer','modern','private',src) $f$;
create function public.zz_definer_link(branch uuid) returns void language sql security definer set search_path = '' as
  $f$ insert into public.decks (owner_id,name,format,visibility,preferred_branch_id) values (auth.uid(),'via definer','modern','private',branch) $f$;
grant execute on function public.zz_definer_fork(uuid), public.zz_definer_link(uuid) to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(format($$select public.zz_definer_fork(%L)$$,(select id from f_friends)),'42501',null,
  'N1: definer function (owned by postgres) cannot fork a private, non-forkable deck for an API user');
select throws_ok($$select public.zz_definer_fork('c2000000-0000-4000-8000-000000000003')$$,'42501',null,
  'N1: definer function cannot fork a public deck with allow_forks=false');
select throws_ok(format($$select public.zz_definer_link(%L)$$,(select id from f_public)),'23514',null,
  'N1: definer function cannot insert a deck with a preferred_branch_id link');
select lives_ok($$select public.zz_definer_fork('c2000000-0000-4000-8000-000000000001')$$,
  'N1: definer function can still fork a public, forkable deck');
reset role;
set local "request.jwt.claims" = '';
select ok(not has_table_privilege('anon','public.decks','MAINTAIN'),'F6: MAINTAIN revoked');
select ok(not has_function_privilege('anon','public.find_profile(text)','EXECUTE')
      and has_function_privilege('authenticated','public.find_profile(text)','EXECUTE'),'F5: find_profile() callable by authenticated only');
select ok(not has_function_privilege('anon','public.username_available(text)','EXECUTE')
      and not has_function_privilege('authenticated','public.username_available(text)','EXECUTE')
      and has_function_privilege('service_role','public.username_available(text)','EXECUTE')
      and (select prorettype = 'boolean'::regtype and prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.username_available(text)'::regprocedure),
  'F5/I2: username_available() is a boolean SECURITY DEFINER with empty search_path, callable by service_role only (005)');
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$select * from public.find_profile('ann')$$,'42501',null,'F5: anon cannot call find_profile()');
select throws_ok($$select public.username_available('fresh_name')$$,'42501',null,
  'I2: anon cannot call username_available() (005: service_role only)');
reset role;
-- The app calls it with the secret key (service_role).
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(public.username_available('BEN'), false, 'F5: username_available(): taken name -> false (case-insensitive)');
select is(public.username_available('ANN'), false, 'F5: username_available(): another taken name -> false');
select is(public.username_available('fresh_name'), true, 'F5: username_available(): free valid name -> true');
select is(coalesce(public.username_available('a%'),true) or coalesce(public.username_available('ann%'),true)
          or coalesce(public.username_available('no spaces'),true) or coalesce(public.username_available(null),true)
          or coalesce(public.username_available(repeat('x',25)),true), false,
  'F5: username_available(): invalid format (wildcards, spaces, null, too long) -> false');
reset role;
set local "request.jwt.claims" = '';
create table public.zz_t(id int); create function public.zz_f() returns int language sql as 'select 1';
select ok(not has_table_privilege('anon','public.zz_t','TRUNCATE') and not has_table_privilege('anon','public.zz_t','INSERT')
      and not has_function_privilege('anon','public.zz_f()','EXECUTE'),'F6: future tables/functions no longer granted to anon');
select * from finish();
rollback;
