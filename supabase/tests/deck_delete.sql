-- Spellbranch: deleting a deck (no migration; 001's policy and FKs). Run after
-- 001-008 are applied. Self-contained; everything is rolled back.
--
-- What a delete does, and what this checks:
--   * only the owner can delete ("Owners delete decks", 001); anyone else's
--     DELETE matches 0 rows and anon has no DELETE privilege at all;
--   * the deck's cards and comments cascade (ON DELETE CASCADE), including
--     comments other people wrote;
--   * forks survive with forked_from_id = NULL, and a deck that preferred the
--     deleted deck as its branch gets preferred_branch_id = NULL (ON DELETE
--     SET NULL), even when that deck belongs to someone else;
--   * none of the deck triggers (002 links, 008 colors) block any of this.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

-- Policy, grants, FKs, triggers ------------------------------------------------
select policies_are('public', 'decks',
  array['View decks by visibility', 'Owners insert decks', 'Owners update decks', 'Owners delete decks'],
  'decks has exactly the four expected policies');
select is((select cmd from pg_policies where tablename = 'decks' and policyname = 'Owners delete decks'),
  'DELETE', 'the delete policy is for DELETE');
select is((select roles::text[] from pg_policies where tablename = 'decks' and policyname = 'Owners delete decks'),
  array['authenticated'], 'the delete policy applies to authenticated only');
select ok((select qual from pg_policies where tablename = 'decks' and policyname = 'Owners delete decks')
          ~ '\(?auth\.uid\(\) = owner_id\)?', 'the delete policy is owner-only (auth.uid() = owner_id)');
select ok(not has_table_privilege('anon', 'public.decks', 'delete'), 'anon has no DELETE on decks');
select ok(has_table_privilege('authenticated', 'public.decks', 'delete'), 'authenticated has DELETE on decks (RLS decides)');
select ok(not has_table_privilege('authenticated', 'public.decks', 'truncate'), 'authenticated cannot TRUNCATE decks');

select is((select confdeltype::text from pg_constraint
           where conrelid = t::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute
             where attrelid = t::regclass and attname = col)]::int2[]),
          want, format('%s.%s: on delete %s', t, col, label))
from (values ('public.deck_cards', 'deck_id', 'c', 'cascade'),
             ('public.comments', 'deck_id', 'c', 'cascade'),
             ('public.decks', 'forked_from_id', 'n', 'set null'),
             ('public.decks', 'preferred_branch_id', 'n', 'set null')) as v(t, col, want, label);

-- No user trigger fires on DELETE of these tables (tgtype bit 8 = DELETE), so
-- a cascade can't be refused by one. SET NULL is an UPDATE of the FK columns
-- only, which the colors trigger (UPDATE OF colors) never sees and the links
-- trigger skips (the new value is NULL).
select is((select count(*)::int from pg_trigger
           where tgrelid in ('public.decks'::regclass, 'public.deck_cards'::regclass, 'public.comments'::regclass)
             and not tgisinternal and (tgtype & 8) <> 0),
          0, 'no user DELETE triggers on decks, deck_cards or comments');

-- Fixtures (as postgres) -------------------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('c9000000-0000-4000-8000-000000000001','authenticated','authenticated','dd.ann@example.test','{"username":"dd_ann"}'),
 ('c9000000-0000-4000-8000-000000000002','authenticated','authenticated','dd.bob@example.test','{"username":"dd_bob"}');
-- ann: "source" (public, UB, with a commander), "other" (private).
-- bob: "fork" (a fork of source, also UB), "bob branch" (a fork of ann's "parent").
-- ann: "parent" prefers bob's branch.
insert into public.decks (id, owner_id, name, format, visibility, colors, commander_scryfall_id,
                          commander_name, commander_type_line, commander_color_identity) values
 ('c9100000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001','source','commander','public',
  array['U','B'], 'cccccccc-0000-4000-8000-000000000001', 'Dimir Lord', 'Legendary Creature', array['U','B']),
 ('c9100000-0000-4000-8000-000000000002','c9000000-0000-4000-8000-000000000001','other','modern','private', array['R'], null, null, null, '{}'),
 ('c9100000-0000-4000-8000-000000000004','c9000000-0000-4000-8000-000000000001','parent','modern','public', array['G'], null, null, null, '{}');
insert into public.decks (id, owner_id, name, format, visibility, colors, forked_from_id) values
 ('c9100000-0000-4000-8000-000000000003','c9000000-0000-4000-8000-000000000002','fork','commander','public',
  array['U','B'], 'c9100000-0000-4000-8000-000000000001'),
 ('c9100000-0000-4000-8000-000000000005','c9000000-0000-4000-8000-000000000002','bob branch','modern','public',
  array['G'], 'c9100000-0000-4000-8000-000000000004');
update public.decks set preferred_branch_id = 'c9100000-0000-4000-8000-000000000003'
 where id = 'c9100000-0000-4000-8000-000000000001';
update public.decks set preferred_branch_id = 'c9100000-0000-4000-8000-000000000005'
 where id = 'c9100000-0000-4000-8000-000000000004';
insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, colors, color_identity, quantity) values
 ('c9100000-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','Opt','Instant', array['U'], array['U'], 1),
 ('c9100000-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002','Duress','Sorcery', array['B'], array['B'], 1),
 ('c9100000-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000001','Opt','Instant', array['U'], array['U'], 1),
 ('c9100000-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000003','Shock','Instant', array['R'], array['R'], 1);
insert into public.comments (deck_id, author_id, body) values
 ('c9100000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000002','nice deck'),
 ('c9100000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001','thanks');

create temp table n (label text primary key, v int);
grant all on n to anon, authenticated;

-- anon: no DELETE privilege at all -----------------------------------------------
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$delete from public.decks where id = 'c9100000-0000-4000-8000-000000000001'$$,
  '42501', null, 'anon cannot delete a deck');
reset role;

-- bob: not the owner, deletes nothing ----------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c9000000-0000-4000-8000-000000000002","role":"authenticated"}';
with d as (delete from public.decks where id = 'c9100000-0000-4000-8000-000000000001' returning 1)
insert into n select 'bob public', count(*) from d;
with d as (delete from public.decks where id = 'c9100000-0000-4000-8000-000000000002' returning 1)
insert into n select 'bob private', count(*) from d;
with d as (delete from public.deck_cards where deck_id = 'c9100000-0000-4000-8000-000000000001' returning 1)
insert into n select 'bob cards', count(*) from d;
reset role;
select is((select v from n where label = 'bob public'), 0, 'a non-owner deletes 0 rows of a public deck');
select is((select v from n where label = 'bob private'), 0, 'a non-owner deletes 0 rows of a private deck');
select is((select v from n where label = 'bob cards'), 0, 'a non-owner cannot delete the deck''s cards either');
select is((select count(*)::int from public.decks where owner_id = 'c9000000-0000-4000-8000-000000000001'), 3,
  'all of ann''s decks are still there');

-- ann deletes "source" ----------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.decks where id = 'c9100000-0000-4000-8000-000000000001'$$,
  'the owner deletes a deck with cards, comments, a commander and a fork, no trigger blocks it');
reset role;
select is((select count(*)::int from public.decks where id = 'c9100000-0000-4000-8000-000000000001'), 0, 'the deck is gone');
select is((select count(*)::int from public.deck_cards where deck_id = 'c9100000-0000-4000-8000-000000000001'), 0,
  'its cards cascaded');
select is((select count(*)::int from public.comments where deck_id = 'c9100000-0000-4000-8000-000000000001'), 0,
  'its comments cascaded, including the one bob wrote');
select is((select forked_from_id from public.decks where id = 'c9100000-0000-4000-8000-000000000003'), null::uuid,
  'bob''s fork survives with forked_from_id = NULL');
select is((select colors from public.decks where id = 'c9100000-0000-4000-8000-000000000003'), array['U','B'],
  'the fork keeps its colors');
select is((select count(*)::int from public.deck_cards where deck_id = 'c9100000-0000-4000-8000-000000000003'), 1,
  'the fork keeps its cards');
select is((select count(*)::int from public.deck_cards where deck_id = 'c9100000-0000-4000-8000-000000000002'), 1,
  'ann''s other deck is untouched');

-- bob deletes "bob branch", which ann's "parent" prefers ------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c9000000-0000-4000-8000-000000000002","role":"authenticated"}';
with d as (delete from public.decks where id = 'c9100000-0000-4000-8000-000000000005' returning 1)
insert into n select 'bob branch', count(*) from d;
reset role;
select is((select v from n where label = 'bob branch'), 1, 'bob deletes his own fork');
select is((select preferred_branch_id from public.decks where id = 'c9100000-0000-4000-8000-000000000004'), null::uuid,
  'ann''s deck that preferred it gets preferred_branch_id = NULL (RLS doesn''t stop the FK action)');
select is((select name from public.decks where id = 'c9100000-0000-4000-8000-000000000004'), 'parent',
  'ann''s deck is otherwise unchanged');

-- ann deletes her last two decks, then bob's fork is all that's left -------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated"}';
with d as (delete from public.decks where owner_id = 'c9000000-0000-4000-8000-000000000001' returning 1)
insert into n select 'ann all', count(*) from d;
with d as (delete from public.decks where owner_id = 'c9000000-0000-4000-8000-000000000002' returning 1)
insert into n select 'ann bob', count(*) from d;
reset role;
select is((select v from n where label = 'ann all'), 2, 'an owner-scoped delete only removes the owner''s decks');
select is((select v from n where label = 'ann bob'), 0, 'ann cannot delete bob''s decks in bulk');
select is((select count(*)::int from public.decks where owner_id = 'c9000000-0000-4000-8000-000000000002'), 1,
  'bob''s fork is still there');

-- The delete policy is permissive and the only DELETE policy on decks.
select is((select count(*)::int from pg_policies where tablename = 'decks' and cmd in ('DELETE', 'ALL')), 1,
  'exactly one policy governs DELETE on decks');

select * from finish();
rollback;
