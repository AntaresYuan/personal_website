/* ══════════════════════════════════════════════════════════════════════
   popover.swift — NSPanel + WKWebView popover for usagebar.

   Why this replaces the NSMenu version: NSMenu can only stack rows. The
   custom-NSView pass got alignment and bars working, but rounded cards,
   gradients, real charts and the site's skins are simply not expressible
   there. kaboo solved the same problem the same way — menubar_popover_-
   darwin.m is an NSPanel hosting a WKWebView (372pt wide) — which is what
   affords its 27k lines of JS/CSS.

   Differences from kaboo, deliberate:

   * No loopback server. kaboo serves the popover over HTTP on localhost
     with a process-scoped cookie, because its UI needs live server data
     and multi-provider auth. Ours renders from ONE public JSON document,
     so the HTML is loaded from the bundle and the data is injected as a
     JS variable. No listening socket, no cookie, no auth surface at all.
   * No resize channel. kaboo lets the page ask to be resized; our content
     is a fixed set of cards, so the height is measured once after render.

   Copied because getting them wrong is subtle (all documented in kaboo's
   own header comment, verified against the AppKit docs):

   * NSWindowStyleMaskNonactivatingPanel — a menu bar popover must not
     steal app activation from whatever the user was doing.
   * hidesOnDeactivate = NO — a non-activating panel never owns activation,
     so YES would race the explicit resign-active observer.
   * Three dismissal signals: global mouse monitor (clicks in other apps),
     local monitor (clicks in our own process), resignActive (Cmd-Tab).
   * The "did the click land inside us?" test treats the status button as
     part of the popover, so clicking the icon to close doesn't race the
     toggle and immediately reopen.
   * opaque = NO + clear backgroundColor + the webview's private
     drawsBackground=NO, or the page renders on an opaque white rectangle
     with the panel's rounded corners cut around it.
   ══════════════════════════════════════════════════════════════════════ */

import Cocoa
import WebKit

final class Popover: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    static let width: CGFloat = 380
    static let defaultHeight: CGFloat = 560

    private var panel: NSPanel?
    private var web: WKWebView?
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private weak var statusItem: NSStatusItem?
    private var pendingPayload: String?
    private var pendingStation: String?
    private var pendingStationError: String?
    private var loaded = false

    /// Called when the page asks to open the full usage site.
    var onOpenSite: (() -> Void)?
    /// Called when the page asks to change which metric rides in the bar.
    var onPickMetric: ((String) -> Void)?
    var onRefresh: (() -> Void)?
    /// Station actions. Each is optional so the popover stays usable when a
    /// host wires up only some of them (the offscreen snapshot host, for
    /// instance, wires none).
    var onSync: (() -> Void)?
    var onOpenRepo: (() -> Void)?
    var onOpenURL: ((String) -> Void)?
    var onAsk: (() -> Void)?

    var isOpen: Bool { panel?.isVisible ?? false }

    init(statusItem: NSStatusItem?) {
        self.statusItem = statusItem
        super.init()
    }

    // ── Construction ──────────────────────────────────────────────────
    private func build() {
        guard panel == nil else { return }

        let frame = NSRect(x: 0, y: 0, width: Self.width, height: Self.defaultHeight)

        let shell = NSView(frame: frame)
        shell.wantsLayer = true
        shell.layer?.cornerRadius = 12
        shell.layer?.masksToBounds = true
        // The shell colour shows for the instant before the page paints;
        // matching the page's own background avoids a white flash.
        shell.layer?.backgroundColor = NSColor(calibratedRed: 0.09, green: 0.09,
                                               blue: 0.11, alpha: 1).cgColor

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        let ucc = WKUserContentController()
        ucc.add(self, name: "bar")
        cfg.userContentController = ucc

        let w = WKWebView(frame: shell.bounds, configuration: cfg)
        w.autoresizingMask = [.width, .height]
        w.navigationDelegate = self
        w.wantsLayer = true
        w.layer?.backgroundColor = NSColor.clear.cgColor
        w.layer?.cornerRadius = 12
        w.layer?.masksToBounds = true
        w.layer?.isOpaque = false
        // Not public API, but the documented-by-everyone way to stop WebKit
        // painting an opaque white page background. Guarded so a WebKit
        // build without the key can't crash the app.
        w.setValue(false, forKey: "drawsBackground")
        shell.addSubview(w)

        let p = NSPanel(contentRect: frame,
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered,
                        defer: true)
        p.isFloatingPanel = true
        p.becomesKeyOnlyIfNeeded = true
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.level = .statusBar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.contentView = shell
        // Corner radius lives on the shell; the panel itself must not draw.
        panel = p
        web = w

        if let url = Self.pageURL() {
            w.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            // No bundle resource (running the raw binary): render an inline
            // fallback so the popover still shows numbers instead of blank.
            w.loadHTMLString(Self.fallbackHTML(), baseURL: nil)
        }
    }

    private static func pageURL() -> URL? {
        if let u = Bundle.main.url(forResource: "popover", withExtension: "html") { return u }
        // Dev convenience: run from the source tree without bundling.
        let side = URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent().appendingPathComponent("popover.html")
        return FileManager.default.fileExists(atPath: side.path) ? side : nil
    }

    private static func fallbackHTML() -> String {
        "<html><body style=\"background:#16161a;color:#eee;font:13px -apple-system;padding:16px\">"
        + "popover.html not found in the bundle</body></html>"
    }

    // ── Show / hide ───────────────────────────────────────────────────
    func toggle() { isOpen ? close() : open() }

    func open() {
        build()
        guard let p = panel else { return }
        position()
        p.orderFrontRegardless()
        installMonitors()
        // Re-push the latest data every open: the panel persists between
        // showings, so a stale render would otherwise linger.
        if let payload = pendingPayload { push(payload) }
        if let st = pendingStation { pushStation(st) }
        else if let e = pendingStationError { stationFailed(e) }
    }

    func close() {
        removeMonitors()
        panel?.orderOut(nil)
    }

    /// Anchor under the status button, on the button's own screen, clamped
    /// to the visible frame so a notch or a screen edge can't push it off.
    private func position() {
        guard let p = panel else { return }
        let height = p.frame.height
        var target = NSRect(x: 0, y: 0, width: Self.width, height: height)

        // Unlike kaboo we own the NSStatusItem, so no KVC into systray
        // internals is needed — the button's window frame is authoritative.
        if let btn = statusItem?.button, let bw = btn.window {
            let b = bw.convertToScreen(btn.convert(btn.bounds, to: nil))
            let screen = NSScreen.screens.first { NSPointInRect(NSPoint(x: b.midX, y: b.midY), $0.frame) }
                ?? NSScreen.main
            guard let s = screen else { return }
            let vis = s.visibleFrame
            var x = b.midX - Self.width / 2
            var y = b.minY - height - 6
            x = min(max(x, vis.minX + 4), max(vis.minX + 4, vis.maxX - Self.width - 4))
            y = min(max(y, vis.minY + 4), max(vis.minY + 4, vis.maxY - height - 4))
            target = NSRect(x: x.rounded(), y: y.rounded(), width: Self.width, height: height)
        } else if let s = NSScreen.main {
            let vis = s.visibleFrame
            target = NSRect(x: (vis.midX - Self.width / 2).rounded(),
                            y: (vis.maxY - height - 6).rounded(),
                            width: Self.width, height: height)
        }
        p.setFrame(target, display: true)
    }

    // ── Dismissal ─────────────────────────────────────────────────────
    private func installMonitors() {
        removeMonitors()
        let types: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: types) { [weak self] _ in
            self?.close()
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: types) { [weak self] ev in
            guard let self = self else { return ev }
            if !self.clickIsInsideUs(ev) { self.close() }
            return ev
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(resignActive),
            name: NSApplication.didResignActiveNotification, object: nil)
    }

    private func removeMonitors() {
        if let g = globalMonitor { NSEvent.removeMonitor(g); globalMonitor = nil }
        if let l = localMonitor { NSEvent.removeMonitor(l); localMonitor = nil }
        NotificationCenter.default.removeObserver(
            self, name: NSApplication.didResignActiveNotification, object: nil)
    }

    @objc private func resignActive() { close() }

    /// The status button counts as "inside": otherwise clicking the icon to
    /// dismiss would close here and immediately reopen from the button's own
    /// action, which reads as the popover flickering and staying open.
    private func clickIsInsideUs(_ ev: NSEvent) -> Bool {
        if let w = ev.window, w === panel { return true }
        let pt = NSEvent.mouseLocation
        if let p = panel, p.frame.contains(pt) { return true }
        if let btn = statusItem?.button, let bw = btn.window {
            let b = bw.convertToScreen(btn.convert(btn.bounds, to: nil))
            if b.contains(pt) { return true }
        }
        return false
    }

    // ── Data ──────────────────────────────────────────────────────────
    /// Hand the page a JSON blob. Held if the page hasn't finished loading.
    func push(_ json: String) {
        pendingPayload = json
        guard loaded, let w = web else { return }
        // Base64 so no amount of quoting or newlines in the JSON can break
        // out of the JS string literal.
        let b64 = Data(json.utf8).base64EncodedString()
        w.evaluateJavaScript("window.__render(atob('\(b64)'))", completionHandler: nil)
    }

    /// Hand the page the workstation probe result. Separate from push()
    /// because it arrives seconds later: the probe shells out to curl, git
    /// and gh, and blocking the popover on the slowest network call before
    /// painting anything would make opening it feel broken.
    func pushStation(_ json: String) {
        pendingStation = json
        guard loaded, let w = web else { return }
        let b64 = Data(json.utf8).base64EncodedString()
        w.evaluateJavaScript("window.setStation(atob('\(b64)'))", completionHandler: nil)
    }

    /// Tell the page the probe could not run, and why. Without this the
    /// station block has only two states — "checking…" and populated —
    /// so any failure is indistinguishable from a slow success.
    func stationFailed(_ reason: String) {
        /* Queue when the page has not finished loading, exactly as
           pushStation does. The first version returned silently in that
           case — so a probe that failed FAST (missing script, no node)
           reported before didFinish and had its message dropped, leaving
           the block on "checking…". The fast-failure path is precisely
           the one this channel exists to report. */
        pendingStationError = reason
        guard loaded, let w = web else { return }
        let b64 = Data(reason.utf8).base64EncodedString()
        w.evaluateJavaScript("window.stationError(atob('\(b64)'))", completionHandler: nil)
    }

    /// Restore the Sync button once a sync finishes.
    func syncFinished(_ message: String) {
        guard loaded, let w = web else { return }
        let b64 = Data(message.utf8).base64EncodedString()
        w.evaluateJavaScript("window.syncDone(atob('\(b64)'))", completionHandler: nil)
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        loaded = true
        w.animator().alphaValue = 1
        if let payload = pendingPayload { push(payload) }
        if let st = pendingStation { pushStation(st) }
        else if let e = pendingStationError { stationFailed(e) }
        // Size the panel to the content once it has laid out.
        w.evaluateJavaScript("document.body.scrollHeight") { [weak self] v, _ in
            guard let self = self, let h = v as? CGFloat, h > 100 else { return }
            self.resize(to: h)
        }
    }

    private func resize(to h: CGFloat) {
        guard let p = panel, let s = NSScreen.main else { return }
        let maxH = s.visibleFrame.height - 40
        let clamped = max(200, min(maxH, h))
        guard abs(clamped - p.frame.height) > 1 else { return }
        p.setContentSize(NSSize(width: Self.width, height: clamped))
        position()
    }

    // ── Page → app messages ───────────────────────────────────────────
    func userContentController(_ c: WKUserContentController,
                               didReceive msg: WKScriptMessage) {
        guard let body = msg.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "close":
            close()
        case "open_site":
            onOpenSite?()
            close()
        case "refresh":
            onRefresh?()
        case "pick":
            if let m = body["metric"] as? String { onPickMetric?(m) }
        case "resize":
            if let h = body["height"] as? CGFloat { resize(to: h) }
        case "sync":
            onSync?()
        case "ask":
            onAsk?()
            close()
        case "open_repo":
            onOpenRepo?()
            close()
        case "open_site_row":
            onOpenURL?("https://antaresyuan.site/")
            close()
        case "open_worker":
            onOpenURL?("https://usage.antaresyuan.site/")
            close()
        case "open_ci":
            onOpenURL?("https://github.com/AntaresYuan/personal_website/actions")
            close()
        // Deep link straight to this zone's Web Analytics, not the account
        // root — the account has other zones and landing on a chooser
        // defeats the point of a one-click row.
        case "open_analytics":
            onOpenURL?("https://dash.cloudflare.com/0b6cc86868178d20228e20ff3836d5f4/antaresyuan.site/analytics/web/overview")
            close()
        case "quit":
            NSApplication.shared.terminate(nil)
        default:
            break
        }
    }

    /// Render the popover offscreen to a PNG. Same reason as the menu
    /// version: Screen Recording permission isn't available, so the only
    /// way to actually look at this is to have it draw itself.
    func snapshot(to path: String, done: @escaping (Bool) -> Void) {
        build()
        guard let w = web else { done(false); return }
        position()
        panel?.orderFrontRegardless()
        // Let the page paint AND let its resize message be applied — the
        // first render clipped the last rows and the whole footer because
        // the snapshot fired at the default 560pt height while the content
        // wanted more. Measure explicitly, resize, then wait again.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            w.evaluateJavaScript("document.querySelector('.wrap').scrollHeight") { v, _ in
                if let h = v as? CGFloat, h > 100 { self.resize(to: h) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    // Snapshot the webview at its CURRENT bounds, which now
                    // reflect the resized panel.
                    let cfg = WKSnapshotConfiguration()
                    cfg.rect = w.bounds
                    w.takeSnapshot(with: cfg) { img, err in
                        defer { self.close() }
                        guard let img = img,
                              let tiff = img.tiffRepresentation,
                              let rep = NSBitmapImageRep(data: tiff),
                              let png = rep.representation(using: .png, properties: [:]) else {
                            print("snapshot failed: \(err?.localizedDescription ?? "no image")")
                            done(false); return
                        }
                        try? png.write(to: URL(fileURLWithPath: path))
                        print("popover -> \(path)  (\(Int(img.size.width))×\(Int(img.size.height)))")
                        done(true)
                    }
                }
            }
        }
    }
}
