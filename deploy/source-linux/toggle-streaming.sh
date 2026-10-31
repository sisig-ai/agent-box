#!/usr/bin/env bash
# toggle-streaming.sh — switch between streaming and admin display modes.
#
# Usage:
#   toggle-streaming.sh on   → streaming mode: JetKVM off, MAG on, Sunshine restarted
#   toggle-streaming.sh off  → admin mode: JetKVM on, MAG off
#   toggle-streaming.sh      → show current state
#
# Requires: kscreen-doctor (from kscreen), systemd user session
#
# Environment (auto-detected):
#   WAYLAND_DISPLAY=wayland-0   from /run/user/$UID/wayland-*
#   XDG_RUNTIME_DIR=/run/user/$UID
#   DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UID/bus

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

# --- Auto-detect Wayland/DBus environment --------------------------------
detect_env() {
    # Wayland socket
    if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
        local sock
        sock=$(find "/run/user/${UID}" -maxdepth 1 -name 'wayland-[0-9]*' \
                     ! -name '*.lock' -printf '%f\n' 2>/dev/null | sort | head -1)
        if [[ -z "$sock" ]]; then
            echo "[$SCRIPT_NAME] ERROR: no Wayland socket under /run/user/${UID} — is KDE running?" >&2
            exit 1
        fi
        export WAYLAND_DISPLAY="$sock"
    fi

    if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
        export XDG_RUNTIME_DIR="/run/user/${UID}"
    fi

    if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        if [[ -S "${XDG_RUNTIME_DIR}/bus" ]]; then
            export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
        else
            echo "[$SCRIPT_NAME] ERROR: no D-Bus socket at ${XDG_RUNTIME_DIR}/bus" >&2
            exit 1
        fi
    fi
}

# --- Wait for kscreen-doctor to become responsive -------------------------
wait_for_kscreen() {
    local tries=10
    for _ in $(seq 1 "$tries"); do
        if kscreen-doctor -o 2>/dev/null | grep -q 'Output:'; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

# === MODE: streaming ON ===================================================
cmd_on() {
    detect_env

    echo "[$SCRIPT_NAME] Switching to streaming mode..."

    # Step 1: Disable JetKVM in KWin
    echo "[$SCRIPT_NAME] Disabling HDMI-A-2 (JetKVM)..."
    kscreen-doctor output.HDMI-A-2.disable 2>/dev/null
    sleep 1

    # Step 2: Enable MAG at 1440p@120
    echo "[$SCRIPT_NAME] Enabling HDMI-A-1 (MAG) at 2560x1440@120..."
    kscreen-doctor output.HDMI-A-1.enable output.HDMI-A-1.mode.16 2>/dev/null
    sleep 1

    # Step 3: Restart Sunshine so it probes with a single display
    echo "[$SCRIPT_NAME] Restarting Sunshine..."
    systemctl --user stop sunshine.service 2>/dev/null || true
    pkill -9 sunshine 2>/dev/null || true
    sleep 1
    systemctl --user reset-failed app-dev.lizardbyte.app.Sunshine.service 2>/dev/null || true
    systemctl --user start sunshine.service 2>/dev/null || true
    sleep 3

    # Verify
    if systemctl --user is-active --quiet sunshine.service 2>/dev/null; then
        echo "[$SCRIPT_NAME] Streaming mode active: MAG on, JetKVM off, Sunshine running."
    else
        echo "[$SCRIPT_NAME] WARNING: Sunshine may not have started cleanly."
    fi
}

# === MODE: streaming OFF ==================================================
cmd_off() {
    detect_env

    echo "[$SCRIPTNAME] Switching to admin mode..."

    # Step 1: Enable JetKVM first (need an active KWin output)
    echo "[$SCRIPTNAME] Enabling HDMI-A-2 (JetKVM) at 0,0..."
    kscreen-doctor output.HDMI-A-2.enable output.HDMI-A-2.position.0,0 2>/dev/null
    sleep 1

    # Step 2: Disable MAG monitor (saves power, prevents burn-in)
    echo "[$SCRIPTNAME] Disabling HDMI-A-1 (MAG monitor)..."
    kscreen-doctor output.HDMI-A-1.disable 2>/dev/null
    sleep 1

    echo "[$SCRIPTNAME] Admin mode active: JetKVM on, MAG monitor off."
}

# === MODE: status =========================================================
cmd_status() {
    detect_env

    echo "=== KWin outputs ==="
    kscreen-doctor -o 2>/dev/null | grep -E 'Output:|Geometry:' || echo "(unable to query)"
    echo ""

    echo "=== Sunshine ==="
    if pgrep -a sunshine 2>/dev/null | head -1; then
        tail -1 ~/.config/sunshine/sunshine.log 2>/dev/null || true
    else
        echo "Not running"
    fi
    echo ""

    echo "=== GPU ==="
    for r in /dev/dri/renderD*; do
        card=$(basename "$r")
        pci=$(readlink -f "/sys/class/drm/$card/device" 2>/dev/null | grep -oE '[0-9a-f]+:[0-9a-f]+:[0-9a-f]+\.[0-9]' | tail -1)
        echo "  $card -> PCI $pci"
    done
}

# === Main =================================================================
case "${1:-}" in
    on|1|enable|start)
        cmd_on
        ;;
    off|0|disable|stop)
        cmd_off
        ;;
    status|""|-h|--help)
        cmd_status
        ;;
    *)
        echo "Usage: $SCRIPT_NAME {on|off|status}"
        echo ""
        echo "  on      Streaming mode — JetKVM off, MAG monitor on, Sunshine restarted"
        echo "  off     Admin mode — JetKVM on, MAG monitor off (saves power)"
        echo "  status  Show current KWin outputs and Sunshine state"
        exit 1
        ;;
esac
