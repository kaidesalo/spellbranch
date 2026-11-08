-- Spellbranch 009: a deck's owner can see every direct fork of it.
--
-- Apply after 001-008. Do not edit those files. Re-runnable: this replaces
-- public.can_view_deck (same signature, owner, and grants), adds
-- public.can_comment_on_deck, and points the comments INSERT policy at it.
--
-- Review F4 (002) still stands: a fork of a friends-only or private deck
-- starts private and not forkable, so the forker's other friends cannot see
-- it. The source owner can. A signed-in viewer may see deck D when
-- D.forked_from_id is set and the viewer owns that source deck. Friendship
-- is not required. The lookup is one primary key read inside this
-- SECURITY DEFINER function. It does not call can_view_deck, so it cannot
-- recurse, and it does not walk to grandchildren (only the direct source).
--
-- The new branch also requires viewer = auth.uid(). can_view_deck stays
-- executable (RLS calls it) and is therefore reachable as
-- /rpc/can_view_deck, where the caller picks both arguments. Without this
-- check a made-up deck row could ask whether some deck id exists and who
-- owns it. Policies, enforce_deck_links, and fork_deck already pass
-- auth.uid(). A direct call can only ask "is this deck mine?".
--
-- Comments do not follow the new rule. can_comment_on_deck is the pre-009
-- visibility check (public, owner, or friends-only plus is_friend). The
-- source owner can read a stranger's private fork and its cards, and cannot
-- comment on it.
--
-- Not granted: update, delete, or deck_cards writes stay owner-only (001).
-- The branch owner's other friends still cannot see a private fork.
-- fork_deck() defaults are unchanged. The reverse is not granted: forking
-- does not reveal the source owner's other private decks.

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
    )
    or (
      viewer is not null
      and viewer = (select auth.uid())
      and deck.forked_from_id is not null
      and exists (
        select 1
        from public.decks src
        where src.id = deck.forked_from_id
          and src.owner_id = viewer
      )
    );
$$;

-- Pre-009 visibility. Security invoker: the only table read is is_friend,
-- which already answers only for the caller. No source-deck lookup.
create or replace function public.can_comment_on_deck(deck public.decks, viewer uuid)
returns boolean
language sql
stable
security invoker
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

revoke all on function public.can_comment_on_deck(public.decks, uuid) from public, anon, authenticated;
grant execute on function public.can_comment_on_deck(public.decks, uuid) to authenticated;

drop policy if exists "Authorized users comment" on public.comments;
create policy "Authorized users comment"
  on public.comments for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.decks d
      where d.id = comments.deck_id
        and public.can_comment_on_deck(d, (select auth.uid()))
    )
  );
