-- Spellbranch 013: categories inside a deck.
--
-- Apply after 001-010, in its own transaction (this file is BEGIN/COMMIT).
-- 011 is reserved. 012 (profile bios) may be applied before or after this
-- file: this migration does not read or change it. Do not edit 001-012.
--
-- Re-running 002, 006, 008, or 010 replaces fork_deck() (and 010 also
-- replaces copy_deck()) with a version that does not copy categories.
-- Re-run 013 after any of those.
--
-- Do not apply this file to the hosted project from the app deploy. Run it
-- in the Supabase SQL editor (or `supabase db push`) before the app that
-- reads deck_categories.
--
-- Model
-- -----
-- deck_categories is a category the deck owner created (Ramp, Card draw).
-- deck_cards.category_id points at one, or is null. A null assignment is not
-- a missing backfill: the app shows that card in the type group derived from
-- its type line (Creature, Instant, Sorcery, Artifact, Enchantment,
-- Planeswalker, Land, Battle, Other), the same grouping as before this
-- feature. Existing decks have no rows here and look the same.
--
-- Deleting a category sets category_id to null (ON DELETE SET NULL). The
-- card stays in the deck and falls back to its type group. Type groups are
-- not rows, so they cannot be deleted.
--
-- deck_type_orders remembers where those type groups sit after the owner
-- reorders the list. No row means "not placed yet".
--
-- Names are trimmed, 1-40 characters (char_length counts code points, the
-- same count as Array.from in the app), and unique per deck case-insensitively.
-- A deck may have at most 40 categories.
--
-- The commander is not a category. It stays on the deck row.
--
-- Forks and copies copy the category rows, the type-group order, and each
-- card's assignment. New ids are used on the new deck. A card whose category
-- is missing keeps a null assignment.
--
-- Who can do what
-- ---------------
-- SELECT follows the deck: if the decks SELECT policy returns the deck
-- (can_view_deck), its categories and type order are visible. INSERT and
-- DELETE require the caller to own the deck. UPDATE on deck_categories is
-- column-level (name and position only), same idea as friendships.status in
-- 002. deck_id is fixed at insert: a BEFORE UPDATE trigger refuses a change
-- even for a role that bypasses the column grant, so a category cannot be
-- moved onto another deck (which would both point cards at the wrong deck
-- and slip past the 40-category cap). The cap locks the parent deck row
-- (SELECT FOR UPDATE) before it counts, so two sessions cannot both pass.
-- set_deck_section_order() is security invoker: it writes only rows the
-- caller's RLS already lets them write, and it refuses a caller who does
-- not own the deck.

begin;

-- ---------------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------------

create table if not exists public.deck_categories (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks (id) on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deck_categories drop constraint if exists deck_categories_name_shape;
alter table public.deck_categories
  add constraint deck_categories_name_shape check (
    char_length(name) between 1 and 40
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  );

alter table public.deck_categories drop constraint if exists deck_categories_position_nonneg;
alter table public.deck_categories
  add constraint deck_categories_position_nonneg check (position >= 0);

create unique index if not exists deck_categories_name_lower
  on public.deck_categories (deck_id, lower(name));

create index if not exists deck_categories_deck_idx
  on public.deck_categories (deck_id);

comment on table public.deck_categories is
  'Owner-defined card groups for one deck. Cards with no category_id use their type group.';

comment on column public.deck_categories.position is
  'Sort key shared with deck_type_orders. New categories start at 1000, after the default type groups.';

-- ---------------------------------------------------------------------------
-- 2. Saved order of the derived type groups
-- ---------------------------------------------------------------------------

create table if not exists public.deck_type_orders (
  deck_id uuid not null references public.decks (id) on delete cascade,
  type_key text not null,
  position integer not null,
  primary key (deck_id, type_key)
);

alter table public.deck_type_orders drop constraint if exists deck_type_orders_key;
alter table public.deck_type_orders
  add constraint deck_type_orders_key check (
    type_key in (
      'Creature', 'Planeswalker', 'Instant', 'Sorcery',
      'Artifact', 'Enchantment', 'Battle', 'Land', 'Other'
    )
  );

alter table public.deck_type_orders drop constraint if exists deck_type_orders_position_nonneg;
alter table public.deck_type_orders
  add constraint deck_type_orders_position_nonneg check (position >= 0);

comment on table public.deck_type_orders is
  'Where a derived type group sits after the owner reorders the deck. No row: not placed yet.';

-- ---------------------------------------------------------------------------
-- 3. Card assignment. Null falls back to the type group. Delete does not
--    delete the card.
-- ---------------------------------------------------------------------------

alter table public.deck_cards
  add column if not exists category_id uuid;

alter table public.deck_cards drop constraint if exists deck_cards_category_id_fkey;
alter table public.deck_cards
  add constraint deck_cards_category_id_fkey
  foreign key (category_id) references public.deck_categories (id) on delete set null;

create index if not exists deck_cards_category_idx
  on public.deck_cards (category_id)
  where category_id is not null;

comment on column public.deck_cards.category_id is
  'Category on this same deck, or null to use the card''s derived type group. ON DELETE SET NULL.';

-- The category row has to belong to the card's deck. A composite foreign key
-- cannot SET NULL on category_id alone (it would also null deck_id). This
-- trigger is security invoker so the lookup is the caller's own view.
create or replace function public.deck_card_category_same_deck()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.category_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.deck_categories c
    where c.id = new.category_id
      and c.deck_id = new.deck_id
  ) then
    raise exception 'Category does not belong to this deck'
      using errcode = '23514',
            constraint = 'deck_cards_category_same_deck',
            hint = 'spellbranch_deck_category';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_cards_category_same_deck on public.deck_cards;
create trigger deck_cards_category_same_deck
  before insert or update of category_id, deck_id on public.deck_cards
  for each row execute function public.deck_card_category_same_deck();

revoke execute on function public.deck_card_category_same_deck() from public, anon, authenticated;

-- 40 categories per deck. Counted before the new row is visible.
create or replace function public.deck_categories_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  -- auth.uid() is null for the table owner (migrations), which may insert
  -- without the cap. A signed-in caller locks the parent deck first, so two
  -- sessions cannot both count 39 and both insert. The lock is also the
  -- ownership check: only the owner can SELECT the deck FOR UPDATE. A
  -- non-owner is refused here (42501) or finds no row, and the insert's
  -- own RLS refuses them either way.
  if auth.uid() is null then
    return new;
  end if;
  perform 1
  from public.decks d
  where d.id = new.deck_id
    and d.owner_id = auth.uid()
  for update;
  if not found then
    return new;
  end if;
  select count(*) into n
  from public.deck_categories c
  where c.deck_id = new.deck_id;
  if n >= 40 then
    raise exception 'This deck already has 40 categories'
      using errcode = '23514', hint = 'spellbranch_deck_category';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_categories_limit on public.deck_categories;
create trigger deck_categories_limit
  before insert on public.deck_categories
  for each row execute function public.deck_categories_limit();

revoke execute on function public.deck_categories_limit() from public, anon, authenticated;

-- deck_id is chosen on insert and never changed. Moving a row onto another
-- deck would leave cards pointing at a foreign category and would bypass
-- the insert cap. The error is the same generic refusal as any other edit
-- the caller is not allowed to make.
create or replace function public.deck_categories_keep_deck()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.deck_id is distinct from old.deck_id then
    raise exception 'You cannot edit this deck' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_categories_keep_deck on public.deck_categories;
create trigger deck_categories_keep_deck
  before update on public.deck_categories
  for each row execute function public.deck_categories_keep_deck();

revoke execute on function public.deck_categories_keep_deck() from public, anon, authenticated;

drop trigger if exists deck_categories_set_updated_at on public.deck_categories;
create trigger deck_categories_set_updated_at
  before update on public.deck_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS. Visibility is the deck's. Writes are the owner's.
-- ---------------------------------------------------------------------------

alter table public.deck_categories enable row level security;
alter table public.deck_type_orders enable row level security;

drop policy if exists "View deck categories with deck access" on public.deck_categories;
create policy "View deck categories with deck access"
  on public.deck_categories for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_categories.deck_id
    )
  );

drop policy if exists "Owners insert deck categories" on public.deck_categories;
create policy "Owners insert deck categories"
  on public.deck_categories for insert
  to authenticated
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_categories.deck_id
        and d.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners update deck categories" on public.deck_categories;
create policy "Owners update deck categories"
  on public.deck_categories for update
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_categories.deck_id
        and d.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_categories.deck_id
        and d.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners delete deck categories" on public.deck_categories;
create policy "Owners delete deck categories"
  on public.deck_categories for delete
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_categories.deck_id
        and d.owner_id = auth.uid()
    )
  );

drop policy if exists "View deck type order with deck access" on public.deck_type_orders;
create policy "View deck type order with deck access"
  on public.deck_type_orders for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_type_orders.deck_id
    )
  );

drop policy if exists "Owners insert deck type order" on public.deck_type_orders;
create policy "Owners insert deck type order"
  on public.deck_type_orders for insert
  to authenticated
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_type_orders.deck_id
        and d.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners update deck type order" on public.deck_type_orders;
create policy "Owners update deck type order"
  on public.deck_type_orders for update
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_type_orders.deck_id
        and d.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_type_orders.deck_id
        and d.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners delete deck type order" on public.deck_type_orders;
create policy "Owners delete deck type order"
  on public.deck_type_orders for delete
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_type_orders.deck_id
        and d.owner_id = auth.uid()
    )
  );

revoke all on table public.deck_categories from public, anon, authenticated;
revoke all on table public.deck_type_orders from public, anon, authenticated;
grant select on table public.deck_categories to anon, authenticated;
grant insert, delete on table public.deck_categories to authenticated;
-- name and position only. deck_id, id, and the timestamps stay put.
-- updated_at is filled by deck_categories_set_updated_at, not by the caller.
grant update (name, position) on table public.deck_categories to authenticated;
grant select on table public.deck_type_orders to anon, authenticated;
grant insert, update, delete on table public.deck_type_orders to authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.deck_categories, public.deck_type_orders from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reorder, one transaction. Security invoker: RLS does the write check,
--    and a non-owner is refused before any row changes.
-- ---------------------------------------------------------------------------

create or replace function public.set_deck_section_order(deck uuid, sections text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  n_cats integer;
  item text;
  pos integer := 0;
  cat_id uuid;
  type_key text;
  seen_cats uuid[] := '{}';
  seen_types text[] := '{}';
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if deck is null or sections is null
     or coalesce(array_length(sections, 1), 0) > 49 then
    raise exception 'Invalid category order' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.decks d
    where d.id = deck
      and d.owner_id = caller
  ) then
    raise exception 'You cannot edit this deck' using errcode = '42501';
  end if;

  select count(*) into n_cats
  from public.deck_categories c
  where c.deck_id = deck;

  foreach item in array sections loop
    if item ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      cat_id := item::uuid;
      if cat_id = any (seen_cats) then
        raise exception 'Invalid category order' using errcode = '22023';
      end if;
      if not exists (
        select 1
        from public.deck_categories c
        where c.id = cat_id
          and c.deck_id = deck
      ) then
        raise exception 'Invalid category order' using errcode = '22023';
      end if;
      update public.deck_categories c
      set position = pos
      where c.id = cat_id
        and c.deck_id = deck;
      seen_cats := seen_cats || cat_id;
    elsif item ~ '^type:(Creature|Planeswalker|Instant|Sorcery|Artifact|Enchantment|Battle|Land|Other)$' then
      type_key := substring(item from 6);
      if type_key = any (seen_types) then
        raise exception 'Invalid category order' using errcode = '22023';
      end if;
      seen_types := seen_types || type_key;
    else
      raise exception 'Invalid category order' using errcode = '22023';
    end if;
    pos := pos + 1;
  end loop;

  if coalesce(array_length(seen_cats, 1), 0) <> n_cats then
    raise exception 'Invalid category order' using errcode = '22023';
  end if;

  delete from public.deck_type_orders t where t.deck_id = deck;
  pos := 0;
  foreach item in array sections loop
    if item ~ '^type:' then
      insert into public.deck_type_orders (deck_id, type_key, position)
      values (deck, substring(item from 6), pos);
    end if;
    pos := pos + 1;
  end loop;
end;
$$;

revoke execute on function public.set_deck_section_order(uuid, text[]) from public, anon;
grant execute on function public.set_deck_section_order(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. fork_deck() and copy_deck(): 010's functions, plus categories.
--    Inlined (not a helper granted to API roles) so a visible deck cannot
--    be copied into an unrelated deck by calling the helper directly.
-- ---------------------------------------------------------------------------

create or replace function public.fork_deck(source uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.decks;
  new_id uuid;
  branch_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  perform public.lock_visible_deck(source);

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

  -- ' (branch)' is 9 characters. decks.name is at most 80 (003). Shorten the
  -- source name so the default always fits; a caller-supplied name is applied
  -- by the app afterwards and is checked there.
  branch_name := src.name || ' (branch)';
  if char_length(branch_name) > 80 then
    branch_name := left(src.name, 80 - char_length(' (branch)')) || ' (branch)';
  end if;

  insert into public.decks (
    owner_id, name, format, notes, visibility, allow_forks, forked_from_id,
    commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,
    commander_image_uri, commander_art_uri, commander_color_identity, colors
  )
  values (
    auth.uid(),
    branch_name,
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

  insert into public.deck_categories (deck_id, name, position)
  select new_id, c.name, c.position
  from public.deck_categories c
  where c.deck_id = src.id;

  insert into public.deck_type_orders (deck_id, type_key, position)
  select new_id, t.type_key, t.position
  from public.deck_type_orders t
  where t.deck_id = src.id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity, category_id)
  select new_id, cards.scryfall_id, cards.card_name, cards.image_uri, cards.mana_cost,
         cards.type_line, cards.colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         cards.oracle_text, cards.quantity,
         newc.id
  from public.deck_cards cards
  left join public.deck_categories oldc
    on oldc.id = cards.category_id
   and oldc.deck_id = src.id
  left join public.deck_categories newc
    on newc.deck_id = new_id
   and newc.name = oldc.name
  where cards.deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.fork_deck(uuid) from public, anon;
grant execute on function public.fork_deck(uuid) to authenticated;

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
  perform public.lock_visible_deck(source);

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

  insert into public.deck_categories (deck_id, name, position)
  select new_id, c.name, c.position
  from public.deck_categories c
  where c.deck_id = src.id;

  insert into public.deck_type_orders (deck_id, type_key, position)
  select new_id, t.type_key, t.position
  from public.deck_type_orders t
  where t.deck_id = src.id;

  insert into public.deck_cards
    (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,
     color_identity, oracle_text, quantity, category_id)
  select new_id, cards.scryfall_id, cards.card_name, cards.image_uri, cards.mana_cost,
         cards.type_line, cards.colors,
         coalesce(color_identity,
                  array(select x from unnest(array['W','U','B','R','G']) as x
                        where x = any(colors))),
         cards.oracle_text, cards.quantity,
         newc.id
  from public.deck_cards cards
  left join public.deck_categories oldc
    on oldc.id = cards.category_id
   and oldc.deck_id = src.id
  left join public.deck_categories newc
    on newc.deck_id = new_id
   and newc.name = oldc.name
  where cards.deck_id = src.id;

  return new_id;
end;
$$;

revoke execute on function public.copy_deck(uuid) from public, anon;
grant execute on function public.copy_deck(uuid) to authenticated;

commit;
