#!/usr/bin/env bash
# 把裸二进制包成最小 .app bundle。
#
# 为什么必须这么做：裸二进制没有 Info.plist 也就没有 bundle identifier。
# 实测后果有两个，都是硬的：
#   1. `defaults write antares.usagebar endpoint` 写进一个进程永远读不到的
#      domain（所以 endpoint 只能走环境变量）；
#   2. 更要命的是 NSStatusItem 根本不会出现在菜单栏 —— 用 CGWindowList
#      查过，窗口服务里没有它的任何窗口，而进程、launchd 注册、lsappinfo
#      全是正常的。「running」和「visible」是两件事。
#
# kaboo 是打成真 .app 的；我一开始为省事跳过了这步，这就是代价。
set -euo pipefail
cd "$(dirname "$0")"

APP="usagebar.app"
BIN="usagebar"
BUNDLE_ID="site.antaresyuan.usagebar"

if [ ! -x "$BIN" ]; then
  echo "先跑 ./build.sh 生成二进制" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$BIN"
# The popover UI is a bundle resource. Without this the WebView falls back
# to an inline "not found" page — the popover would open but be empty.
cp popover.html "$APP/Contents/Resources/popover.html"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>usagebar</string>
  <key>CFBundleDisplayName</key>     <string>usagebar</string>
  <key>CFBundleExecutable</key>      <string>$BIN</string>
  <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleShortVersionString</key> <string>1.0</string>
  <key>CFBundleVersion</key>         <string>1</string>
  <key>LSMinimumSystemVersion</key>  <string>13.0</string>

  <!-- 这一条是关键：菜单栏专属 app，不进 Dock、不进 Cmd-Tab。
       没有 bundle 就没法声明它，NSStatusItem 也就上不了菜单栏。 -->
  <key>LSUIElement</key>             <true/>

  <!-- Retina 下按点渲染，标题才不会发虚 -->
  <key>NSHighResolutionCapable</key> <true/>

  <!-- 只读公开 endpoint，但 http 本地预览需要放行明文 -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key> <true/>
  </dict>
</dict>
PLIST
echo '</plist>' >> "$APP/Contents/Info.plist"

# 无签名的 app 在较新的 macOS 上会被直接拒绝启动，ad-hoc 签名足够本地用。
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP" 2>&1 | sed 's/^/  codesign: /' || true
fi

# 让 LaunchServices 认识它，否则 open -a 找不到
if command -v /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister >/dev/null 2>&1; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$(pwd)/$APP" || true
fi

echo "✓ 打包完成: $(pwd)/$APP"
plutil -lint "$APP/Contents/Info.plist"
echo "  bundle id: $(defaults read "$(pwd)/$APP/Contents/Info" CFBundleIdentifier 2>/dev/null || echo '?')"
echo "  LSUIElement: $(defaults read "$(pwd)/$APP/Contents/Info" LSUIElement 2>/dev/null || echo '?')"
