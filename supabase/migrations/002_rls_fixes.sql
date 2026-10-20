-- Spellbranch: RLS and integrity fixes on top of 001_initial.sql
--
-- Re-runnable where practical (create or replace / drop ... if exists).
-- Summary:
--   1. friendships: only the addressee may change status; requests must start
--      as 'pending'; requester/addressee columns are immutable; one row per pair.
--   2. profiles: email column removed (auth.users already stores it); anon gets a
--      narrow read path (id, username, display_name, avatar_url) limited to
--      people behind public content, exposed via public.public_profiles.
--   3. usernames: format check + case-insensitive uniqueness; handle_new_user
--      sanitises the requested username and falls back to a unique one.
--   4. decks.updated_at maintained by trigger.
--   5. decks: forked_from_id must point at a deck the caller may fork;
--      preferred_branch_id must point at a fork of the same deck.
--   6. fork_deck(source uuid): security-invoker helper that copies a deck + cards.
--   7. Hardening: security-definer functions use search_path = '';
--      is_friend() only answers for the calling user; table/function grants
--      tightened (no TRUNCATE for API roles, no writes for anon).

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
-- (Re-sending after a decline = delete the old row, insert a new pending one.)
revoke update on public.friendships from anon, authenticated;
grant update (status) on public.friendships to authenticated;

-- "Participants delete friendship" from 001 is kept: requester can cancel,
-- either side can unfriend.

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

-- Safe projection for UI that may render for logged-out visitors.
-- security_invoker: the caller's RLS + column grants apply (not a definer view).
drop view if exists public.public_profiles;
create view public.public_profiles
  with (security_invoker = true)
as
  select id, username, display_name, avatar_url
  from public.profiles;

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

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
    base := regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^A-Za-z0-9_]', '', 'g');
    if char_length(base) < 3 then
      base := 'player';
    end if;
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

-- SECURITY DEFINER so it can see the source deck / branch even when the caller
-- can't (e.g. a private branch owned by someone else). Fork permission is only
-- enforced for API callers (anon/authenticated JWTs); service_role and direct
-- postgres sessions (migrations, seed) are trusted. preferred_branch_id is
-- always checked. Unchanged values on UPDATE are not re-checked, so editing a
-- branch still works after its source stops allowing forks.
create or replace function public.enforce_deck_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.decks;
  caller uuid := auth.uid();
  is_api_caller boolean := caller is not null
    or coalesce(auth.role(), '') in ('anon', 'authenticated');
begin
  if new.forked_from_id is not null
     and (tg_op = 'INSERT' or new.forked_from_id is distinct from old.forked_from_id) then
    if new.forked_from_id = new.id then
      raise exception 'A deck cannot be forked from itself' using errcode = '23514';
    end if;

    select * into src from public.decks where id = new.forked_from_id;
    if not found then
      raise exception 'Source deck not found' using errcode = '23503';
    end if;

    if is_api_caller and not (
      caller is not null
      and (
        src.owner_id = caller
        or (src.allow_forks and public.can_view_deck(src, caller))
      )
    ) then
      raise exception 'You are not allowed to fork this deck' using errcode = '42501';
    end if;
  end if;

  if new.preferred_branch_id is not null
     and (tg_op = 'INSERT' or new.preferred_branch_id is distinct from old.preferred_branch_id) then
    if not exists (
      select 1 from public.decks b
      where b.id = new.preferred_branch_id
        and b.forked_from_id = new.id
    ) then
      raise exception 'Preferred branch must be a fork of this deck' using errcode = '23514';
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
-- Mirrors forkDeckAction: public sources become friends-only branches.
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
    case when src.visibility = 'public' then 'friends' else src.visibility end,
    true,
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
