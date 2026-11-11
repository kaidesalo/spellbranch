-- Spellbranch 012: profiles.bio is readable by the owner and accepted friends only.
--
-- Apply after 001-010, in its own transaction (this file is BEGIN/COMMIT).
-- 009 and 010 do not need to be re-run for this file, and this file does not
-- edit them. 011 is reserved for another change and is not required here:
-- apply 012 after 010, and apply 011 whenever that change lands.
-- Do not apply this file to the hosted project from the app deploy. Run it
-- in the Supabase SQL editor (or `supabase db push`) before the app that
-- calls profile_bio().
--
-- 002 lets any signed-in user who can see a profile row (self, any friendship
-- status, or a deck/comment they can see) read every column, including bio.
-- Anon was already limited to id, username, display_name, avatar_url.
--
-- Table-level SELECT would keep bio readable after a column-only revoke, the
-- same way 010 hides copied_from_id. SELECT is revoked from public, anon, and
-- authenticated, then re-granted per column with bio left out. UPDATE is
-- untouched, so the owner can still save a bio. service_role is untouched.
--
-- The only read path is profile_bio(user_id). It is security definer with an
-- empty search_path. It returns the text for the owner and for an accepted
-- friend, and null for everyone else (pending, declined, public-deck viewers,
-- strangers, anon). A missing profile is the same null. Anon cannot execute it.
--
-- Re-run 012 after anything that grants SELECT on public.profiles back to
-- anon or authenticated (a re-applied default privilege, not a re-run of 002:
-- 002 does not grant table SELECT to authenticated).

begin;

revoke select on table public.profiles from public, anon, authenticated;
revoke select (bio) on table public.profiles from public, anon, authenticated;

grant select (id, username, display_name, avatar_url)
  on table public.profiles to anon;

grant select (id, username, display_name, avatar_url, created_at)
  on table public.profiles to authenticated;

create or replace function public.profile_bio(user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.bio
  from public.profiles p
  where p.id = profile_bio.user_id
    and (select auth.uid()) is not null
    and (
      (select auth.uid()) = profile_bio.user_id
      or public.is_friend((select auth.uid()), profile_bio.user_id)
    );
$$;

revoke all on function public.profile_bio(uuid) from public;
revoke execute on function public.profile_bio(uuid) from anon;
grant execute on function public.profile_bio(uuid) to authenticated;

comment on function public.profile_bio(uuid) is
  'Bio text for the owner or an accepted friend. Null for everyone else, including pending and declined friendships. Anon cannot execute it.';

commit;
