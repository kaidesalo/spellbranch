-- Spellbranch 020: explicit API-role grants the earlier migrations assumed.
--
-- Apply after 001-019. 011 is reserved and is not used. This file does not
-- edit earlier migrations. It is its own transaction and is safe to re-run
-- (GRANT is idempotent). It only GRANTs. It does not create policies, drop
-- policies, or REVOKE anything.
--
-- Run supabase/checks/grants_preflight.sql first and read it. Then run this
-- file in the Supabase SQL editor (or `supabase db push`). Do not apply it
-- from the app deploy.
--
-- Why login bounces
-- -----------------
-- "Authenticated read related profiles" (002_rls_fixes.sql) is the SELECT
-- policy on public.profiles. It is not security definer. Postgres plans every
-- table it names, including the caller's own row:
--
--   id = auth.uid()
--   OR exists (select 1 from public.friendships ...)
--   OR exists (select 1 from public.decks ...)
--   OR exists (select 1 from public.comments ...)
--
-- authenticated needs SELECT on friendships and on comments or the profiles
-- read errors with "permission denied for table friendships" (friendships is
-- the first of those tables). getSupabaseSessionUser then returns null and
-- the app sends the browser back to /login with no message.
--
-- 001 never GRANTs friendships or comments. It relied on Supabase granting
-- new public tables to anon and authenticated. 016 only revokes friendships
-- SELECT from public and anon. A project created without those default
-- grants (auto_expose_new_tables off, or migrations applied as a role whose
-- default privileges were never set) leaves authenticated with no SELECT.
--
-- What this grants
-- ----------------
-- The table privileges a default Supabase project still has after 001-019.
-- Not granted, on purpose:
--   * anon SELECT on friendships or favorite_cards (016 revoked those)
--   * table-level SELECT on profiles (012) or decks (010); those stay
--     column grants, so bio and decks.copied_from_id stay unreadable
--   * authenticated UPDATE on comments (016 revoked it)
--   * table-level UPDATE on friendships (002 left only the status column)
-- is_friend() and can_view_deck() stay executable for anon and authenticated.
-- 002 says so (RLS calls them) but never writes the GRANT. Both are security
-- definer and already refuse to answer for anyone except the caller.

begin;

-- friendships: the profiles policy reads this table as the signed-in role.
-- 002 already grants update (status). Repeated here so one re-run is enough
-- on a project that never had the default table grants.
grant select, insert, delete on table public.friendships to authenticated;
grant update (status) on table public.friendships to authenticated;

-- favorite_cards: 001's "Favorites owned by user" is FOR ALL, so the role
-- needs every row privilege. 016 removed anon SELECT; do not put it back.
grant select, insert, update, delete on table public.favorite_cards to authenticated;

-- comments: the profiles policy also reads this table. 002 removed anon
-- writes. 016 removed authenticated UPDATE. anon SELECT stays, matching the
-- old default (public comments are readable under RLS).
grant select on table public.comments to anon;
grant select, insert, delete on table public.comments to authenticated;

-- deck_cards: no migration states these grants. 002 removed anon writes.
grant select on table public.deck_cards to anon;
grant select, insert, update, delete on table public.deck_cards to authenticated;

-- decks writes. SELECT stays the column list from 010 plus is_precon (018).
-- A table-level SELECT would expose copied_from_id.
grant insert, update, delete on table public.decks to authenticated;

-- profiles writes. SELECT stays the column list from 012 and 017.
-- A table-level SELECT would expose bio.
grant insert, update, delete on table public.profiles to authenticated;

grant execute on function public.is_friend(uuid, uuid) to anon, authenticated;
grant execute on function public.can_view_deck(public.decks, uuid) to anon, authenticated;

commit;
