#!/bin/sh
# One-off update of CheckinChicken from the "update" folder that is next to this script on the USB stick.
#
#   1. On the stick: the folder "update" (the repository: install.sh, base/, modules/ ...) and this file, next to each other.
#   2. On the host:  sudo sh /media/<user>/<STICK>/update-now.sh
#
# It copies the folder off the stick first (so the stick can be pulled out and nothing runs from it), installs it the way the page's
# "Install from USB" does, and removes the copy. People and settings are kept; copies of the old files are put aside in /opt/checkin-board/old-state.
# Needed once, because the page's "Update from a USB stick" row can only come back with this version. Delete this file afterwards.
set -e
[ "$(id -u)" = 0 ] || exec sudo sh "$0" "$@"

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/update"
for need in install.sh base/base_web.py modules; do
    [ -e "$SRC/$need" ] || { echo "Not found: $SRC/$need"; echo "Put the folder 'update' (the CheckinChicken repository) next to this script."; exit 1; }
done

WORK=$(mktemp -d /root/checkin-update.XXXXXX)
trap 'cd /; rm -rf "$WORK"' EXIT
echo "Copying the update from $SRC ..."
cp -r "$SRC/." "$WORK/"
cd "$WORK"
echo "Installing ..."
NS_KEEP_SRC=1 NS_VERSION="USB update $(date +%Y-%m-%d)" sh ./install.sh

echo
if command -v systemctl >/dev/null 2>&1; then
    echo "The service is: $(systemctl is-active checkin-board 2>/dev/null || true)"
fi
echo "Done. Open Settings > System: the version should read \"USB update $(date +%Y-%m-%d)\"."
echo "You can pull the stick out and delete this file. /opt/checkin-board/old-state can be deleted when all is well."
