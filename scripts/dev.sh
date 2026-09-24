#!/usr/bin/env bash
# dev.sh — run ONE CheckinChicken server locally, pre-loaded with a sample
# roster spread across two sample coops, so you can try out the board
# (including the "Alla områden" / one-coop filter, and grouping by
# coop) before you have real people or a real machine set up.
#
# Usage:
#   scripts/dev.sh
# (or: npm run dev)
#
# Press Ctrl+C to stop. Safe to run again later - it only seeds the sample
# roster the first time, so anything you click around and set on the admin
# page sticks around between runs. Delete the dev-data/ folder if you ever
# want a clean slate.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed, or isn't on your PATH."
  echo "See README.md step 2 (Install Node.js) for install instructions."
  exit 1
fi

DEV_DIR="$(pwd)/dev-data"
mkdir -p "$DEV_DIR"

# The server refuses to start without a cert/key (see README.md, "Generate
# a TLS certificate") - generate a throwaway one here so `npm run dev` still
# just works without a manual step, same as the sample roster below.
CERT_DIR="$DEV_DIR/certs"
if [ ! -f "$CERT_DIR/cert.pem" ]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl isn't installed - needed to generate a local dev HTTPS certificate."
    echo "See README.md, 'Generate a TLS certificate', for install instructions."
    exit 1
  fi
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    >/dev/null 2>&1
fi

cat > "$DEV_DIR/config.json" << JSON
{
  "locationName": "Test (dev)",
  "port": 9100,
  "adminPasscode": "1234",
  "allowNameBrowse": true,
  "phoneVisibility": "always",
  "boardClickToEdit": true
}
JSON

# Seed with the sample roster (two sample coops), first run only.
if [ ! -f "$DEV_DIR/people.json" ]; then
  CHECKIN_DATA_DIR="$DEV_DIR" CHECKIN_CONFIG="$DEV_DIR/config.json" \
    node server/import-people.js server/people.template.csv
fi

cat << MSG

Starting a test server, pre-loaded with a sample roster split across two
sample areas ("Område A" and "Område B") so you can see the board's
area filter/grouping in action:

  board:  https://localhost:9100/board.html
  admin:  https://localhost:9100/admin.html   (passcode: 1234)

The certificate is self-signed (dev only) - your browser will warn about
it once; click through.

Tap Anna Svensson's INNE/UTE badge on the board to toggle it instantly, or
tap anywhere else on her row to open her full status popup (every status
button, one screen). Open the admin page to add/edit people, including
their Område field and the "Visa bara i sitt eget område"
checkbox.

Press Ctrl+C to stop.
MSG

exec env CHECKIN_DATA_DIR="$DEV_DIR" CHECKIN_CONFIG="$DEV_DIR/config.json" \
  CHECKIN_CERT="$CERT_DIR/cert.pem" CHECKIN_KEY="$CERT_DIR/key.pem" \
  node server/server.js
