#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────
# ops/local-llm/install.sh — run the local-llm proxy (and the Cloudflare
# Tunnel to it) as login items for the current macOS user. Setup guide:
# ops/local-llm/README.md.
#
#   ops/local-llm/install.sh                       # the proxy only
#   ops/local-llm/install.sh --tunnel antares-llm  # the proxy + the tunnel
#   ops/local-llm/install.sh --uninstall
#
# The proxy is copied out of the repo, so switching branches never pulls it
# from under launchd. LLM_MODEL (default qwen3.5:4b) and LLM_HOST (default
# llm.antaresyuan.site) can be set in the environment.
# ─────────────────────────────────────────────────────────────────────────
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dest="$HOME/Library/Application Support/antares-llm"
logs="$HOME/Library/Logs/antares-llm"
agents="$HOME/Library/LaunchAgents"
uid=$(id -u)
model="${LLM_MODEL:-qwen3.5:4b}"
host="${LLM_HOST:-llm.antaresyuan.site}"

unload() { launchctl bootout "gui/$uid/$1" 2>/dev/null || true; }
load() { unload "$1"; launchctl bootstrap "gui/$uid" "$agents/$1.plist"; echo "✓ $1 running"; }

# write_plist <label> <env-block> <arg>...
write_plist() {
  label=$1; envblock=$2; shift 2
  args=""
  for a in "$@"; do args="$args    <string>$a</string>
"; done
  cat > "$agents/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>EnvironmentVariables</key>
  <dict>$envblock</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$logs/$label.log</string>
  <key>StandardErrorPath</key><string>$logs/$label.log</string>
</dict>
</plist>
PLIST
}

if [ "${1:-}" = "--uninstall" ]; then
  for l in site.antaresyuan.llm-proxy site.antaresyuan.llm-tunnel; do
    unload "$l"
    [ -f "$agents/$l.plist" ] && mv "$agents/$l.plist" "$dest/$l.plist.removed"
  done
  echo "✓ stopped; plists moved to $dest"
  exit 0
fi

node=$(command -v node) || { echo "node not found on PATH"; exit 1; }
mkdir -p "$dest" "$logs" "$agents"
cp "$here/proxy.js" "$dest/proxy.js"
write_plist site.antaresyuan.llm-proxy \
  "<key>LLM_MODEL</key><string>$model</string><key>PORT</key><string>11435</string>" \
  "$node" "$dest/proxy.js"
load site.antaresyuan.llm-proxy

if [ "${1:-}" = "--tunnel" ]; then
  name="${2:?usage: install.sh --tunnel <tunnel-name>}"
  cf=$(command -v cloudflared) || { echo "cloudflared not found — brew install cloudflared"; exit 1; }
  id=$("$cf" tunnel list --output json | "$node" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).find(x=>x.name==='$name');process.stdout.write(t?t.id:'')})")
  [ -n "$id" ] || { echo "no tunnel named $name — run: cloudflared tunnel create $name"; exit 1; }
  cat > "$dest/cloudflared.yml" <<YML
tunnel: $id
credentials-file: $HOME/.cloudflared/$id.json
ingress:
  - hostname: $host
    service: http://127.0.0.1:11435
  - service: http_status:404
YML
  write_plist site.antaresyuan.llm-tunnel "" "$cf" --no-autoupdate --config "$dest/cloudflared.yml" tunnel run
  load site.antaresyuan.llm-tunnel
fi
echo "logs: $logs"
