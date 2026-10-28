-- Spellbranch: rate-limit counters (security review M1 / I2, Cipher plan review F3, F7, F8).
--
-- What this adds:
--   * private.rate_limits: fixed-window counters keyed by an opaque string.
--     The app stores HMAC-SHA256 hex keys (never a raw email or IP); the
--     database's own keys start with "db:" so the two can't collide.
--   * public.rate_limit_hit(key, limit, window): count one attempt and say if
--     it's allowed. EXECUTE for service_role only: the app calls it with its
--     server-only secret key (that client is a later commit).
--   * find_profile(): same signature and result, now VOLATILE plpgsql with a
--     per-user backstop (60 lookups / 10 min per auth.uid()). A signed-in user
--     calling /rpc/find_profile with their own JWT can't skip the limit.
--     Over the limit it raises SQLSTATE PT429 (PostgREST answers HTTP 429).
--
-- What this does NOT change: username_available() keeps its 002 grants
-- (anon + authenticated). Revoking those waits for the secret-key client,
-- because sign-up calls it signed out.
--
-- Windows use the database clock, so every app instance agrees on them.
-- Rows are kept for 2 hours (just over the longest window, 1 hour).
--
-- Safe to re-run. Note: re-running 002 by hand afterwards would put the old
-- find_profile() (no backstop) back; re-run 004 after it.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.rate_limits (
  key          text        not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  count        integer     not null default 1,
  primary key (key, window_start)
);
-- The cleanup deletes by window_start; the primary key starts with key and can't help.
create index if not exists rate_limits_window_start_idx on private.rate_limits (window_start);
alter table private.rate_limits enable row level security;
revoke all on table private.rate_limits from public, anon, authenticated, service_role;

-- The counter itself. SECURITY INVOKER and unreachable by API roles: only the
-- SECURITY DEFINER functions below (owned by postgres) call it.
create or replace function private.rate_limit_hit_core(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  out allowed boolean,
  out retry_after integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  -- Fixed window on the DB clock: starts at a multiple of p_window_seconds.
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  -- One atomic statement: create the counter or add one to it.
  insert into private.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  allowed := v_count <= p_limit;
  retry_after := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::integer)
  end;

  -- Occasional cleanup (about 1 call in 100).
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '2 hours';
  end if;
end;
$$;
revoke all on function private.rate_limit_hit_core(text, integer, integer)
  from public, anon, authenticated, service_role;

-- The app's entry point (service_role only).
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select c.allowed, c.retry_after
  from private.rate_limit_hit_core(p_key, p_limit, p_window_seconds) c;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- find_profile(username): as in 002 (exact, case-insensitive, at most one
-- row of public columns, signed-in callers only) plus the per-user backstop.
-- VOLATILE because it writes the counter (a STABLE function can't INSERT).
-- A blocked call raises, which rolls back its own increment, so the count
-- stays at the limit and blocked calls don't extend the window.
create or replace function public.find_profile(username text)
returns setof public.public_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ok  boolean;
begin
  if v_uid is null then
    return;
  end if;

  select c.allowed into v_ok
  from private.rate_limit_hit_core('db:find_profile:uid:' || v_uid::text, 60, 600) c;
  if not v_ok then
    raise exception 'too many lookups' using errcode = 'PT429';
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p
    where find_profile.username ~ '^[A-Za-z0-9_]{3,24}$'
      and lower(p.username) = lower(find_profile.username)
    limit 1;
end;
$$;
revoke all on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;
