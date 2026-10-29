#!/bin/sh
# Check-in add-on - the updater. Started as root by systemd (checkin-board-update@git.service / @usb.service, written by this module's
# install.sh); the web service is an ordinary user and may only ask systemd to start that unit. So nothing the web service writes is trusted here:
# the checkout, its origin and the ports come from files only root can write (install.sh records them), and the USB stick is looked for here.
#   update-run.sh git   fast-forward the recorded checkout from its recorded GitHub origin and run its install.sh
#   update-run.sh usb   copy the "update" folder of a USB stick away and run its install.sh
#   update-run.sh scan  write the list of the sticks that have an update folder to $RUN/usb.json (the page, an ordinary user, can not see a stick that is
#                       mounted for the desktop user only; this does not touch the progress files of an update)
# Progress is written to $RUN/state.update ("running", "ok", "failed") and $RUN/state.update.log, which the page shows.
# The variables CHECKIN_* are for the tests; a unit started by systemd has none of them.
CODE=${CHECKIN_INSTALL_DIR:-/opt/checkin-board}
RUN=${CHECKIN_UPDATE_DIR:-/run/checkin-board-update}
MODE=${1:-}
PROTOCOLS=${CHECKIN_GIT_PROTOCOLS:-https:ssh}
ORIGIN_RE=${CHECKIN_ORIGIN_RE:-'^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?/?$'}
umask 022
mkdir -p "$RUN"
# the folders called "update" on mounted drives that look like the add-on, one path per line (names may have spaces: the patterns are expanded here)
valid_stick() { [ -d "$1" ] && [ ! -L "$1" ] && [ -f "$1/install.sh" ] && [ ! -L "$1/install.sh" ] && [ -f "$1/base/base_web.py" ] && [ -d "$1/modules" ]; }
sticks() {
    if [ -n "${CHECKIN_USB_ROOT:-}" ]; then set -- "$CHECKIN_USB_ROOT"/*/update
    else set -- /media/*/update /media/*/*/update /run/media/*/*/update /mnt/*/update /mnt/*/*/update; fi
    for D in "$@"; do valid_stick "$D" && printf '%s\n' "$D"; done
    return 0
}
json_text() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
if [ "$MODE" = scan ]; then
    TMP="$RUN/usb.json.$$"
    {
        printf '['
        SEP=""
        sticks | while IFS= read -r D; do
            printf '%s{"path":"%s","drive":"%s","time":%s}' "$SEP" "$(json_text "$D")" "$(json_text "$(basename "$(dirname "$D")")")" "$(stat -c %Y "$D/install.sh" 2>/dev/null || echo 0)"
            SEP=","
        done
        printf ']\n'
    } > "$TMP" && mv -f "$TMP" "$RUN/usb.json"
    exit 0
fi
L="$RUN/state.update.log"; ST="$RUN/state.update"
rm -f "$L" "$ST"; set -C                      # never write through a link someone left in the folder
exec >"$L" 2>&1
echo running > "$ST"
fail() { echo "$*"; echo failed >| "$ST"; exit 1; }

PORTS=""
if [ -f "$CODE/install_ports" ]; then
    read -r HTTP HTTPS < "$CODE/install_ports"
    case "$HTTP$HTTPS" in ''|*[!0-9]*) ;; *) PORTS="$HTTP --https-port=$HTTPS" ;; esac
fi

case "$MODE" in
git)
    S=$(cat "$CODE/src_dir" 2>/dev/null); O=$(cat "$CODE/update_origin" 2>/dev/null)
    printf '%s' "$S" | grep -Eq '^/[A-Za-z0-9._/+@=-]+$' && [ -d "$S" ] && [ -f "$S/install.sh" ] || fail "No usable checkout is recorded"
    case "$S" in *..*) fail "Unsafe checkout folder" ;; esac
    printf '%s' "$O" | grep -Eq "$ORIGIN_RE" || fail "The recorded update address is not a GitHub address"
    OWNER=$(stat -c %U "$S")
    if [ "$OWNER" != root ] && [ "$(id -u)" = 0 ]; then G="runuser -u $OWNER -- env GIT_ALLOW_PROTOCOL=$PROTOCOLS git"; else G="env GIT_ALLOW_PROTOCOL=$PROTOCOLS git"; fi
    G="$G -c safe.directory=$S -C $S"
    NOW=$($G config --get remote.origin.url) || fail "Could not read the checkout's git origin"
    [ "$NOW" = "$O" ] || fail "The checkout's git origin changed since the add-on was installed (run install.sh by hand to accept it)"
    B=$($G rev-parse --abbrev-ref HEAD 2>/dev/null)
    printf '%s' "$B" | grep -Eq '^[A-Za-z0-9._/][A-Za-z0-9._/-]*$' && [ "$B" != HEAD ] && case "$B" in *..*|*/) false ;; *) true ;; esac || B=main
    echo "Updating $S from origin/$B"
    $G fetch "$O" "$B" && $G merge --ff-only FETCH_HEAD || fail "Could not fetch and merge"
    cd "$S" && sh "$S/install.sh" $PORTS && echo ok >| "$ST" || fail "The installer failed"
    ;;
usb)
    BEST=""
    LIST=$(sticks)
    while IFS= read -r D; do          # the newest install.sh wins
        [ -n "$D" ] || continue
        if [ -z "$BEST" ] || [ "$D/install.sh" -nt "$BEST/install.sh" ]; then BEST="$D"; fi
    done <<EOF
$LIST
EOF
    [ -n "$BEST" ] || fail "No USB stick with an update folder was found"
    STAMP=$(date -d "@$(stat -c %Y "$BEST/install.sh")" '+%Y-%m-%d %H:%M' 2>/dev/null || date '+%Y-%m-%d %H:%M')
    W="$CODE/usb_src"
    echo "Copying the update from $BEST"
    rm -rf "$W.new" && cp -r "$BEST" "$W.new" && [ -f "$W.new/install.sh" ] && rm -rf "$W" && mv "$W.new" "$W" || fail "Could not copy the update"
    cd "$W" && NS_KEEP_SRC=1 NS_VERSION="USB update $STAMP" sh "$W/install.sh" $PORTS && echo ok >| "$ST" || fail "The installer failed"
    ;;
*)
    fail "Usage: update-run.sh git|usb"
    ;;
esac
