#!/bin/bash
# Secret canary (review M1/I2, Cipher F4): build the app in Supabase mode with
# FAKE, random canary values for the server-only secrets, then check that none
# of them appears anywhere in the browser bundle (.next/static).
#
#   npm run test:canary
#
# Uses only made-up values; never put a real key here. Runs fine with no
# network, e.g. with loopback only:
#   unshare -rn bash -c 'ip link set lo up && npm run test:canary'
# Google Fonts responses come from scripts/canary-fonts.cjs instead.
set -euo pipefail
cd "$(dirname "$0")/.."

rand() { od -An -N8 -tx1 /dev/urandom | tr -d ' \n'; }
SECRET_KEY_CANARY="sb_secret_canary_$(rand)"
RATE_LIMIT_CANARY="rate_limit_canary_$(rand)$(rand)$(rand)"

# A placeholder "font file" on loopback, so next/font never needs the internet.
PORT_FILE="$(mktemp)"
node -e '
  const server = require("node:http").createServer((_req, res) => {
    res.writeHead(200, { "content-type": "font/woff2" });
    res.end("placeholder font, canary build only");
  });
  server.listen(0, "127.0.0.1", () =>
    require("node:fs").writeFileSync(process.argv[1], String(server.address().port)));
' "$PORT_FILE" &
FONT_SERVER_PID=$!
trap 'kill "$FONT_SERVER_PID" 2>/dev/null; rm -f "$PORT_FILE"' EXIT
for _ in $(seq 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
[ -s "$PORT_FILE" ] || { echo "FAIL: placeholder font server did not start"; exit 1; }

# SPELLBRANCH_ALLOW_HYBRID=1 only gets past the M1 production guard for this
# throwaway build; it does not clear Supabase mode for real deploys.
echo "secret canary: building with fake secrets..."
env \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES="$PWD/scripts/canary-fonts.cjs" \
  CANARY_FONT_URL="http://127.0.0.1:$(cat "$PORT_FILE")/font.woff2" \
  SPELLBRANCH_BACKEND=supabase \
  SPELLBRANCH_ALLOW_HYBRID=1 \
  NEXT_PUBLIC_SUPABASE_URL=https://canaryprojectref.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_canary \
  SPELLBRANCH_SITE_URL=http://localhost:3847 \
  SUPABASE_SECRET_KEY="$SECRET_KEY_CANARY" \
  SPELLBRANCH_RATE_LIMIT_SECRET="$RATE_LIMIT_CANARY" \
  SPELLBRANCH_CLIENT_IP_HEADER=x-real-ip \
  npx next build >/tmp/spellbranch-canary-build.log 2>&1 || {
    echo "FAIL: next build failed (log: /tmp/spellbranch-canary-build.log)"
    tail -30 /tmp/spellbranch-canary-build.log
    exit 1
  }

if [ -z "$(find .next/static -type f -name '*.js' 2>/dev/null | head -1)" ]; then
  echo "FAIL: no JavaScript in .next/static; the check would prove nothing"
  exit 1
fi

# Self-test: the scan must catch a planted canary, or a pass would mean nothing.
PLANTED=".next/static/canary-self-test.js"
echo "/* $SECRET_KEY_CANARY */" >"$PLANTED"
grep -rqF "$SECRET_KEY_CANARY" .next/static || { rm -f "$PLANTED"; echo "FAIL: scan self-test"; exit 1; }
rm -f "$PLANTED"

failed=0
for canary in "$SECRET_KEY_CANARY" "$RATE_LIMIT_CANARY" "sb_secret_canary_"; do
  if grep -rlF "$canary" .next/static; then
    echo "FAIL: a server-only secret reached .next/static (files above)"
    failed=1
  fi
done
[ "$failed" = 0 ] || exit 1
echo "ok: no server-only secret in .next/static ($(find .next/static -type f | wc -l) files checked)"
