#!/bin/bash
# kiosk-browser.sh — launches Chromium fullscreen, pointed at this
# machine's check-in board. There's only one page (board.html serves as
# both the display and, if this device is touchable, the input too - see
# README.md's "Setup") so this script just needs to know which server to
# point at - the same one server for every screen, in every coop
# (see README's "Multiple coops").
#
# Usage:
#   ./kiosk-browser.sh                    # server on THIS machine, default port 8080
#   ./kiosk-browser.sh 192.168.1.20:8080  # server on a different machine
#
# Optional second argument, "off" or "on": overrides config.json's
# boardClickToEdit for just THIS device (see README's "Setup") -
# use "off" on a wall-mounted TV you don't want people tapping on when
# there's a separate touch device for input at the same location, or "on"
# to force this one device touchable even if the server's own default is
# off. Leave it out to just use the server's own default, same as before.
#   ./kiosk-browser.sh 192.168.1.20:8080 off   # this device: display only
#   ./kiosk-browser.sh 192.168.1.20:8080 on    # this device: always touchable
#
# Optional third argument: pin this device to always show one specific
# coop, regardless of what's remembered locally in the browser (see
# README's "Multiple coops") - handy for a wall-mounted
# screen you always want showing e.g. just "Område A". Leave it out to
# let the board's own on-page coop picker decide, as normal. Spell it
# EXACTLY as it appears on the admin page - stick to letters, numbers,
# spaces and hyphens (this gets used as-is in a URL, so avoid characters
# like & or # that mean something there).
#   ./kiosk-browser.sh 192.168.1.20:8080 off "Område A"
#
# Add this to your desktop autostart (see README.md) so it comes back up
# automatically after a reboot or power cut.

HOST="${1:-localhost:8080}"
INPUT_OVERRIDE="${2:-}"
LOCATION_OVERRIDE="${3:-}"
URL="http://${HOST}/board.html"
PARAMS=()
if [ "$INPUT_OVERRIDE" = "off" ] || [ "$INPUT_OVERRIDE" = "on" ]; then
  PARAMS+=("input=${INPUT_OVERRIDE}")
fi
if [ -n "$LOCATION_OVERRIDE" ]; then
  PARAMS+=("location=${LOCATION_OVERRIDE// /+}")
fi
if [ "${#PARAMS[@]}" -gt 0 ]; then
  URL="${URL}?$(IFS='&'; echo "${PARAMS[*]}")"
fi

# --disable-pinch and --overscroll-history-navigation=0 stop stray touches
# on a touchscreen from accidentally zooming or navigating back.
exec chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --incognito \
  "$URL"

# If your device only has "chromium" (not "chromium-browser"), edit the
# command above, or on a Raspberry Pi running the default desktop, that
# binary is usually just "chromium-browser".
