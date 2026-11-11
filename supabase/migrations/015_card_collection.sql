-- Spellbranch 015: a personal card collection, separate from decks.
--
-- Apply after 001-014, in its own transaction (this file is BEGIN/COMMIT).
-- Do not apply it to the hosted project from the app deploy. Run it in the
-- Supabase SQL editor before the app that reads collection_cards.
-- 011 is reserved and is not used. This file does not edit earlier migrations.
--
-- One row is one printing at one finish (nonfoil, foil, etched). Quantity is
-- how many of that pile the owner has. Condition is optional and is not part
-- of the key, so a pile has one condition. for_trade marks the whole pile.
--
-- Visibility is per user, on collection_settings. No row means private.
-- Other people see only for_trade rows, and only when the setting is public,
-- or friends and the viewer is an accepted friend. The owner always sees
-- and edits every row.
--
-- collection_card_visible() is security invoker with an empty search_path.
-- It does not bypass RLS. A private settings row is invisible to everyone
-- but the owner, so a missing or hidden row counts as private. is_friend()
-- (002) still requires the caller to be one of the two people.
--
-- Re-running 002, 006, 008, 010, 013, or 014 does not replace these objects.
-- 015 does not need to be re-run after those. Re-run 015 itself only if you
-- are applying a newer copy of this file.

begin;

-- ---------------------------------------------------------------------------
-- 1. Who else may see cards marked for trade.
-- ---------------------------------------------------------------------------

create table if not exists public.collection_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  visibility text not null default 'private',
  updated_at timestamptz not null default now()
);

alter table public.collection_settings
  drop constraint if exists collection_settings_visibility_check;
alter table public.collection_settings
  add constraint collection_settings_visibility_check
  check (visibility in ('private', 'friends', 'public'));

alter table public.collection_settings enable row level security;

-- Owner, plus anyone the setting itself already exposes (public, or an
-- accepted friend when the setting is friends). Private stays owner-only.
drop policy if exists "Read collection settings" on public.collection_settings;
create policy "Read collection settings"
  on public.collection_settings for select
  using (
    (select auth.uid()) = user_id
    or visibility = 'public'
    or (
      visibility = 'friends'
      and (select auth.uid()) is not null
      and public.is_friend(user_id, (select auth.uid()))
    )
  );

drop policy if exists "Owners insert collection settings" on public.collection_settings;
create policy "Owners insert collection settings"
  on public.collection_settings for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners update collection settings" on public.collection_settings;
create policy "Owners update collection settings"
  on public.collection_settings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.collection_settings from public, anon, authenticated;
grant select on table public.collection_settings to anon, authenticated;
grant insert, update on table public.collection_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Visibility helper. Invoker: it can only see settings RLS already shows.
-- ---------------------------------------------------------------------------

create or replace function public.collection_card_visible(
  owner uuid,
  for_trade boolean,
  viewer uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    viewer is not null and viewer = owner
    or (
      for_trade
      and exists (
        select 1
        from public.collection_settings s
        where s.user_id = owner
          and (
            s.visibility = 'public'
            or (
              s.visibility = 'friends'
              and viewer is not null
              and public.is_friend(s.user_id, viewer)
            )
          )
      )
    );
$$;

revoke execute on function public.collection_card_visible(uuid, boolean, uuid) from public;
grant execute on function public.collection_card_visible(uuid, boolean, uuid) to anon, authenticated;

-- The owner cannot move a row onto someone else's collection.
create or replace function public.collection_cards_keep_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'You cannot move a collection card to another person'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.collection_cards_keep_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cards.
-- ---------------------------------------------------------------------------

create table if not exists public.collection_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  scryfall_id text not null,
  card_name text not null,
  image_uri text,
  mana_cost text,
  type_line text,
  quantity integer not null,
  finish text not null default 'nonfoil',
  condition text,
  for_trade boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collection_cards
  drop constraint if exists collection_cards_quantity_check;
alter table public.collection_cards
  add constraint collection_cards_quantity_check
  check (quantity > 0 and quantity <= 9999);

alter table public.collection_cards
  drop constraint if exists collection_cards_finish_check;
alter table public.collection_cards
  add constraint collection_cards_finish_check
  check (finish in ('nonfoil', 'foil', 'etched'));

alter table public.collection_cards
  drop constraint if exists collection_cards_condition_check;
alter table public.collection_cards
  add constraint collection_cards_condition_check
  check (condition is null or condition in ('NM', 'LP', 'MP', 'HP', 'DMG'));

alter table public.collection_cards
  drop constraint if exists collection_cards_text_lengths;
alter table public.collection_cards
  add constraint collection_cards_text_lengths
  check (
    char_length(scryfall_id) <= 64
    and char_length(card_name) between 1 and 200
    and (type_line is null or char_length(type_line) <= 200)
    and (mana_cost is null or char_length(mana_cost) <= 100)
    and (image_uri is null or char_length(image_uri) <= 512)
  );

alter table public.collection_cards
  drop constraint if exists collection_cards_image_uri_scryfall;
alter table public.collection_cards
  add constraint collection_cards_image_uri_scryfall
  check (image_uri is null or image_uri ~ '^https://cards\.scryfall\.io/');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_cards'::regclass
      and conname = 'collection_cards_user_scryfall_finish_key'
  ) then
    alter table public.collection_cards
      add constraint collection_cards_user_scryfall_finish_key
      unique (user_id, scryfall_id, finish);
  end if;
end $$;

comment on table public.collection_cards is
  'Physical collection. One row per printing and finish. Only for_trade rows are visible to other people, and only when collection_settings says so.';

drop trigger if exists collection_cards_set_updated_at on public.collection_cards;
create trigger collection_cards_set_updated_at
  before update on public.collection_cards
  for each row execute function public.set_updated_at();

drop trigger if exists collection_cards_keep_owner on public.collection_cards;
create trigger collection_cards_keep_owner
  before update of user_id on public.collection_cards
  for each row execute function public.collection_cards_keep_owner();

drop trigger if exists collection_settings_set_updated_at on public.collection_settings;
create trigger collection_settings_set_updated_at
  before update on public.collection_settings
  for each row execute function public.set_updated_at();

alter table public.collection_cards enable row level security;

drop policy if exists "View collection cards" on public.collection_cards;
create policy "View collection cards"
  on public.collection_cards for select
  using (public.collection_card_visible(user_id, for_trade, (select auth.uid())));

drop policy if exists "Owners insert collection cards" on public.collection_cards;
create policy "Owners insert collection cards"
  on public.collection_cards for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners update collection cards" on public.collection_cards;
create policy "Owners update collection cards"
  on public.collection_cards for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners delete collection cards" on public.collection_cards;
create policy "Owners delete collection cards"
  on public.collection_cards for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.collection_cards from public, anon, authenticated;
grant select on table public.collection_cards to anon, authenticated;
grant insert, update, delete on table public.collection_cards to authenticated;

commit;
