#!/usr/bin/env bash
# dev.sh — run ONE checkin-system server locally, pre-loaded with a sample
# roster spread across two sample buildings, so you can try out the board
# (including the "Alla byggnader" / one-building filter, and grouping by
# building) before you have real people or a real machine set up.
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

# Seed with the sample roster (two sample buildings), first run only.
if [ ! -f "$DEV_DIR/people.json" ]; then
  CHECKIN_DATA_DIR="$DEV_DIR" CHECKIN_CONFIG="$DEV_DIR/config.json" \
    node server/import-people.js server/people.template.csv
fi

cat << MSG

Starting a test server, pre-loaded with a sample roster split across two
sample buildings ("Byggnad A" and "Byggnad B") so you can see the board's
building filter/grouping in action:

  board:  http://localhost:9100/board.html
  admin:  http://localhost:9100/admin.html   (passcode: 1234)

Tap Anna Svensson's INNE/UTE badge on the board to toggle it instantly, or
tap anywhere else on her row to open her full status popup (every status
button, one screen). Open the admin page to add/edit people, including
their Byggnad (building) field and the "Visa bara i sin egen byggnad"
checkbox.

Press Ctrl+C to stop.
MSG

exec env CHECKIN_DATA_DIR="$DEV_DIR" CHECKIN_CONFIG="$DEV_DIR/config.json" node server/server.js
