-- Spellbranch 009: a deck's owner can see forks their friends make of it.
--
-- Apply after 001-008. Do not edit those files. Re-runnable: this only
-- replaces public.can_view_deck (same signature, owner, and grants).
--
-- Review F4 (002) still stands: a fork of a friends-only or private deck
-- starts private and not forkable, so the forker's other friends cannot see
-- it. That also hid the fork from the person who owns the source. This
-- widens view access by one case:
--
--   A signed-in viewer may see deck D when D.forked_from_id is set, the
--   viewer owns that source deck, and the viewer is friends with D.owner_id.
--
-- The source row is read by primary key inside this SECURITY DEFINER
-- function. It does not call can_view_deck, so the check cannot recurse
-- through the decks SELECT policy. Table owner bypasses RLS here; the
-- function returns only a boolean.
--
-- The new branch also requires viewer = auth.uid(). can_view_deck stays
-- executable (RLS calls it) and is therefore reachable as
-- /rpc/can_view_deck, where the caller picks both arguments. Without this
-- check a made-up deck row could ask whether some deck id belongs to a
-- friend. Policies, enforce_deck_links, and fork_deck already pass
-- auth.uid(), so those paths are unchanged. A direct call can only ask
-- "is this deck mine?".
--
-- Not granted: update, delete, or deck_cards writes stay owner-only (001).
-- A non-friend's fork stays hidden. The branch owner's other friends still
-- cannot see a private fork. fork_deck() defaults are unchanged.

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
      and public.is_friend(deck.owner_id, viewer)
      and exists (
        select 1
        from public.decks src
        where src.id = deck.forked_from_id
          and src.owner_id = viewer
      )
    );
$$;
