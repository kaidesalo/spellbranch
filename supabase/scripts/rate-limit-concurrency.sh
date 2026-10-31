#!/bin/bash
# Concurrency check for public.rate_limit_hit() (migration 004): 20 parallel
# sessions x 50 hits on one key must give a count of exactly 1000.
# pgTAP runs in one session, so this lives here as a script.
#
# Local Docker stack only (never a hosted project):
#   npx supabase start
#   supabase/scripts/rate-limit-concurrency.sh
# Or point PSQL at another LOCAL database, e.g. PSQL="psql -d mydb".
set -euo pipefail
PSQL=${PSQL:-"psql postgresql://postgres:postgres@127.0.0.1:54322/postgres"}
KEY="test:concurrency:$$:$(date +%s)"
SESSIONS=20
HITS=50

for _ in $(seq "$SESSIONS"); do
  $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "set role service_role;
    select count(*) from generate_series(1, $HITS) g,
      lateral public.rate_limit_hit('$KEY' || repeat('', g), 1000000, 3600);" >/dev/null &
done
wait

COUNT=$($PSQL -X -q -At -c "select coalesce(sum(count), 0) from private.rate_limits where key = '$KEY';")
$PSQL -X -q -c "delete from private.rate_limits where key = '$KEY';"
EXPECTED=$((SESSIONS * HITS))
if [ "$COUNT" = "$EXPECTED" ]; then
  echo "ok: $SESSIONS sessions x $HITS hits = $COUNT"
else
  echo "not ok: expected $EXPECTED, got $COUNT" >&2
  exit 1
fi
