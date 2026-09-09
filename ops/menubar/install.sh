#!/usr/bin/env bash
# Install usagebar as a login item via LaunchAgent.
#
# Same approach as the sync agent (ops/launchagent/install.sh): substitute
# real paths into a plist, load it, and — importantly — verify with launchctl
# afterwards rather than assuming the load worked. `sync-usage.js status`
# exists because a plist that is present but never loaded is a silent
# failure, and that lesson applies here too.
set -euo pipefail
cd "$(dirname "$0")"

APP="$(pwd)/usagebar.app"
BIN="$APP/Contents/MacOS/usagebar"
LABEL="antares.usagebar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/usagebar.log"
ENDPOINT="${USAGEBAR_ENDPOINT:-https://usage.antaresyuan.site/}"

if [ ! -x "$BIN" ]; then
  echo "bundle 不存在 — 先跑 ./build.sh 再跑 ./bundle.sh" >&2
  exit 1
fi

# Fail early if the binary can't even parse its data source; installing a
# broken login item is worse than not installing one.
echo "checking the binary against $ENDPOINT …"
if ! USAGEBAR_ENDPOINT="$ENDPOINT" "$BIN" --title >/dev/null 2>&1; then
  echo "warning: --title failed against $ENDPOINT" >&2
  echo "         installing anyway; the bar will show ⚠ until it can read data" >&2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
  </array>

  <!-- A menu bar app must stay resident; unlike the hourly sync agent this
       one is KeepAlive so a crash comes back on its own. -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <!-- LaunchAgents get a minimal environment, so the endpoint override has
       to be passed explicitly rather than inherited from a shell. -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>USAGEBAR_ENDPOINT</key>
    <string>$ENDPOINT</string>
  </dict>

  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>

  <!-- LSUIElement equivalent for a bare binary: without this the process
       can grab focus on launch. The app also calls setActivationPolicy
       (.accessory) itself; both together keep it out of the Dock. -->
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
PLIST_END

# Replace any previous instance before loading, or the load is a no-op.
launchctl unload "$PLIST" 2>/dev/null || true
pkill -f "$BIN" 2>/dev/null || true
sleep 1

# `launchctl load` returns before registration is visible to `launchctl
# list`, and it reports "Input/output error" for an already-loaded label
# even when the agent is running fine. So: ignore its exit status, then poll
# for the label. Measured: registration lands within ~1s, but poll to 6s.
launchctl load "$PLIST" 2>/dev/null || true

loaded=""
for _ in 1 2 3 4 5 6; do
  if launchctl list 2>/dev/null | grep -q "$LABEL"; then loaded="yes"; break; fi
  sleep 1
done

# Verify rather than assume — and check the PROCESS too, because a
# registered label with no pid means it launched and died.
if [ -n "$loaded" ]; then
  info="$(launchctl list "$LABEL" 2>/dev/null || true)"
  pid="$(printf '%s' "$info" | sed -n 's/.*"PID" = \([0-9]*\).*/\1/p' | head -1)"
  status="$(printf '%s' "$info" | sed -n 's/.*"LastExitStatus" = \([0-9-]*\).*/\1/p' | head -1)"
  if [ -n "$pid" ]; then
    echo "✓ running as pid $pid — look for the number in your menu bar"
  else
    echo "⚠ registered but not running (last exit ${status:-unknown})"
    echo "  check the log: $LOG"
  fi
else
  echo "✗ plist written but launchctl did not register it" >&2
  echo "  try: launchctl load $PLIST" >&2
  exit 1
fi

echo
echo "endpoint:  $ENDPOINT"
echo "log:       $LOG"
echo "uninstall: ./uninstall.sh"
