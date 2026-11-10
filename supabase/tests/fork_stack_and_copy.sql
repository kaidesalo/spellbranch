-- Spellbranch: forks stack on the original deck, and copies stay independent (010).
--
-- Self-contained; rolled back. Ann owns the original deck. Ben and Cat are
-- her friends, and friends with each other. A branch of a branch is stored
-- on Ann's deck. A copy is not. copy_source_link() is the only way an API
-- role learns a source id, and only when that source is visible.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22); -- keep in sync with the select ok/is/throws_ok count below
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant all on all sequences in schema pg_temp to anon, authenticated, service_role;

select ok(
  not has_column_privilege('anon', 'public.decks', 'copied_from_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.decks', 'copied_from_id', 'SELECT'),
  'copied_from_id is not selectable by anon or authenticated');
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
  'fork of a fork: Cat''s branch points at the original deck, not at Ben''s');
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
  'the source column itself is not readable on a deck the caller owns');

reset role;
set local "request.jwt.claims" = '';
update public.decks set visibility = 'private', allow_forks = false
  where id = 'e3100000-0000-4000-8000-000000000010';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select coalesce(source_id::text, 'null') || '/' || unavailable::text
     from public.copy_source_link((select id from f_copy))),
  'null/true',
  'a source Ben can no longer see is unavailable and the id is not returned');
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
  $$select public.copy_deck('e3100000-0000-4000-8000-000000000010')$$,
  '42501', null,
  'copying a visible deck that does not allow forks is refused');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select public.copy_deck('e3100000-0000-4000-8000-000000000010')$$,
  '42501', null,
  'anon cannot call copy_deck()');

reset role;
set local "request.jwt.claims" = '';
delete from public.decks where id = 'e3100000-0000-4000-8000-000000000010';
select is(
  (select copied_from_id from public.decks where id = (select id from f_copy)),
  null::uuid,
  'deleting the source clears the copy link and keeps the copy');

select * from finish();
rollback;
