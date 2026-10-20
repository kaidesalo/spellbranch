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

Accounts and decks persist in `.data/store.json` by default (see *Supabase status* below).

## Environment variables

Copy `.env.example` to `.env.local` (gitignored; never commit real keys):

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs local-backend session cookies. **Required in production** with the local backend (the app throws without it); dev falls back to an insecure dev-only secret with a warning. |
| `SPELLBRANCH_BACKEND` | `local` (default) or `supabase`. Keys alone never switch the backend. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser key: the new **publishable** key (`sb_publishable_…`) or the legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-only secret key. Used only for the sign-up username check (and future admin scripts); never `NEXT_PUBLIC_` |
| `SPELLBRANCH_SITE_URL` | Optional, e.g. `http://localhost:3847`. If set, sign-up confirmation emails redirect to `<site>/auth/confirm` |

## Supabase status

| Piece | Status |
| --- | --- |
| Schema, RLS, seed, pgTAP checks (`supabase/`) | Done |
| Auth: sign-up/in/out, session refresh (`src/proxy.ts`), `/auth/confirm`, profile edit | Done, behind `SPELLBRANCH_BACKEND=supabase` |
| Data (decks, cards, friends, favorites, comments in `src/lib/actions`) | **Still the local JSON store**: Supabase data layer is the next PR |

**`SPELLBRANCH_BACKEND=supabase` is not a usable mode yet.** Accounts and sessions come
from Supabase, but decks, friends, favorites and comments are still read from and written to
`.data/store.json`, keyed by the Supabase user id. Use it only to test auth against a project
with the migrations applied. Leave `SPELLBRANCH_BACKEND` unset (local) for normal development.

How the switch works (`src/lib/supabase/config.ts`):
- unset / `local` → local JSON store + local JWT cookie (`spellbranch_session`)
- `supabase` + real URL/key → Supabase Auth via `@supabase/ssr` cookies. Identity always comes from `supabase.auth.getClaims()` (verified JWT), never `getSession()`.
- `supabase` with missing/placeholder keys, or any other value → the app throws a clear configuration error

What exists in `supabase/`:
- `migrations/001_initial.sql`: tables, RLS policies, `handle_new_user` profile trigger
- `migrations/002_rls_fixes.sql`: RLS hardening (friend requests, profile privacy, usernames, fork rules, `fork_deck()` helper, comment deletion, URL checks, grants/default privileges)
- `seed.sql`: local-only test data
- `tests/rls_checks.sql`, `tests/review_fixes.sql`: pgTAP checks for the policies and the security-review fixes

Schema notes for the data-layer PR:
- `profiles` has no `email` column: read the signed-in user's email from the Supabase session.
- Logged-out pages should read names from `public.public_profiles` (id, username, display_name, avatar_url).
- Profiles aren't a directory: a signed-in user can read their own profile, people they share a friendship row
  with, and owners/authors of decks and comments they can see. To find someone new, call
  `rpc('find_profile', { username })`: an exact, case-insensitive username match (no partial or display-name search)
  that returns at most one `{ id, username, display_name, avatar_url }`. Sign-up can check a name with
  `rpc('username_available', { candidate })` (anon or signed in; returns `false` for taken or invalid names).
- Friend requests: only the addressee can change `status` (`accepted` / `declined`). The requester can delete
  the row only while it's `pending` (cancel) or `accepted` (unfriend); a `declined` row stays, which blocks
  re-sending. The addressee can delete any row (unfriend, or clear a declined request so a new one is possible).
- Comments: the author or the deck owner can delete a comment.
- Image URLs: `profiles.avatar_url` must be `https://…`; card `image_uri` must be `https://cards.scryfall.io/…` (or null).
- Default usernames: signups without a valid `username` in metadata get `player_xxxxxx` (never the email prefix).
- Forks of friends-only/private decks start `private` with forks off; forks of public decks start friends-only.
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
   If confirmation stays on, edit *Authentication → Emails → Confirm signup* so the link is
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
   (the route also accepts the default `?code=` redirect when `SPELLBRANCH_SITE_URL` is set and
   the link is opened in the same browser that signed up).
4. **Apply the migrations in order** (`001_initial.sql`, then `002_rls_fixes.sql`), either:
   - with the CLI (no global install needed):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
     Plain `db push` applies only `supabase/migrations/` and does not load `seed.sql`.
   - or by pasting each file into the dashboard *SQL Editor* and running it, `001` first.
5. **Try auth** (optional, once migrations are applied): set `SPELLBRANCH_BACKEND=supabase`
   in `.env.local`, restart `npm run dev`, then sign up / sign in / sign out. Remember the
   data pages still use the local store.
6. **Never load `seed.sql` on a hosted project.** It creates email-confirmed test accounts
   with a published dev-only password. Don't run `supabase db reset --linked` or
   `supabase db push --include-seed` against a hosted project: both load the seed.
   `seed.sql` aborts if the database already has any non-`@example.test` user, but a brand-new
   project with no users would not trip that guard.
7. **Check default privileges.** `002` stops new objects created by `postgres` in `public`
   from being auto-granted to `anon` (and functions to `authenticated`). Run `\ddp` in `psql` (or
   query `pg_default_acl`) on the project to confirm nothing else still grants them, and grant new
   tables/functions explicitly in future migrations.

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
npm test           # vitest unit tests (redirect sanitizer, backend switch, AUTH_SECRET)
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
