-- Spellbranch: forks stack on the original deck, and copies stay independent (010).
--
-- Self-contained; rolled back. Ann owns the original deck. Ben and Cat are
-- her friends, and friends with each other. A branch of a branch is stored
-- on Ann's deck. A copy is not. copy_source_link() is the only way an API
-- role learns a source id for compare, and only when that source is visible.
-- copy_links_for_deck() is separate: only the two owners of a copy see the
-- cross-link, and it carries name and handle, not card text.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(62); -- keep in sync with the select ok/is/throws_ok/lives_ok count below
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

select ok(
  not has_column_privilege('anon', 'public.decks', 'copied_from_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.decks', 'copied_from_id', 'SELECT')
  and not has_table_privilege('anon', 'public.decks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.decks', 'SELECT')
  and has_column_privilege('anon', 'public.decks', 'name', 'SELECT')
  and has_column_privilege('authenticated', 'public.decks', 'id', 'SELECT'),
  'table SELECT is revoked; copied_from_id is hidden; other deck columns stay readable');
select ok(
  pg_get_functiondef('public.enforce_deck_links()'::regprocedure) ~ 'new.forked_from_id := root'
  and pg_get_functiondef('public.enforce_deck_links()'::regprocedure) ~ 'spellbranch_root_forks_locked'
  and pg_get_functiondef('public.enforce_deck_links()'::regprocedure) !~ 'select \* into'
  and pg_get_functiondef('public.enforce_deck_links()'::regprocedure) ~ 'enforce_fork_copy_rate'
  and pg_get_triggerdef((
    select oid from pg_trigger
    where tgname = 'decks_enforce_links' and not tgisinternal
      and tgrelid = 'public.decks'::regclass
  )) ~ 'copied_from_id',
  'enforce_deck_links is 010 (re-run 010 after re-running 002; the old trigger has no copied_from_id)');
select ok(
  not has_function_privilege('anon', 'public.copy_deck(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.copy_deck(uuid)', 'EXECUTE')
  and has_function_privilege('anon', 'public.copy_source_link(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.copy_source_link(uuid)', 'EXECUTE'),
  'copy_deck is signed-in only; copy_source_link is readable by anon and authenticated');
select ok(
  not (select prosecdef from pg_proc where oid = 'public.fork_deck(uuid)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""']
       from pg_proc where oid = 'public.copy_source_link(uuid)'::regprocedure),
  'fork_deck stays security invoker; copy_source_link is security definer with an empty search_path');
select ok(
  (select count(*) from regexp_matches(
     pg_get_functiondef('public.enforce_deck_links()'::regprocedure), 'lock_visible_deck', 'g')) >= 4
  and pg_get_functiondef('public.fork_deck(uuid)'::regprocedure) ~ 'lock_visible_deck'
  and pg_get_functiondef('public.copy_deck(uuid)'::regprocedure) ~ 'lock_visible_deck'
  and pg_get_functiondef('public.lock_visible_deck(uuid)'::regprocedure) ~ 'for share'
  and (select prosecdef from pg_proc where oid = 'public.lock_visible_deck(uuid)'::regprocedure)
  and not has_function_privilege('anon', 'public.lock_visible_deck(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.lock_visible_deck(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enforce_fork_copy_rate()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.enforce_fork_copy_rate()', 'EXECUTE'),
  'fork and copy lock visible rows via a definer; the shared rate limit is signed-in only');

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('e3000000-0000-4000-8000-000000000001','authenticated','authenticated','ann@example.test','{"username":"ann"}'),
 ('e3000000-0000-4000-8000-000000000002','authenticated','authenticated','ben@example.test','{"username":"ben"}'),
 ('e3000000-0000-4000-8000-000000000003','authenticated','authenticated','cat@example.test','{"username":"cat"}');
insert into public.friendships (id, requester_id, addressee_id, status) values
 ('e3010000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000002','accepted'),
 ('e3010000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000003','accepted'),
 ('e3010000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000003','accepted');

-- Nested rows the trigger would otherwise flatten on insert. This is the
-- shape 010's backfill repairs: grandchild -> child -> root, plus a cycle
-- the walk must leave alone.
alter table public.decks disable trigger decks_enforce_links;
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, colors, forked_from_id) values
 ('e3100000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Root','modern','','public',true,'{R}',null),
 ('e3100000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','Child','modern','','friends',true,'{R}','e3100000-0000-4000-8000-000000000001'),
 ('e3100000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000003','Grand','modern','','private',false,'{R}','e3100000-0000-4000-8000-000000000002'),
 ('e3100000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000001','Cycle A','modern','','private',false,null,'e3100000-0000-4000-8000-000000000005'),
 ('e3100000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000001','Cycle B','modern','','private',false,null,'e3100000-0000-4000-8000-000000000004');
update public.decks set preferred_branch_id = 'e3100000-0000-4000-8000-000000000002'
  where id = 'e3100000-0000-4000-8000-000000000001';
update public.decks set preferred_branch_id = 'e3100000-0000-4000-8000-000000000003'
  where id = 'e3100000-0000-4000-8000-000000000002';
alter table public.decks enable trigger decks_enforce_links;

do $$
declare
  updated integer := 1;
  guard integer := 0;
begin
  while updated > 0 and guard < 32 loop
    update public.decks child
    set forked_from_id = parent.forked_from_id
    from public.decks parent
    where child.forked_from_id = parent.id
      and parent.forked_from_id is not null
      and parent.forked_from_id <> child.id;
    get diagnostics updated = row_count;
    guard := guard + 1;
  end loop;
  update public.decks d
  set preferred_branch_id = null
  where d.preferred_branch_id is not null
    and not exists (
      select 1 from public.decks b
      where b.id = d.preferred_branch_id and b.forked_from_id = d.id
    );
end;
$$;

select is(
  (select forked_from_id from public.decks where id = 'e3100000-0000-4000-8000-000000000003'),
  'e3100000-0000-4000-8000-000000000001'::uuid,
  'backfill: a fork of a branch points at the root');
select is(
  (select forked_from_id from public.decks where id = 'e3100000-0000-4000-8000-000000000002'),
  'e3100000-0000-4000-8000-000000000001'::uuid,
  'backfill: the middle branch still points at the root');
select is(
  (select forked_from_id::text from public.decks where id = 'e3100000-0000-4000-8000-000000000004')
  || '/' ||
  (select forked_from_id::text from public.decks where id = 'e3100000-0000-4000-8000-000000000005'),
  'e3100000-0000-4000-8000-000000000005/e3100000-0000-4000-8000-000000000004',
  'backfill: a cycle is left unchanged and is not turned into a self-link');
select is(
  (select preferred_branch_id from public.decks where id = 'e3100000-0000-4000-8000-000000000001'),
  'e3100000-0000-4000-8000-000000000002'::uuid,
  'backfill: a root preferred branch that still forks the root is kept');
select is(
  (select preferred_branch_id from public.decks where id = 'e3100000-0000-4000-8000-000000000002'),
  null::uuid,
  'backfill: a preferred pointer that no longer names a fork of that deck is cleared');

insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, colors) values
 ('e3100000-0000-4000-8000-000000000010','e3000000-0000-4000-8000-000000000001','Live','modern','','public',true,'{R}');
insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity) values
 ('e3100000-0000-4000-8000-000000000010','bolt','Lightning Bolt','Instant','{R}','{R}',1);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
create temp table f_ben on commit drop as select public.fork_deck('e3100000-0000-4000-8000-000000000010') as id;
grant select on f_ben to anon, authenticated, service_role;

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
create temp table f_cat on commit drop as select public.fork_deck((select id from f_ben)) as id;
grant select on f_cat to anon, authenticated, service_role;

reset role;
set local "request.jwt.claims" = '';
select is(
  (select forked_from_id from public.decks where id = (select id from f_ben)),
  'e3100000-0000-4000-8000-000000000010'::uuid,
  'cross-user fork: Ben''s branch points at Ann''s deck');
select is(
  (select forked_from_id from public.decks where id = (select id from f_cat)),
  'e3100000-0000-4000-8000-000000000010'::uuid,
  'normal case: a visible root that allows forks accepts a fork of a fork');
select is(
  (select count(*) from public.decks where forked_from_id = (select id from f_ben)),
  0::bigint,
  'fork of a fork does not start a nested list under Ben''s branch');
select is(
  (select count(*) from public.deck_cards where deck_id = (select id from f_cat)),
  1::bigint,
  'fork of a fork still copies the card list');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.decks where forked_from_id = 'e3100000-0000-4000-8000-000000000010'),
  2::bigint,
  'Ann sees both friends'' branches, including the fork of a fork, on the original deck');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
create temp table f_copy on commit drop as select public.copy_deck('e3100000-0000-4000-8000-000000000010') as id;
grant select on f_copy to anon, authenticated, service_role;
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from f_copy))),
  'e3100000-0000-4000-8000-000000000010/false',
  'Ben can compare: copy_source_link returns the visible source');

reset role;
set local "request.jwt.claims" = '';
select is(
  (select forked_from_id is null and copied_from_id = 'e3100000-0000-4000-8000-000000000010'
     from public.decks where id = (select id from f_copy)),
  true,
  'a copy has its own id space: forked_from_id is null, copied_from_id is the source');
select is(
  (select count(*) from public.decks
    where forked_from_id = 'e3100000-0000-4000-8000-000000000010'
      and id = (select id from f_copy)),
  0::bigint,
  'a copy is not a branch of the source');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select copied_from_id from public.decks where id = (select id from f_copy)$$,
  '42501', null,
  'authenticated cannot select copied_from_id, even on their own copy');
select throws_ok(
  $$select * from public.decks where id = (select id from f_copy)$$,
  '42501', null,
  'authenticated cannot select * on decks (it includes copied_from_id)');
select lives_ok(
  $$select id, name from public.decks where id = (select id from f_copy)$$,
  'authenticated can still read the other columns of their copy');
select is(
  (select name from public.decks where id = (select id from f_copy)),
  'Live (copy)',
  'a short source name keeps the (copy) suffix');

reset role;
set local "request.jwt.claims" = '';
update public.decks set visibility = 'private', allow_forks = true
  where id = 'e3100000-0000-4000-8000-000000000010';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format($$select public.fork_deck(%L)$$, (select id from f_ben)),
  '42501', null,
  'forking a branch whose root is private and not visible to the caller fails');
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from f_copy))),
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from f_ben))),
  'a hidden source looks the same as a deck that is not a copy');
select is(
  (select link_role from public.copy_links_for_deck((select id from f_copy))),
  'original',
  'the copier still sees the hidden source through the owner cross-link');
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_copy)),
  1::bigint,
  'a friend of the copier can see the copy');
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from f_copy))),
  'null/false',
  'that friend is not told a hidden source exists');
select is(
  (select count(*) from public.copy_links_for_deck((select id from f_copy))),
  0::bigint,
  'that friend gets no owner cross-link');
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link('e3100000-0000-4000-8000-000000000010')),
  'null/false',
  'a deck Ben cannot see does not reveal whether it is a copy');

reset role;
set local "request.jwt.claims" = '';
update public.decks set visibility = 'public', allow_forks = false
  where id = 'e3100000-0000-4000-8000-000000000010';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format($$select public.fork_deck(%L)$$, (select id from f_ben)),
  '42501',
  'The original deck does not allow forks',
  'forking a forkable branch whose root has allow_forks = false fails');
select throws_ok(
  $$select public.copy_deck('e3100000-0000-4000-8000-000000000010')$$,
  '42501', null,
  'copying a visible deck that does not allow forks is refused');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select copied_from_id from public.decks$$,
  '42501', null,
  'anon cannot select copied_from_id');
select throws_ok(
  $$select * from public.decks$$,
  '42501', null,
  'anon cannot select * on decks');
select throws_ok(
  $$select public.copy_deck('e3100000-0000-4000-8000-000000000010')$$,
  '42501', null,
  'anon cannot call copy_deck()');

reset role;
set local "request.jwt.claims" = '';
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, colors) values
 ('e3100000-0000-4000-8000-000000000020','e3000000-0000-4000-8000-000000000001',repeat('n', 80),'modern','','public',true,'{R}');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
create temp table f_long on commit drop as select public.copy_deck('e3100000-0000-4000-8000-000000000020') as id;
grant select on f_long to anon, authenticated, service_role;
reset role;
set local "request.jwt.claims" = '';
select is(
  (select name from public.decks where id = (select id from f_long)),
  repeat('n', 73) || ' (copy)',
  'copy_deck shortens an 80-character source name so the default fits in 80');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
create temp table f_long_branch on commit drop as
  select public.fork_deck('e3100000-0000-4000-8000-000000000020') as id;
grant select on f_long_branch to anon, authenticated, service_role;
reset role;
set local "request.jwt.claims" = '';
select is(
  (select name from public.decks where id = (select id from f_long_branch)),
  repeat('n', 71) || ' (branch)',
  'fork_deck shortens an 80-character source name so the default fits in 80');

-- Copy cross-link: only the owner of the exact deck that was copied and the
-- owner of the copy. Ann owns the root. Ben owns the branch. Cat and Dan copy it.
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('e3000000-0000-4000-8000-000000000004','authenticated','authenticated','dan@example.test','{"username":"dan"}'),
 ('e3000000-0000-4000-8000-000000000005','authenticated','authenticated','eve@example.test','{"username":"eve"}'),
 ('e3000000-0000-4000-8000-000000000006','authenticated','authenticated','stranger@example.test','{"username":"stranger"}');
insert into public.friendships (id, requester_id, addressee_id, status) values
 ('e3010000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000005','accepted'),
 ('e3010000-0000-4000-8000-000000000006','e3000000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000005','accepted');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
update public.decks set visibility = 'public', allow_forks = true where id = (select id from f_ben);
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
create temp table c_copy on commit drop as select public.copy_deck((select id from f_ben)) as id;
grant select on c_copy to anon, authenticated, service_role;
update public.decks set name = 'Carol copy', notes = 'COPY-SECRET', visibility = 'private', allow_forks = false
  where id = (select id from c_copy);
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000004","role":"authenticated"}';
create temp table d_copy on commit drop as select public.copy_deck((select id from f_ben)) as id;
grant select on d_copy to anon, authenticated, service_role;
update public.decks set name = 'Dan copy' where id = (select id from d_copy);

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.copy_links_for_deck((select id from f_ben))),
  2::bigint,
  'source owner sees every copy of that exact deck');
select is(
  (select count(*) from public.decks where id = (select id from c_copy)),
  0::bigint,
  'source owner still cannot read the private copy row');
select is(
  (select link_role || '/' || other_name || '/' || other_username || '/' || other_visible::text
     from public.copy_links_for_deck((select id from f_ben))
    where other_id = (select id from c_copy)),
  'copy/Carol copy/cat/false',
  'source owner sees a private copy''s name and handle, not that it is openable');
select ok(
  (select to_jsonb(t) from public.copy_links_for_deck((select id from f_ben)) t
    where other_id = (select id from c_copy)) ? 'other_name'
  and not ((select to_jsonb(t) from public.copy_links_for_deck((select id from f_ben)) t
    where other_id = (select id from c_copy))::text like '%COPY-SECRET%'),
  'the cross-link does not carry the other deck''s notes');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select link_role || '/' || other_id::text || '/' || other_username || '/' || other_visible::text
     from public.copy_links_for_deck((select id from c_copy))),
  'original/' || (select id::text from f_ben) || '/ben/true',
  'copier sees the source as the original on the copy');
select is(
  (select other_id::text from public.copy_links_for_deck((select id from f_ben))),
  (select id::text from c_copy),
  'copier sees only their own copy on the source, not someone else''s');
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from c_copy))),
  (select id::text from f_ben) || '/false',
  'compare-to-source still works for the copier when the source is visible');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.copy_links_for_deck((select id from f_ben))),
  0::bigint,
  'root owner of the stack, who does not own the copied deck, sees no copy link');
select is(
  (select count(*) from public.copy_links_for_deck((select id from c_copy))),
  0::bigint,
  'root owner cannot see the private copy, so the function returns nothing');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  1::bigint,
  'a friend of the source owner can see the public source');
select is(
  (select count(*) from public.copy_links_for_deck((select id from f_ben))),
  0::bigint,
  'a friend of the source owner sees no copy link');
select is(
  (select count(*) from public.decks where id = (select id from d_copy)),
  1::bigint,
  'a friend of the copier can see the friends-only copy');
select is(
  (select count(*) from public.copy_links_for_deck((select id from d_copy))),
  0::bigint,
  'a friend of the copier sees no link back to the source');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select other_id::text from public.copy_links_for_deck((select id from f_ben))),
  (select id::text from d_copy),
  'the second copier sees only their own copy on the source');
select is(
  (select link_role || '/' || other_username
     from public.copy_links_for_deck((select id from d_copy))),
  'original/ben',
  'the second copier sees the source as the original');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*) from public.decks where id = (select id from f_ben)),
  1::bigint,
  'a stranger can see the public source');
select is(
  (select count(*) from public.copy_links_for_deck((select id from f_ben))),
  0::bigint,
  'a stranger who can see the public source sees no copy link');

set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from c_copy))),
  'null/false',
  'source owner does not get card-level compare access to a private copy');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  format($$select * from public.copy_links_for_deck(%L)$$, (select id from f_ben)),
  '42501', null,
  'anon cannot call copy_links_for_deck()');

reset role;
set local "request.jwt.claims" = '';
delete from public.decks where id = 'e3100000-0000-4000-8000-000000000010';
select is(
  (select copied_from_id from public.decks where id = (select id from f_copy)),
  null::uuid,
  'deleting the source clears the copy link and keeps the copy');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*) from public.copy_links_for_deck((select id from f_copy))),
  0::bigint,
  'a deleted source leaves no cross-link for the copier');

-- 20 forks + copies per user per 10 minutes. A fresh user, so earlier calls
-- in this file do not spend the budget.
reset role;
set local "request.jwt.claims" = '';
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('e3000000-0000-4000-8000-000000000007','authenticated','authenticated','rat@example.test','{"username":"rat"}'),
 ('e3000000-0000-4000-8000-000000000008','authenticated','authenticated','max@example.test','{"username":"max"}');
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks) values
 ('e3100000-0000-4000-8000-000000000030','e3000000-0000-4000-8000-000000000007','Rate','modern','','public',true);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
declare i integer;
begin
  for i in 1..20 loop
    perform public.fork_deck('e3100000-0000-4000-8000-000000000030');
  end loop;
end $$;
select throws_ok(
  $$select public.fork_deck('e3100000-0000-4000-8000-000000000030')$$,
  'PT429',
  'Too many attempts. Please try again later.',
  'the 21st fork or copy in 10 minutes is refused');
select throws_ok(
  $$select public.copy_deck('e3100000-0000-4000-8000-000000000030')$$,
  'PT429',
  'Too many attempts. Please try again later.',
  'forks and copies share one budget');
reset role;
set local "request.jwt.claims" = '';
select is(
  (select count(*) from public.decks where forked_from_id = 'e3100000-0000-4000-8000-000000000030'),
  20::bigint,
  'a refused fork does not land');
select is(
  (select count from private.rate_limits
    where key = 'db:fork_or_copy:uid:e3000000-0000-4000-8000-000000000007'),
  20,
  'a refused call rolls its own increment back');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000008","role":"authenticated"}';
select lives_ok(
  $$select public.fork_deck('e3100000-0000-4000-8000-000000000030')$$,
  'another user still has a fork budget');

select * from finish();
rollback;
