-- Spellbranch: RLS and integrity fixes on top of 001_initial.sql
--
-- Re-runnable where practical (create or replace / drop ... if exists).
-- Summary:
--   1. friendships: only the addressee may change status; requests must start
--      as 'pending'; requester/addressee columns are immutable; one row per pair.
--   2. profiles: email column removed (auth.users already stores it); anon gets a
--      narrow read path (id, username, display_name, avatar_url) limited to
--      people behind public content, exposed via public.public_profiles.
--      Signed-in users no longer read every profile: only themselves, people
--      they share a friendship row with, and authors of decks/comments they
--      can see. Finding someone new = find_profile(username), exact match.
--   3. usernames: format check + case-insensitive uniqueness; handle_new_user
--      sanitises the requested username and falls back to a unique one.
--   4. decks.updated_at maintained by trigger.
--   5. decks: forked_from_id must point at a deck the caller may fork;
--      preferred_branch_id must point at a fork of the same deck.
--   6. fork_deck(source uuid): security-invoker helper that copies a deck + cards.
--   7. Hardening: security-definer functions use search_path = '';
--      is_friend() only answers for the calling user; table/function grants
--      tightened (no TRUNCATE/MAINTAIN for API roles, no writes for anon) and
--      default privileges no longer auto-grant future objects to anon.
--   8. comments: author or deck owner may delete.
--   9. URL hygiene: avatar_url must be https; card image_uri must be a
--      https://cards.scryfall.io/ URL.
--
-- Security review fixes (PR #1 review, F1-F4 + F6-F9) are folded in here
-- rather than in a 003, since no project has this migration applied yet.

-- ---------------------------------------------------------------------------
-- 0. Helper functions (hardened re-definitions)
-- ---------------------------------------------------------------------------

-- is_friend is SECURITY DEFINER so it can read friendships regardless of RLS.
-- Because it is callable over the API (/rpc/is_friend), it only answers when
-- the caller is one of the two users; otherwise anyone could map the friend graph.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select auth.uid()) in (a, b)
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = a and f.addressee_id = b)
          or (f.requester_id = b and f.addressee_id = a)
        )
    );
$$;

create or replace function public.can_view_deck(deck public.decks, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    deck.visibility = 'public'
    or (viewer is not null and deck.owner_id = viewer)
    or (
      deck.visibility = 'friends'
      and viewer is not null
      and public.is_friend(deck.owner_id, viewer)
    );
$$;

-- ---------------------------------------------------------------------------
-- 1. Friendships
-- ---------------------------------------------------------------------------

alter table public.friendships
  drop constraint if exists friendships_not_self;
alter table public.friendships
  add constraint friendships_not_self check (requester_id <> addressee_id);

-- One friendship row per unordered pair (A->B and B->A can't both exist).
create unique index if not exists friendships_pair_uidx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

drop policy if exists "Users can request friends" on public.friendships;
create policy "Users can request friends"
  on public.friendships for insert
  to authenticated
  with check (
    (select auth.uid()) = requester_id
    and status = 'pending'
  );

drop policy if exists "Participants update friendship" on public.friendships;
drop policy if exists "Addressee responds to friendship" on public.friendships;
create policy "Addressee responds to friendship"
  on public.friendships for update
  to authenticated
  using ((select auth.uid()) = addressee_id)
  with check (
    (select auth.uid()) = addressee_id
    and status in ('accepted', 'declined')
  );

-- Only the status column is updatable through the API, so the addressee cannot
-- rewrite requester_id/addressee_id to forge a friendship with someone else.
revoke update on public.friendships from anon, authenticated;
grant update (status) on public.friendships to authenticated;

-- Deletes (review F1): the requester may cancel a pending request or unfriend
-- an accepted one, but may NOT delete a declined row -- otherwise "decline"
-- has no effect (delete + re-send loop). The addressee may delete any row
-- (unfriend, or clear a declined request to allow a fresh one later).
-- Soft block: the addressee may also flip an accepted row to 'declined'. The
-- requester then can neither delete the row nor re-send (unique pair index),
-- so this acts as a soft block until the addressee deletes the row.
drop policy if exists "Participants delete friendship" on public.friendships;
drop policy if exists "Requester cancels or unfriends" on public.friendships;
drop policy if exists "Addressee deletes friendship" on public.friendships;
create policy "Requester cancels or unfriends"
  on public.friendships for delete
  to authenticated
  using ((select auth.uid()) = requester_id and status in ('pending', 'accepted'));
create policy "Addressee deletes friendship"
  on public.friendships for delete
  to authenticated
  using ((select auth.uid()) = addressee_id);

-- ---------------------------------------------------------------------------
-- 2. Profiles: drop email, add public read path
-- ---------------------------------------------------------------------------

-- Email lives in auth.users; the app should read the signed-in user's email
-- from the Supabase session, never from other users' profiles.
alter table public.profiles drop column if exists email;

-- Anonymous visitors may read profiles only for people behind public content
-- (owners of public decks, authors of comments on public decks), and only the
-- id/username/display_name/avatar_url columns (column grants below).
drop policy if exists "Anon reads profiles behind public content" on public.profiles;
create policy "Anon reads profiles behind public content"
  on public.profiles for select
  to anon
  using (
    exists (
      select 1 from public.decks d
      where d.owner_id = profiles.id and d.visibility = 'public'
    )
    or exists (
      select 1
      from public.comments c
      join public.decks d on d.id = c.deck_id
      where c.author_id = profiles.id and d.visibility = 'public'
    )
  );

revoke all on public.profiles from anon;
grant select (id, username, display_name, avatar_url) on public.profiles to anon;

-- Signed-in users (review F5): no directory browsing. A profile is readable
-- if it is your own, you share a friendship row with them (any status, so
-- friend lists and pending/declined requests render), or they own a deck or
-- wrote a comment that you can see (the decks/comments subqueries run under
-- your own RLS). Everyone else is reachable only via find_profile() below.
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Authenticated read related profiles" on public.profiles;
create policy "Authenticated read related profiles"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = profiles.id and f.addressee_id = (select auth.uid()))
         or (f.addressee_id = profiles.id and f.requester_id = (select auth.uid()))
    )
    or exists (select 1 from public.decks d where d.owner_id = profiles.id)       -- decks I can see
    or exists (select 1 from public.comments c where c.author_id = profiles.id)   -- comments I can see
  );

-- Safe projection for UI that may render for logged-out visitors.
-- security_invoker: the caller's RLS + column grants apply (not a definer view).
-- create or replace (not drop + create): find_profile() returns this row type.
create or replace view public.public_profiles
  with (security_invoker = true)
as
  select id, username, display_name, avatar_url
  from public.profiles;

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

-- find_profile(username): look someone up to send a friend request (review F5).
-- Case-insensitive EXACT match on the whole username: plain equality on
-- lower() (served by profiles_username_lower_uidx), never LIKE/ILIKE/regex
-- matching, so '%' and '_' can't widen the match. Returns at most one row
-- with only the public columns. Input that can't be a valid username returns
-- nothing. SECURITY DEFINER so it can see profiles the caller's RLS hides;
-- authenticated callers only. Rate limiting (if needed) belongs in the app.
create or replace function public.find_profile(username text)
returns setof public.public_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where (select auth.uid()) is not null
    and find_profile.username ~ '^[A-Za-z0-9_]{3,24}$'
    and lower(p.username) = lower(find_profile.username)
  limit 1;
$$;
revoke execute on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;

-- username_available(candidate): sign-up check (runs before login, so anon may
-- call it). Same format rule as profiles_username_format; invalid input ->
-- false. Exact case-insensitive equality only, returns just a boolean. It
-- reveals whether one exact username exists per request (no listing or
-- prefix search), but it lets anon check names one unauthenticated request at
-- a time, which is a cheaper oracle than the old sign-up flow: sign-up never
-- errored on a taken name, handle_new_user just added a suffix, so probing
-- used to cost an account per guess. Low impact (a hit yields no id/profile).
-- Planned follow-up: once the app is wired up, call this from a rate-limited
-- Next.js route / server action and `revoke execute ... from anon`.
-- handle_new_user still resolves races (unique index + suffix retry).
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(candidate ~ '^[A-Za-z0-9_]{3,24}$', false)
    and not exists (
      select 1 from public.profiles p
      where lower(p.username) = lower(candidate)
    );
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Usernames
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_]{3,24}$');

alter table public.profiles
  drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length
  check (char_length(display_name) between 1 and 48);

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := coalesce(new.raw_user_meta_data ->> 'username', '');
  base text;
  candidate text;
  display text;
  v_constraint text;
  attempt int := 0;
begin
  if requested ~ '^[A-Za-z0-9_]{3,24}$' then
    base := requested;
  else
    -- Never derive a public username from the email address (review F2):
    -- usernames are readable by other users (and anon, behind public content).
    base := 'player_' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  base := left(base, 24);
  candidate := base;

  display := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 48), '');

  loop
    begin
      insert into public.profiles (id, username, display_name)
      values (new.id, candidate, coalesce(display, candidate));
      return new;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'profiles_pkey' then
        raise;  -- profile already exists for this user; don't mask it
      end if;
      attempt := attempt + 1;
      if attempt >= 8 then
        candidate := 'u_' || left(replace(new.id::text, '-', ''), 22);
      else
        candidate := left(base, 19) || '_' || substr(md5(random()::text), 1, 4);
      end if;
      if attempt > 9 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists decks_set_updated_at on public.decks;
create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Fork / preferred-branch integrity
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER (review F3): every lookup runs under the caller's RLS, so
-- a deck the caller can't see is indistinguishable from one that doesn't
-- exist (single 42501 for both), and a preferred branch must be a fork the
-- caller can see. Trust is "does the current DB role already bypass RLS on
-- decks" (BYPASSRLS / superuser, e.g. service_role, or a member of the table
-- owner role, e.g. postgres running migrations/seed), not the JWT role claim.
-- Trust also requires that there is no end-user identity (auth.uid() is null,
-- review N1): inside a SECURITY DEFINER function owned by postgres,
-- current_user is the owner, so without this an API user calling such a
-- function would skip the allow_forks/visibility checks. service_role
-- without a sub, migrations and seed are still trusted.
-- Unchanged values on UPDATE are not re-checked, so editing a branch still
-- works after its source stops allowing forks.
create or replace function public.enforce_deck_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  caller uuid := auth.uid();
  trusted boolean := (
    coalesce((select r.rolbypassrls or r.rolsuper
              from pg_catalog.pg_roles r where r.rolname = current_user), false)
    or pg_catalog.pg_has_role(
         current_user,
         (select c.relowner from pg_catalog.pg_class c
          where c.oid = 'public.decks'::pg_catalog.regclass),
         'MEMBER')
  ) and caller is null;
begin
  if new.forked_from_id is not null
     and (tg_op = 'INSERT' or new.forked_from_id is distinct from old.forked_from_id) then
    if new.forked_from_id = new.id then
      raise exception 'A deck cannot be forked from itself' using errcode = '23514';
    end if;

    if not trusted then
      select * into src from public.decks where id = new.forked_from_id;  -- RLS applies
      if not (
        found
        and caller is not null
        and (src.owner_id = caller or (src.allow_forks and public.can_view_deck(src, caller)))
      ) then
        -- Same error whether the source is missing or merely invisible.
        raise exception 'You are not allowed to fork this deck' using errcode = '42501';
      end if;
    elsif not exists (select 1 from public.decks where id = new.forked_from_id) then
      raise exception 'Source deck not found' using errcode = '23503';
    end if;
  end if;

  if new.preferred_branch_id is not null
     and (tg_op = 'INSERT' or new.preferred_branch_id is distinct from old.preferred_branch_id) then
    -- A brand-new deck has no forks yet. Rejecting preferred_branch_id on API
    -- INSERTs also closes the "reuse someone else's deck id" probe (BEFORE
    -- triggers run before the primary-key check).
    if (not trusted and tg_op = 'INSERT') or not exists (
      select 1 from public.decks b                       -- RLS applies: must be visible
      where b.id = new.preferred_branch_id
        and b.forked_from_id = new.id
    ) then
      raise exception 'Preferred branch must be a visible fork of this deck' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists decks_enforce_links on public.decks;
create trigger decks_enforce_links
  before insert or update of forked_from_id, preferred_branch_id on public.decks
  for each row execute function public.enforce_deck_links();

-- ---------------------------------------------------------------------------
-- 6. fork_deck(source uuid)
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: runs with the caller's RLS. The source must be visible to
-- the caller, the branch insert goes through the decks insert policy and
-- enforce_deck_links(), and card copies go through the deck_cards policies.
-- Public sources become friends-only, forkable branches (like forkDeckAction).
-- Forks of friends-only/private sources start private and non-forkable
-- (review F4), so a friend's fork doesn't silently widen the audience.
create or replace function public.fork_deck(source uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into src from public.decks where id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  insert into public.decks (owner_id, name, format, notes, visibility, allow_forks, forked_from_id)
  values (
    auth.uid(),
    src.name || ' (branch)',
    src.format,
    src.notes,
    case when src.visibility = 'public' then 'friends' else 'private' end,
    src.visibility = 'public',
    src.id
  )
  returning id into new_id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, oracle_text, quantity)
  select new_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, oracle_text, quantity
  from public.deck_cards
  where deck_id = src.id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. Comments: author or deck owner may delete (review F7)
-- ---------------------------------------------------------------------------

drop policy if exists "Authors or deck owners delete comments" on public.comments;
create policy "Authors or deck owners delete comments"
  on public.comments for delete
  to authenticated
  using (
    (select auth.uid()) = author_id
    or exists (
      select 1 from public.decks d
      where d.id = comments.deck_id and d.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6c. URL hygiene for user-supplied image URLs (review F8)
-- ---------------------------------------------------------------------------
-- These render to anon visitors on public decks/profiles: no http tracking
-- pixels, no javascript:/data: schemes. Tighten avatar_url to a storage host
-- once avatar uploads exist.

alter table public.profiles drop constraint if exists profiles_avatar_url_https;
alter table public.profiles add constraint profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~ '^https://');
alter table public.deck_cards drop constraint if exists deck_cards_image_uri_scryfall;
alter table public.deck_cards add constraint deck_cards_image_uri_scryfall
  check (image_uri is null or image_uri ~ '^https://cards\.scryfall\.io/');
alter table public.favorite_cards drop constraint if exists favorite_cards_image_uri_scryfall;
alter table public.favorite_cards add constraint favorite_cards_image_uri_scryfall
  check (image_uri is null or image_uri ~ '^https://cards\.scryfall\.io/');

-- ---------------------------------------------------------------------------
-- 7. Grants hardening
-- ---------------------------------------------------------------------------

-- TRUNCATE bypasses RLS; API roles never need it (nor REFERENCES/TRIGGER).
revoke truncate, references, trigger
  on public.profiles, public.friendships, public.favorite_cards,
     public.decks, public.deck_cards, public.comments
  from anon, authenticated;

-- anon is read-only (RLS already blocks writes; this is defence in depth).
revoke insert, update, delete
  on public.friendships, public.favorite_cards,
     public.decks, public.deck_cards, public.comments
  from anon;

-- Trigger functions are never called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_deck_links() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- fork_deck is for signed-in users only.
revoke execute on function public.fork_deck(uuid) from public, anon;
grant execute on function public.fork_deck(uuid) to authenticated;

-- is_friend / can_view_deck stay executable: RLS policies call them as the
-- requesting role. is_friend only answers for the caller (see above).

-- PG17+ MAINTAIN (VACUUM/ANALYZE/LOCK ... ACCESS EXCLUSIVE, etc.) is not needed
-- by API roles (review F6). Guarded so this file still runs on PG < 17.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.profiles, public.friendships, public.favorite_cards,
               public.decks, public.deck_cards, public.comments from anon, authenticated';
  end if;
end $$;

-- Default privileges (review F6): Supabase's defaults grant ALL on every new
-- table/function/sequence in public to anon/authenticated. Make future objects
-- created by postgres (i.e. by our migrations) closed by default; each new
-- migration must grant what it needs explicitly. anon keeps SELECT on future
-- tables (RLS still applies); authenticated keeps SELECT/INSERT/UPDATE/DELETE.
-- The final `revoke execute on functions from public` has no `in schema`, so
-- it applies to functions postgres creates in ANY schema (e.g. a future
-- `private` schema for F10, or auth hooks): those need explicit grants too.
-- NOTE: this only changes defaults for role postgres. Check `\ddp` on the real
-- project (other roles such as supabase_admin may carry their own defaults),
-- and see `auto_expose_new_tables` in config.toml.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete on tables from anon;
alter default privileges for role postgres in schema public
  revoke usage, update on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges for role postgres in schema public
               revoke maintain on tables from anon, authenticated';
  end if;
end $$;
