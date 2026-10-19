-- Spellbranch schema for Supabase
-- Apply in the Supabase SQL editor or via CLI when connecting a project.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text not null unique,
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

create table if not exists public.favorite_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  scryfall_id text not null,
  card_name text not null,
  image_uri text,
  mana_cost text,
  type_line text,
  created_at timestamptz not null default now(),
  unique (user_id, scryfall_id)
);

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  format text not null,
  notes text not null default '',
  visibility text not null check (visibility in ('private', 'friends', 'public')),
  allow_forks boolean not null default true,
  forked_from_id uuid references public.decks (id) on delete set null,
  preferred_branch_id uuid references public.decks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deck_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks (id) on delete cascade,
  scryfall_id text not null,
  card_name text not null,
  image_uri text,
  mana_cost text,
  type_line text not null,
  colors text[] not null default '{}',
  oracle_text text,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  unique (deck_id, scryfall_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists decks_owner_idx on public.decks (owner_id);
create index if not exists decks_forked_from_idx on public.decks (forked_from_id);
create index if not exists deck_cards_deck_idx on public.deck_cards (deck_id);
create index if not exists comments_deck_idx on public.comments (deck_id);

create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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
set search_path = public
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

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.favorite_cards enable row level security;
alter table public.decks enable row level security;
alter table public.deck_cards enable row level security;
alter table public.comments enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Friends readable by participants"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Users can request friends"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

create policy "Participants update friendship"
  on public.friendships for update
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Participants delete friendship"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Favorites owned by user"
  on public.favorite_cards for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "View decks by visibility"
  on public.decks for select
  using (public.can_view_deck(decks, auth.uid()));

create policy "Owners insert decks"
  on public.decks for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "Owners update decks"
  on public.decks for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners delete decks"
  on public.decks for delete
  to authenticated
  using (auth.uid() = owner_id);

create policy "View deck cards with deck access"
  on public.deck_cards for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_cards.deck_id
        and public.can_view_deck(d, auth.uid())
    )
  );

create policy "Owners manage deck cards"
  on public.deck_cards for all
  to authenticated
  using (
    exists (
      select 1 from public.decks d
      where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.decks d
      where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
    )
  );

create policy "View comments with deck access"
  on public.comments for select
  using (
    exists (
      select 1 from public.decks d
      where d.id = comments.deck_id
        and public.can_view_deck(d, auth.uid())
    )
  );

create policy "Authorized users comment"
  on public.comments for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.decks d
      where d.id = comments.deck_id
        and public.can_view_deck(d, auth.uid())
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
