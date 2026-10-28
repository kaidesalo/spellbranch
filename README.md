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
- Supabase (optional): Auth + data under RLS, with schema, seed and pgTAP checks
- Local JSON store (default) so the app runs without Supabase credentials (development and demos only)

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3847](http://localhost:3847).

Accounts and decks persist in `.data/store.json` by default (see *Supabase status* below).

**The local store is for development and demos only.** It is one JSON file in one Node
process: writes are atomic (temp file, fsync, rename) and serialized inside the process, and an
unreadable file makes the app fail instead of being replaced, but several instances or serverless
functions must never share it. A production build (`NODE_ENV=production`, i.e. `next build` /
`next start`) refuses to run on it unless `SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1` is set, e.g.
for a single-process demo: `SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1 npm run start`.

## Environment variables

Copy `.env.example` to `.env.local` (gitignored; never commit real keys):

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs local-backend session cookies. **Required in production** with the local backend (the app throws without it); dev falls back to an insecure dev-only secret with a warning. |
| `SPELLBRANCH_BACKEND` | `local` (default) or `supabase`. Keys alone never switch the backend. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser key: the new **publishable** key (`sb_publishable_…`) or the legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-only secret key, reserved for future admin scripts; the app doesn't read it (the sign-up username check uses the anon-callable `username_available` RPC). Never `NEXT_PUBLIC_` |
| `SPELLBRANCH_SITE_URL` | The app's public origin, e.g. `http://localhost:3847`. **Required with `SPELLBRANCH_BACKEND=supabase`** (the app throws without it): sign-up confirmation emails redirect to `<site>/auth/confirm`, and the confirm POST checks `Origin` against it. Optional in local mode |
| `SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION` | Set to `1` to let a **production** build run on the local JSON store (single-process demos only). Without it, production refuses local mode. Not for shared deploys |
| `SPELLBRANCH_ALLOW_HYBRID` | Set to `1` to let a **production** build run with `SPELLBRANCH_BACKEND=supabase`. Without it, production refuses to run in that mode until auth rate limiting (review M1) is done and the data layer has been tested on a live project. The name is historical (it dates from the auth-only hybrid). Not for shared deploys |
| `SPELLBRANCH_RATE_LIMIT_SECRET` | HMAC key for rate-limit counters: at least 32 bytes, **different from `AUTH_SECRET`** (`openssl rand -base64 32`). **Required in production** (either backend); dev falls back to an insecure dev-only secret with a warning. Rotating it resets every counter, so don't rotate it during an attack |
| `SPELLBRANCH_CLIENT_IP_HEADER` | The one request header your platform sets to the client IP (see [Client IP header](#client-ip-header)). **Required in production** (either backend). Unset in dev: everything counts as one local client |

## Supabase status

| Piece | Status |
| --- | --- |
| Schema, RLS, seed, pgTAP checks (`supabase/`) | Done |
| Auth: sign-up/in/out, session refresh (`src/proxy.ts`), `/auth/confirm`, profile edit | Done, behind `SPELLBRANCH_BACKEND=supabase` |
| Data: decks, cards, forks, compare, friends, favorites, comments (`src/lib/data`) | Done, behind `SPELLBRANCH_BACKEND=supabase`. Unit-tested with a mocked client and against PostgREST on local Postgres; **not yet tested against a live project** |
| Auth rate limiting (review M1) | **Open**: blocks real users. App-side limits are in (see [Rate limiting](#rate-limiting)), but counters are still per process until the secret-key commit lands, and Supabase Auth's own limits/SMTP are still to do |

In Supabase mode everything (accounts, sessions, decks, friends, favorites, comments) lives in
Supabase and is protected by RLS; `.data/store.json` isn't used. Leave `SPELLBRANCH_BACKEND`
unset (local) for normal development. `NODE_ENV=production` (`next build` / `next start`) still
throws in this mode unless `SPELLBRANCH_ALLOW_HYBRID=1` is set, until M1 is fixed and the data
layer has been tried on a live project.

How data access works (`src/lib/data`):
- `getRepository()` (`index.ts`) picks the backend with `getBackend()`. Queries
  (`src/lib/queries/*`) and actions (`src/lib/actions/*`) only talk to that interface (`types.ts`).
- `local.ts`: the JSON store (`store.ts`), permissions checked in app code
  (`src/lib/permissions.ts`) with the same results as RLS: only branches and source decks the
  viewer may see are returned, and forks follow the `fork_deck()` rule (a fork of a public deck is
  friends-only and forkable; a fork of a friends-only or private deck starts private and locked).
- A preferred branch the viewer can't see is reported as `null` in both modes, so the deck and
  compare pages fall back to a visible branch (or show no Compare link) instead of a 404.
- Server actions check every argument with zod (`src/lib/actions/schemas.ts`): ids must be
  UUIDs, text has the length limits in `src/lib/data/limits.ts`, which `003_length_limits.sql`
  also enforces in the database.
- `supabase.ts`: the request-scoped server client (the user's own session, or anon when signed
  out); RLS decides what is visible. No service-role key anywhere. Other users' names come from
  `public_profiles`; the signed-in user's email only from the session. Forks use
  `rpc('fork_deck')`, friend search `rpc('find_profile')`. Decks are inserted without
  `preferred_branch_id` (the database refuses it on insert); a preferred branch is set by a later
  update.
- `friend-rules.ts`: the friend-request rules both backends share (they mirror the RLS): only the
  addressee accepts or declines; the requester can cancel a pending request or unfriend; a
  declined request stays declined and can't be re-sent (the app says "Friend request declined");
  the person who declined can clear it by sending their own request.
- Friend search is by **exact username** (case-insensitive), in both modes.

How the switch works (`src/lib/supabase/config.ts`):
- unset / `local` → local JSON store + local JWT cookie (`spellbranch_session`); in production only with `SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1`
- `supabase` + real URL/key → Supabase Auth via `@supabase/ssr` cookies. Identity always comes from `supabase.auth.getClaims()` (verified JWT), never `getSession()`.
  The auth cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production
  (`src/lib/supabase/cookie-options.ts`, shared by the server and proxy clients). Because they're
  HttpOnly there is deliberately no browser Supabase client; all Supabase calls happen on the server.
- `supabase` with missing/placeholder keys, without `SPELLBRANCH_SITE_URL`, or in production without `SPELLBRANCH_ALLOW_HYBRID=1`, or any other value → the app throws a clear configuration error

What exists in `supabase/`:
- `migrations/001_initial.sql`: tables, RLS policies, `handle_new_user` profile trigger
- `migrations/002_rls_fixes.sql`: RLS hardening (friend requests, profile privacy, usernames, fork rules, `fork_deck()` helper, comment deletion, URL checks, grants/default privileges)
- `migrations/003_length_limits.sql`: length limits (bio 280; deck name 1–80, notes 2000; card and
  favorite fields: Scryfall id 64, name 200, type line 200, mana cost 100, oracle text 4000, image
  URL 512, colors W/U/B/R/G only). Existing over-limit values are trimmed first, so it can't abort
  on old data. Also adds `restart_friend_request()`, which clears a declined request and sends one
  back in one transaction. Safe to re-run
- `migrations/004_rate_limits.sql`: rate-limit counters (review M1/I2). `private.rate_limits`
  (fixed windows on the database clock, rows older than 2 hours are cleaned up), the
  `rate_limit_hit()` RPC (security definer, `service_role` only; the app doesn't call it yet,
  see [Rate limiting](#rate-limiting)), and a per-user backstop inside `find_profile()` (60 lookups
  per 10 minutes, then error `PT429`, which PostgREST returns as HTTP 429). `username_available`
  grants are unchanged for now. Safe to re-run
- `seed.sql`: local-only test data
- `tests/rls_checks.sql`, `tests/review_fixes.sql`, `tests/bio_limit.sql`, `tests/length_limits.sql`, `tests/rate_limits.sql`: pgTAP checks for the policies, the security-review fixes, the length limits, `restart_friend_request()` and the rate-limit tables/RPC/grants
- `scripts/rate-limit-concurrency.sh`: 20 parallel sessions × 50 `rate_limit_hit()` calls must
  count exactly 1000. Local databases only (defaults to the Docker stack)

Schema notes for the data-layer PR:
- `profiles` has no `email` column: read the signed-in user's email from the Supabase session.
- Logged-out pages should read names from `public.public_profiles` (id, username, display_name, avatar_url).
- Profiles aren't a directory: a signed-in user can read their own profile, people they share a friendship row
  with, and owners/authors of decks and comments they can see. To find someone new, call
  `rpc('find_profile', { username })`: an exact, case-insensitive username match (no partial or display-name search)
  that returns at most one `{ id, username, display_name, avatar_url }`. Sign-up can check a name with
  `rpc('username_available', { candidate })` (anon or signed in; returns `false` for taken or invalid names).
  This lets anon check one exact name per request, a cheaper oracle than the old sign-up flow (which just
  suffixed taken names). The app's sign-up now rate limits the check (20 per 10 minutes per IP), but the
  RPC itself is still anon-callable, so someone calling PostgREST directly bypasses that. Follow-up (the
  pending secret-key commit): call it with the server-only secret-key client and revoke anon/authenticated
  `EXECUTE`. Usernames are public by design (profiles show them), so this limits bulk probing; it doesn't
  make usernames secret.
- Friend requests: only the addressee can change `status` (`accepted` / `declined`). The requester can delete
  the row only while it's `pending` (cancel) or `accepted` (unfriend); a `declined` row stays, which blocks
  re-sending. The addressee can delete any row (unfriend, or clear a declined request so a new one is possible).
  The addressee can also flip an `accepted` row to `declined`; that ends the friendship and acts as a soft block
  (the requester can't delete the row or re-send) until the addressee deletes it.
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
   (Add your production URL + `/auth/confirm` later.)
   **Keep *Confirm email* ON** (*Authentication → Providers → Email*) for every hosted project.
   With it off, Supabase reports "already registered" for existing emails. The app maps that to
   the same "Check your email" reply as a new sign-up, but confirmations are what keep sign-up
   from being an account-enumeration oracle (and from signing people in on unverified addresses).
   Only the local Docker stack (`supabase/config.toml`) runs with confirmations off.
   Edit *Authentication → Emails → Confirm signup* so the link is
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
   (the route also accepts the default `?code=` redirect when the link is opened in the same
   browser that signed up). Opening a `token_hash` link shows a **Confirm** button; only that
   POST (checked against `SPELLBRANCH_SITE_URL`'s origin) uses the token, so mail scanners and
   cross-site links can't consume it or sign anyone in.
4. **Password policy** (dashboard *Authentication* settings: the Email provider and Attack Protection pages).
   Hosted projects don't read `supabase/config.toml`, so set these in the dashboard to match it:
   - Minimum password length **8** (the sign-up form enforces 8 too).
   - **Secure password change** on (re-authentication required to change a password).
   - **Leaked password protection** on (HaveIBeenPwned check; Kaide: turn this on in the
     dashboard; Supabase offers it on the Pro plan and above, and it can't be set from the repo).
5. **Apply the migrations in order** (`001_initial.sql`, `002_rls_fixes.sql`, `003_length_limits.sql`, then `004_rate_limits.sql`), either:
   - with the CLI (no global install needed):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
     Plain `db push` applies only `supabase/migrations/` and does not load `seed.sql`.
   - or by pasting each file into the dashboard *SQL Editor* and running it, in order (`001` to `004`).
6. **Try it** (once all migrations are applied): set `SPELLBRANCH_BACKEND=supabase`
   in `.env.local` and restart `npm run dev`. Accounts and all data now live in the project.
7. **Never load `seed.sql` on a hosted project.** It creates email-confirmed test accounts
   with a published dev-only password. Don't run `supabase db reset --linked` or
   `supabase db push --include-seed` against a hosted project: both load the seed.
   `seed.sql` aborts if the database already has any non-`@example.test` user, but a brand-new
   project with no users would not trip that guard.
8. **Check default privileges.** `002` stops new objects created by `postgres` in `public`
   from being auto-granted to `anon` (and functions to `authenticated`). Run `\ddp` in `psql` (or
   query `pg_default_acl`) on the project to confirm nothing else still grants them, and grant new
   tables/functions explicitly in future migrations. The `revoke execute ... from public` default
   covers functions `postgres` creates in any schema, not just `public`, so functions in other
   schemas (e.g. a `private` helper schema or auth hooks) need explicit grants too.

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

## Rate limiting

Review M1/I2. Every check goes through `limit(policy, ids)` in `src/lib/rate-limit` (server-only);
callers never pick numbers or see storage keys, and an ESLint rule plus
`tests/rate-limit-boundary.test.ts` keep the stores and keys private to that folder.

| Where | Limits (fixed windows) |
| --- | --- |
| Sign-in | per IP 20 / 5 min, then per (email, IP) 10 / 15 min, then per email 50 / hour |
| Sign-up | username check per IP 20 / 10 min (counted first); then per IP 10 / hour and per email 3 / hour |
| `/auth/confirm` POST and `?code=` exchange | per IP 10 / 5 min (after the Origin check) |
| Friend search (`findProfileAction`) | per IP 60 / 10 min and per user 30 / 10 min; plus 60 / 10 min per user inside `find_profile()` |
| Sign-out | never limited |

- Checked before Supabase Auth or the local store is called, for registered and unknown emails
  alike. A refusal is always "Too many attempts. Please try again later." (with `retryAfterSec`;
  `/auth/confirm` answers 429 + `Retry-After`), so the limit says nothing about which emails exist.
- **Fails closed**: if the counter store errors or takes over 2.5 s, the attempt is refused with
  "Something went wrong. Please try again shortly." (`/auth/confirm`: 503).
- Keys are `HMAC-SHA256(SPELLBRANCH_RATE_LIMIT_SECRET, policy + identifier)`: no raw emails or IPs
  are stored. Emails are trimmed and lower-cased first and capped at 254 characters.
- IPv4 addresses count individually; IPv6 addresses count per `/64` (one home or server network).
  A missing or invalid client IP header goes into one shared `unknown` bucket (and logs a warning,
  without the value).
- Rotating `SPELLBRANCH_RATE_LIMIT_SECRET` resets every counter. Don't rotate it during an attack.

### Client IP header

The app trusts exactly **one** header, named by `SPELLBRANCH_CLIENT_IP_HEADER`, and only if it holds
a single valid IP. Pick the header your platform **sets and overwrites** on every request; never
`X-Forwarded-For`, which clients can add to.

| Platform | `SPELLBRANCH_CLIENT_IP_HEADER` | Notes |
| --- | --- | --- |
| Vercel | `x-real-ip` | Set by Vercel's edge |
| Behind Cloudflare | `cf-connecting-ip` | Only if the origin accepts traffic from Cloudflare alone (firewall or Cloudflare Tunnel); otherwise anyone can send the header directly |
| Fly.io | `fly-client-ip` | Not verified yet; check it on a test deploy |
| Your own server (nginx) | `x-real-ip` | Add `proxy_set_header X-Real-IP $remote_addr;` and don't expose the Node port directly |

**After each deploy, check the header can't be spoofed**: send 21 sign-in attempts within 5 minutes
with a different made-up value of the header (and of `X-Forwarded-For`) on each; the 21st must still
get "Too many attempts". If it doesn't, the header is coming from the client: fix the setting before
going live.

### Rate limiting status

| Piece | Status |
| --- | --- |
| Limiter, policies, HMAC keys, client IP, fail-closed checks; wired into sign-in, sign-up, the username check, `/auth/confirm` and friend search | Done |
| `004_rate_limits.sql` (shared counters RPC, `find_profile` backstop) + pgTAP + concurrency script | Done, tested on local Postgres only |
| Shared counters across instances (`PostgresStore` → `rate_limit_hit()`) | **Pending** the secret-key commit; until then counters live in each server process |
| `username_available` via the secret-key client, anon/authenticated `EXECUTE` revoked (I2) | **Pending** the secret-key commit |
| Supabase Auth's own limits (all app users share the server's IP there) and custom SMTP (the built-in sender allows only about 2 emails/hour) | **Open** follow-ups |

M1 is **not** done: production in Supabase mode stays behind `SPELLBRANCH_ALLOW_HYBRID=1`.

## Security headers

- `next.config.ts`: `poweredByHeader: false`; every response gets `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` (`same-origin` on `/auth/confirm`),
  `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and HSTS in production
  (`src/lib/security/headers.ts`).
- `src/proxy.ts`: a per-request nonce CSP: `script-src 'self' 'nonce-…' 'strict-dynamic'`, Scryfall
  hosts in `img-src`, `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
  Next.js adds the nonce to its own scripts. This works because every page is dynamic (the root layout
  reads the session). `style-src` still allows `'unsafe-inline'` for component style attributes.
  If you add a third-party script or a browser-side API call, update `buildCsp()`.
  The proxy skips only `_next/static`, `_next/image`, the favicon and the files in `public/`
  (listed by name), so every HTML response, including a 404 for `/nope.png`, gets the CSP.
  **Adding a file to `public/`? Add it to the matcher in `src/proxy.ts`** (a test checks).

## Scripts

```bash
npm run dev        # http://localhost:3847
npm run build      # production build
npm run start      # serve production build on 3847 (local store: needs SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1)
npm run lint
npm run typecheck
npm test           # vitest unit tests (auth, confirm route, cookies, headers, backend switch, public profiles, data adapters, friend rules, local store, action validation, limits)
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
- `src/lib/actions` — `"use server"` mutations only (every export is a callable action, named `*Action`)
- `src/lib/queries`, `src/lib/auth/require-user.ts` — server-only read helpers and `requireUser()` (`import "server-only"`, never callable as actions)
- `src/lib/data` — data layer: `getRepository()`, the local JSON store adapter and the Supabase adapter
- `src/lib/scryfall` — Scryfall helpers
- `supabase/migrations`: relational schema and RLS policies
- `supabase/seed.sql`, `supabase/tests`: local seed data and pgTAP RLS checks
- `supabase/config.toml`: Supabase CLI config (local dev)

Card data comes from [Scryfall](https://scryfall.com/). Spellbranch is an unofficial fan project and is not affiliated with Wizards of the Coast.
