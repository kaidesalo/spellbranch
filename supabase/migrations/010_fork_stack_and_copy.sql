-- Spellbranch 010: stack every fork on the original deck, and add copies.
--
-- Apply after 001-009, in its own transaction (this file is BEGIN/COMMIT).
-- Do not edit 001-009. 009 may be applied before or after this file: this
-- migration does not replace can_view_deck. If 009 is still pending, apply
-- it first (also in one transaction) so the source-owner visibility rule is
-- in place before new forks are created. This file does not change the
-- decks.name length constraint.
--
-- Re-running 002 after 010 restores 002's enforce_deck_links() and its
-- trigger (no root flattening, no copy checks, and forked_from_id is not
-- rewritten to the original deck). Re-run 010 after any re-run of 002.
-- 006 and 008 likewise replace fork_deck() with a version that reads every
-- column; re-run 010 after those too, or forks fail once copied_from_id is
-- hidden from API roles.
--
-- Do not apply this file to the hosted project from the app deploy. Run it
-- in the Supabase SQL editor (or `supabase db push`) before the app that
-- calls copy_deck / copy_source_link.
--
-- Branch model
-- ------------
-- forked_from_id is the original (root) deck, never an intermediate branch.
-- fork_deck() still records the deck the caller actually forked.
-- enforce_deck_links() checks that the caller may fork THAT deck (same rule
-- as 002), then rewrites forked_from_id to the root of that deck. Forking a
-- branch of a branch therefore lands in the original deck's branch list.
-- A copy is not a branch: copied_from_id points at the deck that was copied,
-- and forked_from_id stays null, so the copy is its own root.
--
-- Backfill
-- --------
-- Existing nested forks (a branch whose parent is itself a branch) are
-- walked to the root. The walk refuses to point a row at itself, caps at
-- 32 hops, and does not delete or rewrite rows stuck in a cycle. Those are
-- left as they are and reported with a NOTICE. Preferred-branch pointers
-- that no longer point at a fork of that deck are cleared. Valid ones stay.
--
-- Privacy
-- -------
-- copied_from_id is not selectable by anon or authenticated. Table-level
-- SELECT on decks is revoked from those roles and re-granted per column,
-- leaving copied_from_id out: a column-only revoke does not hide a column
-- while the table grant remains. Readers learn a source id only from
-- copy_source_link(), and only when they can already view both decks. A
-- hidden or missing source comes back as unavailable with a null id.
-- copy_links_for_deck() is the branch-menu exception. It returns the other
-- deck's id, name, owner id, and username to the two owners of that copy
-- (the owner of the exact deck that was copied, and the owner of the copy),
-- even when the other deck is private. It returns no card text. other_visible
-- is false when normal visibility hides the other deck. Everyone else,
-- including friends and the root owner of a stack the source sits in, gets
-- no row. Anon cannot execute it. A deleted source clears copied_from_id
-- (ON DELETE SET NULL) and the link disappears.
-- Copying uses the same permission as forking the clicked deck (owner, or
-- allow_forks and can_view_deck). It does not consult the original deck's
-- allow_forks. Visibility of the new row follows the same F4 defaults as
-- fork_deck().
--
-- Forking a branch also requires permission on the original deck. If that
-- deck is visible and has allow_forks = false (and the caller does not own
-- it), the error says so. If the caller cannot see the original deck, the
-- refusal is the same generic 42501 as any other forbidden fork.

begin;

-- ---------------------------------------------------------------------------
-- 1. copied_from_id
-- ---------------------------------------------------------------------------

alter table public.decks
  add column if not exists copied_from_id uuid references public.decks (id) on delete set null;

create index if not exists decks_copied_from_idx on public.decks (copied_from_id);

comment on column public.decks.copied_from_id is
  'Independent copy of this deck. Not a branch. API roles cannot select it; use copy_source_link().';

-- ---------------------------------------------------------------------------
-- 2. enforce_deck_links(): 002, plus root flattening and copy checks
-- ---------------------------------------------------------------------------

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
  declared uuid;
  root uuid;
  parent uuid;
  hop integer;
  seen uuid[];
  root_row public.decks;
begin
  if new.forked_from_id is not null
     and (tg_op = 'INSERT' or new.forked_from_id is distinct from old.forked_from_id) then
    declared := new.forked_from_id;
    if declared = new.id then
      raise exception 'A deck cannot be forked from itself' using errcode = '23514';
    end if;

    if not trusted then
      -- Every column except copied_from_id. API roles cannot read that one,
      -- and this function runs as the caller. The null keeps the row type.
      select
        d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
        d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
        d.commander_scryfall_id, d.commander_name, d.commander_type_line,
        d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
        d.commander_color_identity, d.colors,
        null::uuid
      into src
      from public.decks d
      where d.id = declared;  -- RLS applies
      if not (
        found
        and caller is not null
        and (src.owner_id = caller or (src.allow_forks and public.can_view_deck(src, caller)))
      ) then
        -- Same error whether the source is missing or merely invisible.
        raise exception 'You are not allowed to fork this deck' using errcode = '42501';
      end if;
    elsif not exists (select 1 from public.decks where id = declared) then
      raise exception 'Source deck not found' using errcode = '23503';
    end if;

    -- Attach the new row to the original deck. Each hop reads forked_from_id
    -- off a row this command can see, so a hidden root id is one the caller
    -- already had on a visible branch. Cycles and runaway chains are refused
    -- for API roles; a trusted role keeps the id it wrote so the backfill
    -- below can report leftovers instead of aborting.
    root := declared;
    seen := array[new.id];
    hop := 0;
    while hop < 32 loop
      if root = any (seen) then
        if not trusted then
          raise exception 'You are not allowed to fork this deck' using errcode = '42501';
        end if;
        root := declared;
        exit;
      end if;
      seen := seen || root;
      select d.forked_from_id into parent from public.decks d where d.id = root;
      exit when not found or parent is null;
      root := parent;
      hop := hop + 1;
    end loop;
    if hop >= 32 and not trusted then
      raise exception 'You are not allowed to fork this deck' using errcode = '42501';
    end if;

    -- The new row joins the original deck, so the caller must be allowed to
    -- fork that deck too: they own it, or it allows forks and they can see
    -- it. A root they cannot see is refused with the generic error (no hint).
    if not trusted then
      select
        d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
        d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
        d.commander_scryfall_id, d.commander_name, d.commander_type_line,
        d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
        d.commander_color_identity, d.colors,
        null::uuid
      into root_row
      from public.decks d
      where d.id = root;
      if not found
         or caller is null
         or not (
           root_row.owner_id = caller
           or (root_row.allow_forks and public.can_view_deck(root_row, caller))
         ) then
        if found
           and caller is not null
           and root_row.owner_id is distinct from caller
           and not root_row.allow_forks
           and public.can_view_deck(root_row, caller) then
          raise exception 'The original deck does not allow forks'
            using errcode = '42501', hint = 'spellbranch_root_forks_locked';
        end if;
        raise exception 'You are not allowed to fork this deck' using errcode = '42501';
      end if;
    end if;
    new.forked_from_id := root;
  end if;

  if new.copied_from_id is not null
     and tg_op = 'UPDATE'
     and new.copied_from_id is distinct from old.copied_from_id
     and not trusted then
    -- ON DELETE SET NULL clears the column; that path leaves it null and
    -- does not enter here. Retargeting a copy is not allowed.
    raise exception 'The copy source cannot be changed' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.copied_from_id is not null then
    if new.copied_from_id = new.id then
      raise exception 'A deck cannot be copied from itself' using errcode = '23514';
    end if;
    if not trusted then
      select
        d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
        d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
        d.commander_scryfall_id, d.commander_name, d.commander_type_line,
        d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
        d.commander_color_identity, d.colors,
        null::uuid
      into src
      from public.decks d
      where d.id = new.copied_from_id;  -- RLS applies
      if not (
        found
        and caller is not null
        and (src.owner_id = caller or (src.allow_forks and public.can_view_deck(src, caller)))
      ) then
        raise exception 'You are not allowed to copy this deck' using errcode = '42501';
      end if;
    elsif not exists (select 1 from public.decks where id = new.copied_from_id) then
      raise exception 'Source deck not found' using errcode = '23503';
    end if;
  end if;

  if new.copied_from_id is not null and new.forked_from_id is not null then
    raise exception 'A branch cannot also be a copy' using errcode = '23514';
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
  before insert or update of forked_from_id, preferred_branch_id, copied_from_id
  on public.decks
  for each row execute function public.enforce_deck_links();

revoke execute on function public.enforce_deck_links() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill nested forks onto their root
-- ---------------------------------------------------------------------------
-- One pass walks a child to its parent's parent. The trigger above then
-- finishes the walk to the root for each updated row. A row whose parent
-- points back at it is skipped (parent.forked_from_id <> child.id), so a
-- cycle is not rewritten into a self-link and is not deleted. The cap
-- matches the trigger. Nothing here changes copied_from_id (the column is
-- new and null).

do $$
declare
  updated integer := 1;
  guard integer := 0;
  nested integer;
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

  -- A preferred branch is only meaningful when it is a fork of this deck.
  -- After the walk, a branch's old preferred child is a sibling on the root,
  -- so that pointer is cleared. A root's preferred branch still qualifies.
  update public.decks d
  set preferred_branch_id = null
  where d.preferred_branch_id is not null
    and not exists (
      select 1
      from public.decks b
      where b.id = d.preferred_branch_id
        and b.forked_from_id = d.id
    );

  select count(*) into nested
  from public.decks child
  join public.decks parent on parent.id = child.forked_from_id
  where parent.forked_from_id is not null;

  if nested > 0 then
    raise notice '010_fork_stack_and_copy: % branch row(s) still point at another branch (a cycle). Left unchanged.', nested;
  else
    raise notice '010_fork_stack_and_copy: nested forks now point at their root.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. fork_deck(): 008's body. The trigger attaches the row to the root.
-- ---------------------------------------------------------------------------
-- forked_from_id is the deck passed in (the clicked deck). The trigger
-- checks permission on that deck, rewrites forked_from_id to the root, and
-- refuses the insert when the caller cannot fork the root (allow_forks is
-- false, or the root is not visible). Do not point this insert at the root
-- directly: that would skip the clicked-deck check.

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

  select
    d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
    d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
    d.commander_scryfall_id, d.commander_name, d.commander_type_line,
    d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
    d.commander_color_identity, d.colors,
    null::uuid
  into src
  from public.decks d
  where d.id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  insert into public.decks (
    owner_id, name, format, notes, visibility, allow_forks, forked_from_id,
    commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,
    commander_image_uri, commander_art_uri, commander_color_identity, colors
  )
  values (
    auth.uid(),
    src.name || ' (branch)',
    src.format,
    src.notes,
    case when src.visibility = 'public' then 'friends' else 'private' end,
    src.visibility = 'public',
    src.id,
    src.commander_scryfall_id,
    src.commander_name,
    src.commander_type_line,
    src.commander_mana_cost,
    src.commander_image_uri,
    src.commander_art_uri,
    src.commander_color_identity,
    src.colors
  )
  returning id into new_id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity)
  select new_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         oracle_text, quantity
  from public.deck_cards
  where deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.fork_deck(uuid) from public, anon;
grant execute on function public.fork_deck(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. copy_deck(): an independent deck. Not a branch of the source.
-- ---------------------------------------------------------------------------

create or replace function public.copy_deck(source uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  new_id uuid;
  copy_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select
    d.id, d.owner_id, d.name, d.format, d.notes, d.visibility, d.allow_forks,
    d.forked_from_id, d.preferred_branch_id, d.created_at, d.updated_at,
    d.commander_scryfall_id, d.commander_name, d.commander_type_line,
    d.commander_mana_cost, d.commander_image_uri, d.commander_art_uri,
    d.commander_color_identity, d.colors,
    null::uuid
  into src
  from public.decks d
  where d.id = source;
  if not found then
    raise exception 'Deck not found' using errcode = 'P0002';
  end if;

  -- ' (copy)' is 7 characters. decks.name is at most 80 (003). Shorten the
  -- source name so the default always fits; a caller-supplied name is applied
  -- by the app afterwards and is checked there.
  copy_name := src.name || ' (copy)';
  if char_length(copy_name) > 80 then
    copy_name := left(src.name, 80 - char_length(' (copy)')) || ' (copy)';
  end if;

  insert into public.decks (
    owner_id, name, format, notes, visibility, allow_forks, copied_from_id,
    commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,
    commander_image_uri, commander_art_uri, commander_color_identity, colors
  )
  values (
    auth.uid(),
    copy_name,
    src.format,
    src.notes,
    case when src.visibility = 'public' then 'friends' else 'private' end,
    src.visibility = 'public',
    src.id,
    src.commander_scryfall_id,
    src.commander_name,
    src.commander_type_line,
    src.commander_mana_cost,
    src.commander_image_uri,
    src.commander_art_uri,
    src.commander_color_identity,
    src.colors
  )
  returning id into new_id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity)
  select new_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         oracle_text, quantity
  from public.deck_cards
  where deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.copy_deck(uuid) from public, anon;
grant execute on function public.copy_deck(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. copy_source_link(): the only read path for copied_from_id
-- ---------------------------------------------------------------------------
-- One row. source_id is set only when the caller can view the deck and the
-- source. unavailable is true when the deck is visible, a source is stored,
-- and that source is missing or not visible. Both null/false when the deck
-- itself is missing or hidden, so the function does not confirm that a
-- guessed id exists.

create or replace function public.copy_source_link(target uuid)
returns table (source_id uuid, unavailable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  deck public.decks;
  src public.decks;
  viewer uuid := auth.uid();
begin
  select * into deck from public.decks where id = target;
  if not found or not public.can_view_deck(deck, viewer) then
    return query select null::uuid, false;
    return;
  end if;
  if deck.copied_from_id is null then
    return query select null::uuid, false;
    return;
  end if;
  select * into src from public.decks where id = deck.copied_from_id;
  if found and public.can_view_deck(src, viewer) then
    return query select src.id, false;
  else
    return query select null::uuid, true;
  end if;
end;
$$;

revoke execute on function public.copy_source_link(uuid) from public;
grant execute on function public.copy_source_link(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6b. copy_links_for_deck(): the owner-only cross-link in the branch list
-- ---------------------------------------------------------------------------
-- A copy is still its own root. This does not put it in forked_from_id.
-- The two parties to that one copy (owner of the exact deck that was copied,
-- and owner of the copy) each see the other deck's id, name, and username.
-- They see it even when the other deck is private. other_visible is false
-- in that case so the app can skip compare and card links. Nobody else,
-- including a friend or the root owner of a stack the source sits in, gets
-- a row. A deck the caller cannot view returns nothing, so the function
-- does not reveal that a hidden deck has copies. Notes and cards are not
-- returned. A deleted source has copied_from_id null, so that side is gone.

create or replace function public.copy_links_for_deck(target uuid)
returns table (
  other_id uuid,
  other_name text,
  other_owner_id uuid,
  other_username text,
  link_role text,
  other_visible boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  deck public.decks;
  other public.decks;
  uname text;
begin
  if viewer is null then
    return;
  end if;

  select * into deck from public.decks where id = target;
  if not found or not public.can_view_deck(deck, viewer) then
    return;
  end if;

  if deck.copied_from_id is not null then
    select * into other from public.decks where id = deck.copied_from_id;
    if found and (viewer = deck.owner_id or viewer = other.owner_id) then
      select p.username into uname from public.profiles p where p.id = other.owner_id;
      return query
        select other.id, other.name, other.owner_id, uname, 'original'::text,
               public.can_view_deck(other, viewer);
    end if;
  end if;

  for other in
    select c.* from public.decks c where c.copied_from_id = deck.id
  loop
    if viewer = deck.owner_id or viewer = other.owner_id then
      select p.username into uname from public.profiles p where p.id = other.owner_id;
      return query
        select other.id, other.name, other.owner_id, uname, 'copy'::text,
               public.can_view_deck(other, viewer);
    end if;
  end loop;
end;
$$;

revoke execute on function public.copy_links_for_deck(uuid) from public, anon;
grant execute on function public.copy_links_for_deck(uuid) to authenticated;

-- Other tables' policies used to call can_view_deck(deck_row). Building that
-- row in the caller's query needs SELECT on every column, including
-- copied_from_id. The decks SELECT policy is already can_view_deck, so "a
-- row of decks is visible" is the same check and only reads granted columns.
drop policy if exists "View deck cards with deck access" on public.deck_cards;
create policy "View deck cards with deck access"
  on public.deck_cards for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_cards.deck_id
    )
  );

drop policy if exists "View comments with deck access" on public.comments;
create policy "View comments with deck access"
  on public.comments for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = comments.deck_id
    )
  );

drop policy if exists "Authorized users comment" on public.comments;
create policy "Authorized users comment"
  on public.comments for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.decks d
      where d.id = comments.deck_id
    )
  );

-- Table-level SELECT would keep copied_from_id readable after a column
-- revoke. Drop the table grant, then grant every other column. INSERT and
-- UPDATE stay as they are so copy_deck can write the column and ON DELETE
-- SET NULL can clear it. service_role is untouched.
revoke select on table public.decks from public, anon, authenticated;
grant select (
  id,
  owner_id,
  name,
  format,
  notes,
  visibility,
  allow_forks,
  forked_from_id,
  preferred_branch_id,
  created_at,
  updated_at,
  commander_scryfall_id,
  commander_name,
  commander_type_line,
  commander_mana_cost,
  commander_image_uri,
  commander_art_uri,
  commander_color_identity,
  colors
) on table public.decks to anon, authenticated;

commit;
