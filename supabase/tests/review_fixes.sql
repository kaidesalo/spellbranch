-- Spellbranch: checks for the PR #1 security review fixes (pgTAP).
--
-- Adapted from Cipher's review harness (tests/cipher_fixed.sql, PR #1 security
-- review, 2026-10-20) -- credit to Cipher for the original checks. Finding
-- labels follow the review's numbering (F1-F10). The F5 checks (profile read
-- scope / find_profile) are pgTAP TODOs: F5 is an open product decision.
--
-- Run with `supabase test db` (or psql on a db with 001 + 002 applied).
-- Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);
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
-- F5 (open follow-up, product call): narrower profile reads + find_profile().
select todo_start('F5 follow-up: profile read scope not decided yet');
select is((select count(*) from public.profiles where id::text like 'c0000000%'), 3::bigint, 'F5: dan sees himself, ann (shared request row), cat (comment on a public deck) only');
select is((select count(*) from public.profiles where id='c0000000-0000-4000-8000-000000000002'), 0::bigint, 'F5: dan cannot read unrelated ben');
select ok(to_regprocedure('public.find_profile(text)') is not null, 'F5: exact-match find_profile() lookup exists');
select todo_end();
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
-- ann: preferred branch must be visible
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(format($$update public.decks set preferred_branch_id=%L where id='c2000000-0000-4000-8000-000000000002'$$,(select id from f_friends)),'23514',null,'F3: cannot point at a fork you cannot see');
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
select ok(not has_table_privilege('anon','public.decks','MAINTAIN'),'F6: MAINTAIN revoked');
create table public.zz_t(id int); create function public.zz_f() returns int language sql as 'select 1';
select ok(not has_table_privilege('anon','public.zz_t','TRUNCATE') and not has_table_privilege('anon','public.zz_t','INSERT')
      and not has_function_privilege('anon','public.zz_f()','EXECUTE'),'F6: future tables/functions no longer granted to anon');
select * from finish();
rollback;
