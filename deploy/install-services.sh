#!/bin/bash
set -euo pipefail
task_root=/path/to/agent-box
test "$(id -u)" -eq 0
for task_role in telemetry web shell; do
    task_label="dev.agentbox.dashboard.$task_role"
    task_plist="/Library/LaunchDaemons/$task_label.plist"
    test ! -e "$task_plist"
    plutil -lint "$task_root/deploy/$task_label.plist"
done
# Drop privileges before stopping the user's known temporary processes.
/usr/bin/sudo -u youruser "$task_root/.venv/bin/python" "$task_root/deploy/stop-rehearsal.py"
# Rehearsals are stopped before this installer is presented.
for task_port in 5555 5556; do
    if lsof -nP -iTCP:$task_port -sTCP:LISTEN >/dev/null; then
        echo "Port $task_port is already in use; refusing to replace it." >&2
        exit 1
    fi
done
for task_role in telemetry web shell; do
    task_label="dev.agentbox.dashboard.$task_role"
    task_plist="/Library/LaunchDaemons/$task_label.plist"
    install -o root -g wheel -m 644 "$task_root/deploy/$task_label.plist" "$task_plist"
    launchctl bootstrap system "$task_plist"
done
echo 'Agent Box dashboard boot services installed on tailnet ports 5555 and 5556.'
