# Spellbranch

Social Magic: The Gathering deck building for friends. Create decks, search Scryfall, fork independent branches, compare versions side by side, and leave comments—without overwriting the original list.

## Features

- Sign up, sign in, sign out, and basic profiles
- Friends list with requests
- Favorite cards
- Deck CRUD with format, notes, visibility, and fork permissions
- Scryfall card search with details and type-grouped lists
- Forks that copy the card list into an independent branch
- Side-by-side comparison (added, removed, replaced, quantity changes)
- Preferred branch selection
- Comments on decks and branches
- Server-side permission checks for private / friends-only / public decks

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS + shadcn/ui
- Scryfall API for card data
- Supabase schema + RLS included for hosted auth/database
- Local JSON store (default) so the app runs without Supabase credentials

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3847](http://localhost:3847).

Without Supabase configured, accounts and decks persist in `.data/store.json`.

## Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs local session cookies (required in production) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (optional) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (optional) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role for admin scripts only (optional) |

If Supabase URL/key are missing or still placeholders, Spellbranch uses the local store and JWT cookie sessions.

## Supabase setup (optional)

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial.sql` in the SQL editor.
3. Set the env vars above.
4. Wire the app’s auth helpers to Supabase Auth (clients are in `src/lib/supabase/`). The MVP ships with the local auth path fully working; the SQL + RLS policies match the same data model for a hosted cutover.

## Scripts

```bash
npm run dev        # http://localhost:3847
npm run build      # production build
npm run start      # serve production build on 3847
npm run lint
npm run typecheck
```

## Core flows

1. Create an account and sign in.
2. Create a deck (format, visibility, fork permission).
3. Search Scryfall, add cards, adjust quantities (grouped by type).
4. Add friends; share decks as friends-only or public.
5. Fork a deck → edit the branch; the source list stays unchanged.
6. Open Compare to see adds/removes/replacements/quantity diffs.
7. Mark a preferred branch; comment on either list.

## Project layout

- `src/app` — routes (dashboard, decks, friends, favorites, profile)
- `src/components` — UI for builder, compare, friends, comments
- `src/lib/actions` — server actions with permission checks
- `src/lib/data` — local JSON persistence
- `src/lib/scryfall` — Scryfall helpers
- `supabase/migrations` — relational schema and RLS policies

Card data comes from [Scryfall](https://scryfall.com/). Spellbranch is an unofficial fan project and is not affiliated with Wizards of the Coast.
