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
- Supabase schema + RLS + seed + pgTAP checks included (app wiring in progress)
- Local JSON store (default) so the app runs without Supabase credentials

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3847](http://localhost:3847).

Accounts and decks persist in `.data/store.json` (the app does not use Supabase yet; see below).

## Environment variables

Copy `.env.example` to `.env.local` (gitignored; never commit real keys):

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs local session cookies (required in production) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (optional, not used by the app yet) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser key: the new **publishable** key (`sb_publishable_…`) or the legacy anon key both work here (optional, not used yet) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret / service-role key for admin scripts only; server-side, never `NEXT_PUBLIC_` (optional) |

## Supabase status

**The app does not talk to Supabase yet.** Every route still uses the local JSON
store (`.data/store.json`) and local JWT cookie sessions, whether or not the
Supabase variables are set. What exists today:

- `supabase/migrations/001_initial.sql`: tables, RLS policies, `handle_new_user` profile trigger
- `supabase/migrations/002_rls_fixes.sql`: RLS hardening (friend requests, profile privacy, usernames, fork rules, `fork_deck()` helper)
- `supabase/seed.sql`: local-only test data
- `supabase/tests/rls_checks.sql`: pgTAP checks for the policies
- `src/lib/supabase/{client,server}.ts`: `@supabase/ssr` clients, not wired in yet

Planned follow-ups: Supabase Auth with `@supabase/ssr` (session refresh in `src/proxy.ts`,
sign-in/up/out, `/auth/confirm`), then a Supabase-backed data layer behind the server
actions in `src/lib/actions`.

Schema notes for that work:
- `profiles` has no `email` column: read the signed-in user's email from the Supabase session.
- Logged-out pages should read names from `public.public_profiles` (id, username, display_name, avatar_url).
- Friend requests: only the addressee can change `status`. To re-send after a decline, delete the old row and insert a new `pending` one.
- Forking: call `select fork_deck('<deck id>')`. It checks permissions and copies the cards.

### Setting up a Supabase project

1. **Create a project** at [supabase.com/dashboard](https://supabase.com/dashboard) (a free dev project is fine).
2. **Copy the keys** from *Project Settings → API keys*: the project URL, the publishable
   (or legacy anon) key, and, only if you need admin scripts, the secret / service-role key.
   Put them in `.env.local` under the variable names above.
3. **Configure auth URLs** in *Authentication → URL Configuration*:
   - Site URL: `http://localhost:3847`
   - Redirect URLs: `http://localhost:3847/auth/confirm`
   (Add your production URL + `/auth/confirm` later.) For early development you can turn off
   *Confirm email* under *Authentication → Providers → Email*.
4. **Apply the migrations in order** (`001_initial.sql`, then `002_rls_fixes.sql`), either:
   - with the CLI (no global install needed):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
     `db push` applies only `supabase/migrations/` and does **not** load `seed.sql`.
   - or by pasting each file into the dashboard *SQL Editor* and running it, `001` first.
5. **Don't load `seed.sql` on a hosted project.** It creates test accounts with a
   published dev-only password.

### Local Supabase (Docker)

```bash
npx supabase start      # local stack; prints local URL + keys
npx supabase db reset   # re-applies migrations + seed.sql
npx supabase test db    # runs supabase/tests/*.sql (pgTAP)
```

Seeded accounts (local only, dev-only password `spellbranch-dev-only`):
`alice@example.test`, `bob@example.test`, `carol@example.test`. Alice and Bob are
friends; Carol has a pending request to Alice. The seed also includes public,
friends-only and private decks, a fork, comments and favorites.

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
- `supabase/migrations`: relational schema and RLS policies
- `supabase/seed.sql`, `supabase/tests`: local seed data and pgTAP RLS checks
- `supabase/config.toml`: Supabase CLI config (local dev)

Card data comes from [Scryfall](https://scryfall.com/). Spellbranch is an unofficial fan project and is not affiliated with Wizards of the Coast.
