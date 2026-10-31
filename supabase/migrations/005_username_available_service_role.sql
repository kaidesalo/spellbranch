-- Spellbranch: username_available() for service_role only (security review I2).
--
-- Sign-up checks a username through the app's server-only secret-key client
-- (src/lib/supabase/service.ts), after the app's per-IP limit (20 checks per
-- 10 minutes). Until now anon and authenticated could call the function
-- directly through PostgREST and skip that limit. This takes EXECUTE away
-- from them; the function itself is unchanged (still a boolean, SECURITY
-- DEFINER, empty search_path).
--
-- Deploy order: ship the app version that calls it with the secret key
-- first, then apply this migration. An older app (anon/cookie client) gets
-- "permission denied" and sign-up answers "Could not create account right
-- now" until it is updated.
--
-- Safe to re-run. Re-running 002 by hand afterwards would grant anon and
-- authenticated again; re-run 005 after it.

revoke execute on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to service_role;
