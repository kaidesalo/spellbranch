#!/usr/bin/env bash
# Two sessions. Forking a branch must wait while allow_forks=false on the
# original deck is still uncommitted. A plain SELECT would see the old
# allow_forks=true and the fork would land. SELECT ... FOR SHARE waits.
#
# Not part of the single-transaction pgTAP files: the locker and the forker
# are different backends. Talks to local Postgres on port 5433.
set -euo pipefail

PSQL=(sudo -u postgres psql -p 5433 -d postgres -v ON_ERROR_STOP=1 -X -q)
OWNER=e3200000-0000-4000-8000-000000000001
FORKER=e3200000-0000-4000-8000-000000000002
ROOT=e3200000-0000-4000-8000-000000000010

cleanup() {
  "${PSQL[@]}" <<SQL || true
delete from public.decks where id = '${ROOT}' or forked_from_id = '${ROOT}' or owner_id in ('${OWNER}', '${FORKER}');
delete from public.profiles where id in ('${OWNER}', '${FORKER}');
delete from auth.users where id in ('${OWNER}', '${FORKER}');
SQL
}
trap cleanup EXIT

cleanup
"${PSQL[@]}" <<SQL
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('${OWNER}','authenticated','authenticated','lock-owner@example.test','{"username":"lock_owner"}'),
 ('${FORKER}','authenticated','authenticated','lock-forker@example.test','{"username":"lock_forker"}');
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks)
 values ('${ROOT}','${OWNER}','Lock root','modern','','public',true);
SQL

# A committed branch, so the next fork is of the branch while the root changes.
"${PSQL[@]}" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${FORKER}","role":"authenticated"}', true);
select public.fork_deck('${ROOT}');
commit;
SQL
BRANCH=$("${PSQL[@]}" -tA -c "select id from public.decks where forked_from_id = '${ROOT}' limit 1")
if [[ -z "$BRANCH" ]]; then
  echo "setup fork did not land" >&2
  exit 1
fi

"${PSQL[@]}" -c "BEGIN; UPDATE public.decks SET allow_forks = false WHERE id = '${ROOT}'; SELECT pg_sleep(4); ROLLBACK;" \
  >/tmp/fork-share-lock-a.out 2>/tmp/fork-share-lock-a.err &
holder=$!
sleep 0.6

set +e
"${PSQL[@]}" -v VERBOSITY=verbose <<SQL >/tmp/fork-share-lock-b.out 2>/tmp/fork-share-lock-b.err
begin;
set local lock_timeout = '1s';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${FORKER}","role":"authenticated"}', true);
select public.fork_deck('${BRANCH}');
commit;
SQL
fork_status=$?
set -e
wait "$holder"

if ! grep -q '55P03' /tmp/fork-share-lock-b.err; then
  echo "fork of the branch did not wait on the root update (exit ${fork_status})" >&2
  echo '--- forker ---' >&2
  cat /tmp/fork-share-lock-b.err >&2
  echo '--- holder ---' >&2
  cat /tmp/fork-share-lock-a.err >&2
  exit 1
fi

landed=$("${PSQL[@]}" -tA -c "select count(*) from public.decks where forked_from_id = '${ROOT}'")
if [[ "$landed" != "1" ]]; then
  echo "expected only the setup branch, found ${landed}" >&2
  exit 1
fi

"${PSQL[@]}" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${FORKER}","role":"authenticated"}', true);
select public.fork_deck('${BRANCH}');
commit;
SQL
after=$("${PSQL[@]}" -tA -c "select count(*) from public.decks where forked_from_id = '${ROOT}'")
if [[ "$after" != "2" ]]; then
  echo "fork did not succeed once the root lock was released (found ${after})" >&2
  exit 1
fi

echo "fork_share_lock: in-flight allow_forks change on the root blocked a fork of the branch"
