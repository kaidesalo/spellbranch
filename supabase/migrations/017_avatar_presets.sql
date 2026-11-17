-- Spellbranch 017: preset profile pictures.
--
-- Kaide must run migration 017 on the hosted project (SQL editor or
-- `supabase db push`). The app does not apply it. Until it is applied, reads
-- ignore the missing column and the save action returns a friendly error.
--
-- Adds profiles.avatar_preset, a nullable key for one of the five built-in
-- pictures in public/avatars/. The app stores the key, never a URL.
--
-- RLS: "Users update own profile" (001) is FOR UPDATE TO authenticated
-- USING (auth.uid() = id) WITH CHECK (auth.uid() = id). It is row-wide, so
-- the new column is already covered. No new policy.
--
-- SELECT is column-scoped (012 revoked table SELECT and re-granted named
-- columns). A new column is not readable until it is granted. That grant is
-- not an RLS policy.

alter table public.profiles
  add column if not exists avatar_preset text;

alter table public.profiles
  drop constraint if exists profiles_avatar_preset_key;

alter table public.profiles
  add constraint profiles_avatar_preset_key
  check (
    avatar_preset is null
    or avatar_preset in ('ghalta', 'lathliss', 'gisa', 'sai', 'giada')
  );

grant select (avatar_preset) on table public.profiles to anon, authenticated;
