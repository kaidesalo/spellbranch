-- Spellbranch: read-only grant check for anon and authenticated.
--
-- Run this in the Supabase SQL editor BEFORE migration 020. It is one SELECT.
-- It does not insert, update, delete, grant, revoke, or alter anything.
--
-- The rows are the privileges migrations 001-020 expect: the grants a default
-- Supabase project gives a new public table, minus the revokes those
-- migrations actually write (012 column-only profiles, 010 column-only decks,
-- 016 anon SELECT on friendships and favorite_cards, 016 no authenticated
-- UPDATE on comments).
--
-- How to read state
--   missing   020 is not applied yet, or an earlier explicit grant did not
--             stick. Login fails while this row is missing:
--               authenticated | friendships | SELECT
--             The profiles policy in 002_rls_fixes.sql reads public.friendships
--             as the signed-in role, so Postgres errors with
--             "permission denied for table friendships" even for your own row.
--             comments SELECT for authenticated is the next table that policy
--             names.
--   extra     a privilege 010, 012, or 016 meant to remove is still there
--             (table SELECT on profiles or decks, anon SELECT on friendships
--             or favorite_cards, authenticated UPDATE on comments, SELECT on
--             profiles.bio or decks.copied_from_id). 020 does not revoke.
--   ok        matches what the migrations expect.
--
-- Sort puts missing first, then extra, then ok. Apply 020 only after reading
-- this. Run it again afterwards: the friendships and comments SELECT rows
-- should be ok, and anon friendships SELECT should still be ok (should_have
-- false, has_privilege false).

with table_expected(role_name, object_name, detail, privilege, should_have) as (
  values
    ('anon',          'profiles',            'table', 'SELECT', false),
    ('anon',          'profiles',            'table', 'INSERT', false),
    ('anon',          'profiles',            'table', 'UPDATE', false),
    ('anon',          'profiles',            'table', 'DELETE', false),
    ('authenticated', 'profiles',            'table', 'SELECT', false),
    ('authenticated', 'profiles',            'table', 'INSERT', true),
    ('authenticated', 'profiles',            'table', 'UPDATE', true),
    ('authenticated', 'profiles',            'table', 'DELETE', true),

    ('anon',          'friendships',         'table', 'SELECT', false),
    ('anon',          'friendships',         'table', 'INSERT', false),
    ('anon',          'friendships',         'table', 'UPDATE', false),
    ('anon',          'friendships',         'table', 'DELETE', false),
    ('authenticated', 'friendships',         'table', 'SELECT', true),
    ('authenticated', 'friendships',         'table', 'INSERT', true),
    ('authenticated', 'friendships',         'table', 'UPDATE', false),
    ('authenticated', 'friendships',         'table', 'DELETE', true),

    ('anon',          'favorite_cards',      'table', 'SELECT', false),
    ('anon',          'favorite_cards',      'table', 'INSERT', false),
    ('anon',          'favorite_cards',      'table', 'UPDATE', false),
    ('anon',          'favorite_cards',      'table', 'DELETE', false),
    ('authenticated', 'favorite_cards',      'table', 'SELECT', true),
    ('authenticated', 'favorite_cards',      'table', 'INSERT', true),
    ('authenticated', 'favorite_cards',      'table', 'UPDATE', true),
    ('authenticated', 'favorite_cards',      'table', 'DELETE', true),

    ('anon',          'decks',               'table', 'SELECT', false),
    ('anon',          'decks',               'table', 'INSERT', false),
    ('anon',          'decks',               'table', 'UPDATE', false),
    ('anon',          'decks',               'table', 'DELETE', false),
    ('authenticated', 'decks',               'table', 'SELECT', false),
    ('authenticated', 'decks',               'table', 'INSERT', true),
    ('authenticated', 'decks',               'table', 'UPDATE', true),
    ('authenticated', 'decks',               'table', 'DELETE', true),

    ('anon',          'deck_cards',          'table', 'SELECT', true),
    ('anon',          'deck_cards',          'table', 'INSERT', false),
    ('anon',          'deck_cards',          'table', 'UPDATE', false),
    ('anon',          'deck_cards',          'table', 'DELETE', false),
    ('authenticated', 'deck_cards',          'table', 'SELECT', true),
    ('authenticated', 'deck_cards',          'table', 'INSERT', true),
    ('authenticated', 'deck_cards',          'table', 'UPDATE', true),
    ('authenticated', 'deck_cards',          'table', 'DELETE', true),

    ('anon',          'comments',            'table', 'SELECT', true),
    ('anon',          'comments',            'table', 'INSERT', false),
    ('anon',          'comments',            'table', 'UPDATE', false),
    ('anon',          'comments',            'table', 'DELETE', false),
    ('authenticated', 'comments',            'table', 'SELECT', true),
    ('authenticated', 'comments',            'table', 'INSERT', true),
    ('authenticated', 'comments',            'table', 'UPDATE', false),
    ('authenticated', 'comments',            'table', 'DELETE', true),

    ('anon',          'deck_categories',     'table', 'SELECT', true),
    ('anon',          'deck_categories',     'table', 'INSERT', false),
    ('anon',          'deck_categories',     'table', 'UPDATE', false),
    ('anon',          'deck_categories',     'table', 'DELETE', false),
    ('authenticated', 'deck_categories',     'table', 'SELECT', true),
    ('authenticated', 'deck_categories',     'table', 'INSERT', true),
    ('authenticated', 'deck_categories',     'table', 'UPDATE', false),
    ('authenticated', 'deck_categories',     'table', 'DELETE', true),

    ('anon',          'deck_type_orders',    'table', 'SELECT', true),
    ('anon',          'deck_type_orders',    'table', 'INSERT', false),
    ('anon',          'deck_type_orders',    'table', 'UPDATE', false),
    ('anon',          'deck_type_orders',    'table', 'DELETE', false),
    ('authenticated', 'deck_type_orders',    'table', 'SELECT', true),
    ('authenticated', 'deck_type_orders',    'table', 'INSERT', true),
    ('authenticated', 'deck_type_orders',    'table', 'UPDATE', true),
    ('authenticated', 'deck_type_orders',    'table', 'DELETE', true),

    ('anon',          'collection_settings', 'table', 'SELECT', true),
    ('anon',          'collection_settings', 'table', 'INSERT', false),
    ('anon',          'collection_settings', 'table', 'UPDATE', false),
    ('anon',          'collection_settings', 'table', 'DELETE', false),
    ('authenticated', 'collection_settings', 'table', 'SELECT', true),
    ('authenticated', 'collection_settings', 'table', 'INSERT', true),
    ('authenticated', 'collection_settings', 'table', 'UPDATE', true),
    ('authenticated', 'collection_settings', 'table', 'DELETE', false),

    ('anon',          'collection_cards',    'table', 'SELECT', true),
    ('anon',          'collection_cards',    'table', 'INSERT', false),
    ('anon',          'collection_cards',    'table', 'UPDATE', false),
    ('anon',          'collection_cards',    'table', 'DELETE', false),
    ('authenticated', 'collection_cards',    'table', 'SELECT', true),
    ('authenticated', 'collection_cards',    'table', 'INSERT', true),
    ('authenticated', 'collection_cards',    'table', 'UPDATE', true),
    ('authenticated', 'collection_cards',    'table', 'DELETE', true)
),
table_rows as (
  select
    'table'::text as kind,
    e.role_name,
    e.object_name,
    e.detail,
    e.privilege,
    e.should_have,
    has_table_privilege(e.role_name, format('public.%I', e.object_name), e.privilege) as has_privilege
  from table_expected e
),
column_expected(role_name, object_name, detail, privilege, should_have) as (
  values
    ('anon',          'profiles', 'id',            'SELECT', true),
    ('anon',          'profiles', 'username',      'SELECT', true),
    ('anon',          'profiles', 'display_name',  'SELECT', true),
    ('anon',          'profiles', 'avatar_url',    'SELECT', true),
    ('anon',          'profiles', 'avatar_preset', 'SELECT', true),
    ('anon',          'profiles', 'created_at',    'SELECT', false),
    ('anon',          'profiles', 'bio',           'SELECT', false),
    ('authenticated', 'profiles', 'id',            'SELECT', true),
    ('authenticated', 'profiles', 'username',      'SELECT', true),
    ('authenticated', 'profiles', 'display_name',  'SELECT', true),
    ('authenticated', 'profiles', 'avatar_url',    'SELECT', true),
    ('authenticated', 'profiles', 'avatar_preset', 'SELECT', true),
    ('authenticated', 'profiles', 'created_at',    'SELECT', true),
    ('authenticated', 'profiles', 'bio',           'SELECT', false),

    ('authenticated', 'friendships', 'status', 'UPDATE', true),

    ('anon',          'decks', 'id',             'SELECT', true),
    ('anon',          'decks', 'owner_id',       'SELECT', true),
    ('anon',          'decks', 'is_precon',      'SELECT', true),
    ('anon',          'decks', 'copied_from_id', 'SELECT', false),
    ('authenticated', 'decks', 'id',             'SELECT', true),
    ('authenticated', 'decks', 'owner_id',       'SELECT', true),
    ('authenticated', 'decks', 'is_precon',      'SELECT', true),
    ('authenticated', 'decks', 'copied_from_id', 'SELECT', false),

    ('authenticated', 'deck_categories', 'name',     'UPDATE', true),
    ('authenticated', 'deck_categories', 'position', 'UPDATE', true),
    ('authenticated', 'deck_categories', 'deck_id',  'UPDATE', false)
),
column_rows as (
  select
    'column'::text as kind,
    e.role_name,
    e.object_name,
    e.detail,
    e.privilege,
    e.should_have,
    has_column_privilege(e.role_name, format('public.%I', e.object_name), e.detail, e.privilege) as has_privilege
  from column_expected e
),
function_expected(role_name, object_name, should_have) as (
  values
    ('anon',          'public.is_friend(uuid,uuid)',                 true),
    ('authenticated', 'public.is_friend(uuid,uuid)',                 true),
    ('anon',          'public.can_view_deck(public.decks,uuid)',     true),
    ('authenticated', 'public.can_view_deck(public.decks,uuid)',     true),
    ('anon',          'public.profile_bio(uuid)',                    false),
    ('authenticated', 'public.profile_bio(uuid)',                    true),
    ('anon',          'public.find_profile(text)',                   false),
    ('authenticated', 'public.find_profile(text)',                   true),
    ('anon',          'public.handle_new_user()',                    false),
    ('authenticated', 'public.handle_new_user()',                    false),
    ('anon',          'public.username_available(text)',             false),
    ('authenticated', 'public.username_available(text)',             false),
    ('service_role',  'public.username_available(text)',             true),
    ('anon',          'public.rate_limit_hit(text,integer,integer)', false),
    ('authenticated', 'public.rate_limit_hit(text,integer,integer)', false),
    ('service_role',  'public.rate_limit_hit(text,integer,integer)', true)
),
function_rows as (
  select
    'function'::text as kind,
    e.role_name,
    e.object_name,
    'execute'::text as detail,
    'EXECUTE'::text as privilege,
    e.should_have,
    has_function_privilege(e.role_name, e.object_name, 'execute') as has_privilege
  from function_expected e
),
all_rows as (
  select * from table_rows
  union all
  select * from column_rows
  union all
  select * from function_rows
)
select
  kind,
  role_name,
  object_name,
  detail,
  privilege,
  should_have,
  has_privilege,
  case
    when has_privilege = should_have then 'ok'
    when should_have then 'missing'
    else 'extra'
  end as state
from all_rows
order by
  case
    when has_privilege = should_have then 2
    when should_have then 0
    else 1
  end,
  kind,
  object_name,
  role_name,
  detail,
  privilege;
