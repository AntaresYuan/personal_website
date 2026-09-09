// ════════════════════════════════════════════════════════════════════════
//  usagebar — a macOS menu bar readout for the /usage numbers.
//
//  Ported in spirit from kaboo's `kaboo-cli menubar` (cli/menubar_*.go plus
//  menubar_popover_darwin.m — roughly 27,000 lines of Go, Objective-C and
//  WebView JS). This is one Swift file, because almost all of that size is
//  spent on things a personal site does not have: multi-provider quota
//  polling, plan/alert modes, auto-update activation journals, a themeable
//  WebView popover, and a Claude statusline bridge.
//
//  What IS worth porting is the part that makes it useful at a glance:
//
//    · Compact numbers in the title. kaboo's rule (menubar_format.go) is
//      that the status item shows numbers and never provider names or unit
//      words, because horizontal space in the menu bar is the scarcest
//      resource on the screen. 1.2M, not "1,234,567 tokens".
//
//    · Short and long width modes, with a hard rune cap. Long mode joins
//      metrics with "·" and truncates rather than letting the title push
//      other status items off the bar.
//
//    · Today / 7-day / all-time as the three metrics that matter, each
//      available as tokens or cost.
//
//    · The menu is where detail lives — the title stays terse.
//
//  Deliberately NOT ported: live TPM polling (needs a running agent hook),
//  quota/plan modes (no provider quota API here), themes (the menu bar is
//  not the place to re-render 16 site skins), auto-update (this is a local
//  build, not a distributed binary).
//
//  Data source: the same public endpoint the website reads. No local
//  transcript parsing happens here, so this process needs no file access
//  beyond its own preferences — it sees exactly what any visitor sees.
//
//  Build:   ops/menubar/build.sh
//  Run:     ops/menubar/usagebar
//  Install: ops/menubar/install.sh   (LaunchAgent, runs at login)
// ════════════════════════════════════════════════════════════════════════

import Cocoa

// ── Configuration ─────────────────────────────────────────────────────
// Endpoint is overridable so the same binary can point at the local
// preview server during development.
let kDefaultEndpoint = "https://usage.antaresyuan.site/"
let kRefreshInterval: TimeInterval = 15 * 60   // the data updates hourly
let kLongTitleMaxChars = 32                    // kaboo's width budget

// ── Compact number formatting ─────────────────────────────────────────
// kaboo's compactTokens: three significant-ish digits with a unit suffix,
// because "1.2M" reads instantly and "1,234,567" does not.
func compact(_ n: Int) -> String {
    let v = Double(n)
    switch abs(v) {
    case 0..<1_000:
        return "\(n)"
    case 1_000..<1_000_000:
        let x = v / 1_000
        return x < 10 ? String(format: "%.1fk", x) : String(format: "%.0fk", x)
    case 1_000_000..<1_000_000_000:
        let x = v / 1_000_000
        return x < 10 ? String(format: "%.1fM", x) : String(format: "%.0fM", x)
    default:
        let x = v / 1_000_000_000
        return x < 10 ? String(format: "%.2fB", x) : String(format: "%.1fB", x)
    }
}

func money(_ cents: Int) -> String {
    let d = Double(cents) / 100
    if d >= 1000 { return String(format: "$%.0f", d) }
    if d >= 10   { return String(format: "$%.0f", d) }
    return String(format: "$%.2f", d)
}

func hoursText(_ seconds: Int) -> String {
    if seconds < 3600 { return "\(seconds / 60)m" }
    return String(format: "%.0fh", Double(seconds) / 3600)
}

// ── The data we read from the public endpoint ─────────────────────────
struct Day {
    let date: String
    let tokens: Int
    let sessions: Int
    let costCents: Int
    let totalTokens: Int
    let cachedInputTokens: Int
    let activeSeconds: Int
    let toolCounts: [String: Int]
}

struct Snapshot {
    var days: [Day] = []
    var updated: String = ""
    var error: String? = nil

    // Windows. `today` uses the endpoint's own last row rather than the
    // local clock, so a timezone difference between this Mac and the
    // uploading device can't make the number silently read zero.
    var today: Day? { days.last(where: { $0.tokens > 0 || $0.sessions > 0 }) }

    func window(_ n: Int) -> [Day] { Array(days.suffix(n)) }

    func sum(_ n: Int, _ key: (Day) -> Int) -> Int {
        window(n).reduce(0) { $0 + key($1) }
    }
    func sumAll(_ key: (Day) -> Int) -> Int { days.reduce(0) { $0 + key($1) } }

    var activeDays: Int { days.filter { $0.tokens > 0 }.count }
    /// Date of the most recent day with any usage. Drives the local-vs-
    /// remote freshness comparison; nil when nothing has been recorded.
    var lastActiveDate: String? { days.last { $0.tokens > 0 }?.date }

    // Tool mix over the whole window, categories only (never a tool name —
    // the endpoint doesn't carry them; see usage-sources.js).
    var toolMix: [(String, Int)] {
        var t: [String: Int] = [:]
        for d in days { for (k, v) in d.toolCounts { t[k, default: 0] += v } }
        let cats = ["shell", "edit", "read", "browser", "search", "task", "other"]
        return cats.compactMap { k in (t[k] ?? 0) > 0 ? (k, t[k]!) : nil }
            .sorted { $0.1 > $1.1 }
    }
    var mcpCalls: Int {
        days.reduce(0) { $0 + ($1.toolCounts["mcp"] ?? 0) }
    }
}

// ── Title modes ───────────────────────────────────────────────────────
// Mirrors kaboo's TitleMode / WidthMode split: what to show, and how much
// room to take. Persisted so the choice survives a restart.
enum Metric: String, CaseIterable {
    case todayTokens, todayCost, sevenDayTokens, sevenDayCost, allTimeTokens, allTimeCost

    var label: String {
        switch self {
        case .todayTokens:    return "Today — tokens"
        case .todayCost:      return "Today — cost"
        case .sevenDayTokens: return "7 days — tokens"
        case .sevenDayCost:   return "7 days — cost"
        case .allTimeTokens:  return "All time — tokens"
        case .allTimeCost:    return "All time — cost"
        }
    }
    // Short prefix used in long mode, where several metrics share the bar
    // and a bare number would be ambiguous.
    var tag: String {
        switch self {
        case .todayTokens, .todayCost:       return "1D"
        case .sevenDayTokens, .sevenDayCost: return "7D"
        case .allTimeTokens, .allTimeCost:   return "∑"
        }
    }
    func value(_ s: Snapshot) -> String {
        switch self {
        case .todayTokens:    return compact(s.today?.tokens ?? 0)
        case .todayCost:      return money(s.today?.costCents ?? 0)
        case .sevenDayTokens: return compact(s.sum(7) { $0.tokens })
        case .sevenDayCost:   return money(s.sum(7) { $0.costCents })
        case .allTimeTokens:  return compact(s.sumAll { $0.tokens })
        case .allTimeCost:    return money(s.sumAll { $0.costCents })
        }
    }
}

// ── App ───────────────────────────────────────────────────────────────
/* ══════════════════════════════════════════════════════════════════════
   Custom menu views.

   Why these exist: NSMenuItem.attributedTitle can only lay out a single
   run of text, so columns had to be faked with `label.padding(toLength:)`.
   With a proportional font that does not line up — "tokens 3.8k" and
   "at keyboard 0m" ended up with their numbers in different places. Worse,
   a non-clickable row needs isEnabled = false, and the system then greys
   out the whole line, so the actual DATA rendered dimmer than the menu
   commands underneath it. The screenshot made both faults obvious.

   A custom view fixes both: real right-aligned columns, and full-strength
   text on rows that aren't meant to be clicked.

   What this deliberately does NOT do is chase kaboo's popover. kaboo isn't
   using NSMenu at all — menubar_popover_darwin.m is an NSPanel hosting a
   WKWebView on a loopback server, 372pt wide, which is how it affords
   27k lines of JS/CSS, gradients, charts and skins. That is a different
   architecture, not a styling gap. This stays a native menu, done properly.
   ══════════════════════════════════════════════════════════════════════ */

// One label/value pair with the value right-aligned to a shared edge.
final class RowView: NSView {
    private let label: String
    private let value: String
    private let strong: Bool
    static let width: CGFloat = 268
    private static let inset: CGFloat = 14

    init(label: String, value: String, strong: Bool = false) {
        self.label = label
        self.value = value
        self.strong = strong
        super.init(frame: NSRect(x: 0, y: 0, width: RowView.width, height: 20))
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ dirty: NSRect) {
        let lf = NSFont.systemFont(ofSize: 12)
        let vf = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: strong ? .semibold : .regular)
        let la = NSAttributedString(string: label, attributes: [
            .font: lf, .foregroundColor: NSColor.secondaryLabelColor,
        ])
        // labelColor, not a dimmed variant: these rows are the content.
        let va = NSAttributedString(string: value, attributes: [
            .font: vf, .foregroundColor: NSColor.labelColor,
        ])
        let y = (bounds.height - lf.boundingRectForFont.height) / 2 + 1
        la.draw(at: NSPoint(x: Self.inset, y: y))
        // Right-aligned against a fixed edge — this is the part that string
        // padding could never do reliably.
        let vw = va.size().width
        va.draw(at: NSPoint(x: bounds.width - Self.inset - vw, y: y))
    }
}

// Section heading, tracked out like kaboo's uppercase labels.
final class HeaderView: NSView {
    private let text: String
    init(_ text: String) {
        self.text = text
        super.init(frame: NSRect(x: 0, y: 0, width: RowView.width, height: 22))
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ dirty: NSRect) {
        let a = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: 10, weight: .semibold),
            .foregroundColor: NSColor.tertiaryLabelColor,
            .kern: 0.8,
        ])
        a.draw(at: NSPoint(x: 14, y: 6))
    }
}

// A tool-mix row: label, thin proportional bar, percentage. The bar is the
// one thing a plain NSMenu genuinely cannot express.
final class BarRowView: NSView {
    private let label: String
    private let frac: Double
    private let pct: String
    init(label: String, frac: Double, pct: String) {
        self.label = label
        self.frac = max(0, min(1, frac))
        self.pct = pct
        super.init(frame: NSRect(x: 0, y: 0, width: RowView.width, height: 18))
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ dirty: NSRect) {
        let f = NSFont.systemFont(ofSize: 11)
        let la = NSAttributedString(string: label, attributes: [
            .font: f, .foregroundColor: NSColor.secondaryLabelColor,
        ])
        let pa = NSAttributedString(string: pct, attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular),
            .foregroundColor: NSColor.labelColor,
        ])
        let y = (bounds.height - f.boundingRectForFont.height) / 2 + 1
        la.draw(at: NSPoint(x: 14, y: y))
        let pw = pa.size().width
        pa.draw(at: NSPoint(x: bounds.width - 14 - pw, y: y))

        // Track and fill, between the label column and the percentage.
        let x0: CGFloat = 86
        let x1 = bounds.width - 14 - pw - 10
        guard x1 > x0 else { return }
        let h: CGFloat = 4
        let by = (bounds.height - h) / 2
        let track = NSBezierPath(roundedRect: NSRect(x: x0, y: by, width: x1 - x0, height: h),
                                 xRadius: 2, yRadius: 2)
        NSColor.tertiaryLabelColor.withAlphaComponent(0.28).setFill()
        track.fill()
        let w = max(2, (x1 - x0) * CGFloat(frac))
        NSColor.controlAccentColor.setFill()
        NSBezierPath(roundedRect: NSRect(x: x0, y: by, width: w, height: h),
                     xRadius: 2, yRadius: 2).fill()
    }
}

// 30-day sparkline — the "shape" of recent work, which no text row conveys.
final class SparkView: NSView {
    private let values: [Int]
    init(_ values: [Int]) {
        self.values = values
        super.init(frame: NSRect(x: 0, y: 0, width: RowView.width, height: 42))
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ dirty: NSRect) {
        guard values.count > 1, let peak = values.max(), peak > 0 else { return }
        let x0: CGFloat = 14, x1 = bounds.width - 14
        let y0: CGFloat = 8, y1 = bounds.height - 8
        let step = (x1 - x0) / CGFloat(values.count - 1)
        let pts = values.enumerated().map { i, v in
            NSPoint(x: x0 + CGFloat(i) * step,
                    y: y0 + (y1 - y0) * CGFloat(Double(v) / Double(peak)))
        }
        // Filled area, then the line on top.
        let area = NSBezierPath()
        area.move(to: NSPoint(x: pts[0].x, y: y0))
        pts.forEach { area.line(to: $0) }
        area.line(to: NSPoint(x: pts[pts.count - 1].x, y: y0))
        area.close()
        NSColor.controlAccentColor.withAlphaComponent(0.16).setFill()
        area.fill()

        let line = NSBezierPath()
        line.move(to: pts[0])
        pts.dropFirst().forEach { line.line(to: $0) }
        line.lineWidth = 1.5
        line.lineJoinStyle = .round
        NSColor.controlAccentColor.setStroke()
        line.stroke()

        // Mark the peak so the sparkline has a readable anchor.
        if let pi = values.firstIndex(of: peak) {
            let p = pts[pi]
            NSColor.controlAccentColor.setFill()
            NSBezierPath(ovalIn: NSRect(x: p.x - 2.5, y: p.y - 2.5, width: 5, height: 5)).fill()
        }
    }
}

final class App: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    // Exposed for --where, which needs the real button's placed geometry.
    var statusButton: NSStatusBarButton? { item?.button }
    private var timer: Timer?
    private var snap = Snapshot()
    private var popover: Popover?
    // Held rather than attached: item.menu would swallow the left click
    // that must open the popover.
    private var menu: NSMenu?
    private var lastBody: Data?
    /// Which endpoint actually answered. Differs from the configured
    /// first choice whenever the chain fell through.
    private var activeEndpoint: String?

    private let defaults = UserDefaults.standard
    /* Endpoint resolution order: env var, then the app's own preference
       domain, then production.

       The env var matters more than it looks. An unbundled binary run from
       a directory has no Info.plist and therefore no stable bundle
       identifier, so `defaults write antares.usagebar …` writes to a domain
       this process never reads — verified the hard way: --title happily
       reported production numbers while the preference sat unused. Rather
       than fake a bundle, honour USAGEBAR_ENDPOINT, which is explicit and
       works identically for a LaunchAgent (it sets EnvironmentVariables). */
    private var endpoint: String {
        if let e = ProcessInfo.processInfo.environment["USAGEBAR_ENDPOINT"], !e.isEmpty {
            return e
        }
        return defaults.string(forKey: "endpoint") ?? kDefaultEndpoint
    }
    private var shortMode: Bool {
        get { defaults.object(forKey: "shortMode") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "shortMode") }
    }
    private var primary: Metric {
        get { Metric(rawValue: defaults.string(forKey: "primary") ?? "") ?? .todayTokens }
        set { defaults.set(newValue.rawValue, forKey: "primary") }
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // Monospaced digits stop the title from jittering as numbers change
        // width — a fixed-width readout is the whole point of a status item.
        if let b = item.button {
            b.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            b.title = "…"
            // Draw as a plain label: no bezel, no background. Without this
            // the button carries its light-mode control background, which
            // the offscreen render exposed as a white pill sitting on the
            // dark menu bar. The system tints the title for the current
            // appearance only when the button is borderless and transparent.
            b.isBordered = false
            b.bezelStyle = .inline
            (b.cell as? NSButtonCell)?.backgroundColor = .clear
            b.imagePosition = .noImage
            b.setButtonType(.momentaryChange)
            /* Left click opens the WebView popover; right click gets the
               native menu.

               The menu IS attached (see rebuildMenu). Detaching it and
               relying only on target/action left the status item unplaced
               — it sat at a stable x ≈ -683 and never appeared on the bar.
               Attaching a menu is evidently what makes macOS allocate the
               slot. So the menu stays attached and the click is intercepted
               here instead: for a left click we clear item.menu for the
               duration of the event so AppKit has nothing to pop, show the
               popover, and put the menu back on the next runloop turn. */
            b.target = self
            b.action = #selector(statusClicked)
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        popover = Popover(statusItem: item)
        popover?.onOpenSite = { [weak self] in self?.openSite() }
        popover?.onRefresh = { [weak self] in self?.refresh() }
        popover?.onSync = { [weak self] in self?.runSync() }
        popover?.onOpenRepo = { [weak self] in self?.openRepo() }
        popover?.onAsk = { [weak self] in self?.askClaude() }
        popover?.onOpenURL = { s in
            if let u = URL(string: s) { NSWorkspace.shared.open(u) }
        }

        rebuildMenu()
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: kRefreshInterval, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    /// Route the status item click: popover on left, native menu on right.
    ///
    /// The standard AppKit pattern for a status item that wants both: keep
    /// item.menu nil so the button's action fires, and for the right click
    /// attach the menu, click it open, then detach on the next runloop turn.
    @objc private func statusClicked() {
        let ev = NSApp.currentEvent
        let isRight = ev?.type == .rightMouseUp
            || ev?.type == .rightMouseDown
            || (ev?.modifierFlags.contains(.control) ?? false)
        if isRight {
            rebuildMenu()
            item.menu = menu
            item.button?.performClick(nil)
            // Detach again so the next left click reaches our action rather
            // than re-opening the menu.
            DispatchQueue.main.async { [weak self] in self?.item.menu = nil }
        } else {
            popover?.toggle()
        }
    }

    /* pushToPopover() used to live here and was never called: every real
       path calls popover?.push directly. runStation() was hung off it, so
       the entire workstation feature was dead code in the running app
       while every --popover render (a fresh process with its own wiring)
       looked perfect. The helper is gone rather than fixed — a wrapper
       that only one of three call sites uses is what caused this. */

    // ── Workstation ───────────────────────────────────────────────────
    /* The probe is a node script rather than Swift: the checks are shell
       calls whose output is far easier to parse in JS, and keeping it a
       separate file means it can be run by hand to verify what the panel
       is showing. Every diagnostic path in this project that grew its own
       private copy of the logic eventually disagreed with the real one. */

    private var stationBusy = false

    private func repoRoot() -> String {
        // ops/menubar/<binary> → repo root is two levels up from the
        // script's directory. Resolve from the bundle when running as an
        // app, since CWD is / for a launched .app.
        let exe = Bundle.main.bundleURL
        // …/ops/menubar/usagebar.app  →  …/ops/menubar
        var dir = exe.deletingLastPathComponent()
        if dir.lastPathComponent != "menubar" {
            // Running the bare binary: use the executable's own directory.
            dir = URL(fileURLWithPath: CommandLine.arguments[0])
                .resolvingSymlinksInPath().deletingLastPathComponent()
        }
        return dir.deletingLastPathComponent().deletingLastPathComponent().path
    }

    private func nodeBinary() -> String? {
        /* Same reasoning as refresh-snapshot.sh: `which node` inside a
           sandboxed shell points at a content-addressed runtime directory
           that does not survive across sessions, so probe the stable
           locations instead of trusting PATH. */
        let candidates = [
            ProcessInfo.processInfo.environment["ANTARES_NODE"],
            "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node",
        ].compactMap { $0 }
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            return c
        }
        // Highest installed nvm version, if any.
        let nvm = NSHomeDirectory() + "/.nvm/versions/node"
        if let vs = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            let sorted = vs.sorted { a, b in
                a.compare(b, options: .numeric) == .orderedAscending
            }
            for v in sorted.reversed() {
                let p = "\(nvm)/\(v)/bin/node"
                if FileManager.default.isExecutableFile(atPath: p) { return p }
            }
        }
        return nil
    }

    /// Run a command off the main thread and hand back stdout.
    private func shell(_ launch: String, _ args: [String], cwd: String? = nil,
                       then done: @escaping (Int32, String) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let t = Process()
            t.executableURL = URL(fileURLWithPath: launch)
            t.arguments = args
            if let c = cwd { t.currentDirectoryURL = URL(fileURLWithPath: c) }
            let pipe = Pipe()
            t.standardOutput = pipe
            t.standardError = Pipe()
            do { try t.run() } catch {
                DispatchQueue.main.async { done(-1, "") }
                return
            }
            let out = pipe.fileHandleForReading.readDataToEndOfFile()
            t.waitUntilExit()
            let s = String(data: out, encoding: .utf8) ?? ""
            DispatchQueue.main.async { done(t.terminationStatus, s) }
        }
    }

    private func runStation() {
        /* Every exit from this function must tell the page SOMETHING.
           The first version returned silently on three different failure
           paths, so a stale binary (or a missing node, or a moved repo)
           left the panel sitting on "checking…" forever with no way to
           tell "still working" from "never going to work". A status line
           the user can act on beats an honest-looking spinner. */
        guard !stationBusy else { return }
        guard let node = nodeBinary() else {
            popover?.stationFailed("node not found")
            return
        }
        let root = repoRoot()
        let script = root + "/ops/menubar/station.js"
        guard FileManager.default.fileExists(atPath: script) else {
            popover?.stationFailed("probe missing at \(root)")
            return
        }
        stationBusy = true
        shell(node, [script], cwd: root) { [weak self] code, out in
            self?.stationBusy = false
            if code != 0 {
                self?.popover?.stationFailed("probe exited \(code)")
                return
            }
            if out.isEmpty {
                self?.popover?.stationFailed("probe returned nothing")
                return
            }
            self?.popover?.pushStation(out)
        }
    }

    @objc private func runSync() {
        guard let node = nodeBinary() else {
            popover?.syncFinished("no node")
            return
        }
        let root = repoRoot()
        shell(node, [root + "/scripts/sync-usage.js", "--local-only", "--window", "90"],
              cwd: root) { [weak self] code, _ in
            self?.popover?.syncFinished(code == 0 ? "Synced ✓" : "Sync failed")
            // Re-read the snapshot so the numbers above update too.
            self?.refresh()
        }
    }

    @objc private func openRepo() {
        NSWorkspace.shared.open(URL(fileURLWithPath: repoRoot()))
    }

    /* "Ask Claude" opens an interactive session in Terminal rather than
       running `claude -p` headless. Two reasons: a real question usually
       needs follow-ups, and headless start-up alone is ~17s, which is a
       long time to stare at a popover. The menu bar's job here is to be an
       entrance — carry the working directory over and get out of the way. */
    @objc private func askClaude() {
        let root = repoRoot()
        let script = """
        tell application "Terminal"
            activate
            do script "cd \\"\(root)\\" && claude"
        end tell
        """
        shell("/usr/bin/osascript", ["-e", script]) { _, _ in }
    }

    // Date helpers for the menu header. Kept tiny and local: pulling in a
    // DateFormatter per row would be the only allocation in the hot path.
    static func localToday() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
    static func pretty(_ iso: String) -> String {
        let inF = DateFormatter()
        // en_US_POSIX: without it the system locale wins and the header
        // rendered as "9月 4" on a machine set to Chinese, in an app whose
        // every other string is English.
        inF.locale = Locale(identifier: "en_US_POSIX")
        inF.dateFormat = "yyyy-MM-dd"
        inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US_POSIX")
        out.dateFormat = "MMM d"
        out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d)
    }

    // ── Title ─────────────────────────────────────────────────────────
    private func renderTitle() {
        guard let b = item.button else { return }
        if snap.error != nil {
            b.title = "⚠"
            b.toolTip = "usage: \(snap.error!)"
            return
        }
        if snap.days.isEmpty {
            b.title = "—"
            b.toolTip = "usage: no data yet"
            return
        }

        if shortMode {
            b.title = primary.value(snap)
        } else {
            // Long mode: three metrics joined by "·", then hard-clamped.
            // kaboo clamps rather than eliding mid-number so the leading
            // (most important) metric always stays readable.
            let parts = [Metric.todayTokens, .sevenDayTokens, .allTimeCost].map {
                "\($0.tag) \($0.value(snap))"
            }
            var text = parts.joined(separator: " · ")
            if text.count > kLongTitleMaxChars {
                text = String(text.prefix(kLongTitleMaxChars - 1)) + "…"
            }
            b.title = text
        }

        let t = snap.today
        b.toolTip = [
            "today  \(compact(t?.tokens ?? 0)) tokens · \(money(t?.costCents ?? 0))",
            "7 days \(compact(snap.sum(7) { $0.tokens })) tokens",
            "updated \(snap.updated.isEmpty ? "unknown" : String(snap.updated.prefix(16)))",
        ].joined(separator: "\n")
    }


    // ── Menu ──────────────────────────────────────────────────────────
    // The detail lives here, so the bar itself can stay one number wide.
    private func rebuildMenu() {
        let m = NSMenu()
        m.autoenablesItems = false

        func row(_ label: String, _ value: String, strong: Bool = false) {
            let i = NSMenuItem()
            i.view = RowView(label: label, value: value, strong: strong)
            m.addItem(i)
        }

        func header(_ text: String) {
            let i = NSMenuItem()
            i.view = HeaderView(text)
            m.addItem(i)
        }

        if let e = snap.error {
            header("PROBLEM")
            row("", e)
            m.addItem(.separator())
        } else if snap.days.isEmpty {
            header("NO DATA")
            m.addItem(.separator())
        } else {
            // `today` is the last day WITH data, not the calendar date, so
            // that a machine in another timezone (or one that hasn't synced
            // yet) doesn't show a truthful-but-useless zero. The header
            // therefore has to say which day it means: the offscreen render
            // showed "TODAY 3.8k" for data that was actually from Sep 4,
            // which reads as a bug even though the number is right.
            let t = snap.today
            if let d = t?.date, d != Self.localToday() {
                header("LATEST — \(Self.pretty(d))")
            } else {
                header("TODAY")
            }
            // The headline number gets extra weight; the rest are context.
            row("tokens", compact(t?.tokens ?? 0), strong: true)
            row("cost", money(t?.costCents ?? 0))
            row("sessions", "\(t?.sessions ?? 0)")
            if let secs = t?.activeSeconds, secs > 0 { row("at keyboard", hoursText(secs)) }

            m.addItem(.separator())
            header("LAST 7 DAYS")
            // A 30-day sparkline sits above the 7-day totals: the totals
            // answer "how much", the sparkline answers "in what shape".
            // (Labelling it "LAST 30 DAYS" would be wrong — the rows below
            // are 7-day sums; only the chart spans 30.)
            let recent = snap.days.suffix(30).map { $0.tokens }
            if recent.count > 1, (recent.max() ?? 0) > 0 {
                let si = NSMenuItem()
                si.view = SparkView(Array(recent))
                m.addItem(si)
            }
            row("tokens", compact(snap.sum(7) { $0.tokens }))
            row("cost", money(snap.sum(7) { $0.costCents }))
            row("sessions", "\(snap.sum(7) { $0.sessions })")

            m.addItem(.separator())
            header("ALL TIME")
            row("tokens", compact(snap.sumAll { $0.tokens }), strong: true)
            row("cost", money(snap.sumAll { $0.costCents }))
            row("active days", "\(snap.activeDays)")
            let total = snap.sumAll { $0.totalTokens }
            if total > 0 {
                let cached = snap.sumAll { $0.cachedInputTokens }
                row("from cache", String(format: "%.0f%%", 100 * Double(cached) / Double(total)))
            }

            // Tool mix — the dimension this port added to the collector.
            let mix = snap.toolMix
            if !mix.isEmpty {
                m.addItem(.separator())
                header("TOOL MIX")
                let sum = mix.reduce(0) { $0 + $1.1 }
                // Bars rather than bare percentages: 76 / 15 / 4 / 2 is a
                // shape, and the shape is the point.
                for (name, n) in mix.prefix(4) {
                    let frac = sum > 0 ? Double(n) / Double(sum) : 0
                    let bi = NSMenuItem()
                    bi.view = BarRowView(label: name, frac: frac,
                                         pct: String(format: "%.0f%%", 100 * frac))
                    m.addItem(bi)
                }
                if snap.mcpCalls > 0 {
                    row("via MCP", String(format: "%.0f%%", 100 * Double(snap.mcpCalls) / Double(sum)))
                }
            }
        }

        m.addItem(.separator())

        // Title mode submenu — which number rides in the bar.
        let modeItem = NSMenuItem(title: "Menu bar shows", action: nil, keyEquivalent: "")
        let modeMenu = NSMenu()
        for metric in Metric.allCases {
            let mi = NSMenuItem(title: metric.label, action: #selector(pickMetric(_:)), keyEquivalent: "")
            mi.target = self
            mi.representedObject = metric.rawValue
            mi.state = (shortMode && metric == primary) ? .on : .off
            modeMenu.addItem(mi)
        }
        modeMenu.addItem(.separator())
        let wide = NSMenuItem(title: "All three (wide)", action: #selector(pickWide), keyEquivalent: "")
        wide.target = self
        wide.state = shortMode ? .off : .on
        modeMenu.addItem(wide)
        modeItem.submenu = modeMenu
        m.addItem(modeItem)

        let openItem = NSMenuItem(title: "Open usage page", action: #selector(openSite), keyEquivalent: "")
        openItem.target = self
        m.addItem(openItem)

        let refreshItem = NSMenuItem(title: "Refresh now", action: #selector(refreshNow), keyEquivalent: "r")
        refreshItem.target = self
        m.addItem(refreshItem)

        if !snap.updated.isEmpty {
            let u = NSMenuItem(title: "data from \(String(snap.updated.prefix(16)))Z", action: nil, keyEquivalent: "")
            u.isEnabled = false
            u.attributedTitle = NSAttributedString(string: "data from \(String(snap.updated.prefix(16)))Z", attributes: [
                .font: NSFont.systemFont(ofSize: 10),
                .foregroundColor: NSColor.tertiaryLabelColor,
            ])
            m.addItem(u)
        }

        m.addItem(.separator())
        let quit = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        m.addItem(quit)

        menu = m
    }

    // ── Actions ───────────────────────────────────────────────────────
    @objc private func pickMetric(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let metric = Metric(rawValue: raw) else { return }
        primary = metric
        shortMode = true
        renderTitle()
        rebuildMenu()
    }

    @objc private func pickWide() {
        shortMode = false
        renderTitle()
        rebuildMenu()
    }

    @objc private func openSite() {
        /* Derive the site URL from the endpoint that ACTUALLY served the
           data, not from the configured first choice. With the fallback
           chain those can differ: if the local preview is down and we fell
           through to production, opening a dead localhost page would be
           the wrong thing. */
        let src = activeEndpoint ?? endpoint
        var s = "https://antaresyuan.site/usage/"
        if src.contains("localhost") || src.contains("127.0.0.1") {
            if let u = URL(string: src), let host = u.host {
                s = "http://\(host):\(u.port ?? 80)/usage/"
            }
        }
        if let u = URL(string: s) { NSWorkspace.shared.open(u) }
    }

    @objc private func refreshNow() { refresh() }

    // ── Offscreen preview ─────────────────────────────────────────────
    /* Draws the REAL status button and the REAL menu into a PNG.
       Screen Recording permission is not granted to this process, so
       screencapture cannot photograph the menu bar. But the button is an
       ordinary NSView and the menu items carry the same NSAttributedStrings
       the system draws, so the app can render itself.

       This is a faithful render of the actual view and the actual menu
       items — same fonts, same colours, same widths — not a mock-up. What
       it does NOT prove is how macOS positions the item among other status
       items, so it is a check on content and layout, not on placement. */
    func renderPreview(to path: String) {
        let pad: CGFloat = 14
        let rowH: CGFloat = 22
        let sepH: CGFloat = 11
        let items = item.menu?.items ?? []

        func attr(_ mi: NSMenuItem) -> NSAttributedString {
            if let a = mi.attributedTitle { return a }
            return NSAttributedString(string: mi.title, attributes: [
                .font: NSFont.systemFont(ofSize: 13),
                .foregroundColor: NSColor.labelColor,
            ])
        }

        // Rows are custom NSViews now, so the render has to draw the VIEW,
        // not a title string — otherwise the preview would show an empty
        // panel while the real menu looked fine, or vice versa.
        func heightOf(_ mi: NSMenuItem) -> CGFloat {
            if mi.isSeparatorItem { return sepH }
            if let v = mi.view { return v.frame.height }
            return rowH
        }

        var menuW: CGFloat = RowView.width
        for mi in items where !mi.isSeparatorItem {
            if let v = mi.view { menuW = max(menuW, v.frame.width) }
            else { menuW = max(menuW, attr(mi).size().width + pad * 2 + 26) }
        }
        let menuH = items.reduce(CGFloat(0)) { $0 + heightOf($1) } + pad
        let barH: CGFloat = 30
        let W = max(menuW + 40, 420)
        let H = barH + menuH + 30

        // Draw into an explicit bitmap rep rather than NSImage.lockFocus().
        // lockFocus on a bare NSImage gave "CGImageDestinationFinalize
        // failed for output type 'public.tiff'" — with no window server
        // backing there is no drawing destination to snapshot. An explicit
        // NSBitmapImageRep owns its pixels, so it always works headless.
        // scale 2 = Retina, matching how the bar is actually seen.
        let scale = 2
        guard let bmp = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(W) * scale, pixelsHigh: Int(H) * scale,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { print("could not allocate bitmap"); return }
        bmp.size = NSSize(width: W, height: H)

        guard let ctx = NSGraphicsContext(bitmapImageRep: bmp) else {
            print("could not make a context"); return
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        defer {
            NSGraphicsContext.restoreGraphicsState()
        }

        // Backdrop so the light-on-dark menu bar reads correctly.
        NSColor(calibratedWhite: 0.10, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: W, height: H).fill()

        // --- menu bar strip, with the real button drawn into it ---
        NSColor(calibratedWhite: 0.16, alpha: 1).setFill()
        NSRect(x: 0, y: H - barH, width: W, height: barH).fill()
        if let b = item.button {
            /* Draw the title text directly rather than cacheDisplay()ing the
               button. bitmapImageRepForCachingDisplay hands back an OPAQUE
               buffer, so the cache is pre-filled white and the render showed
               a white pill even after the button itself became transparent
               (its corner pixel sampled a0.00). Compositing that opaque
               buffer was the harness lying about the fix.

               So: same string, same font, drawn in the menu-bar text colour.
               This reflects what the system will paint. */
            let title = b.title
            let font = b.font ?? NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            let a = NSAttributedString(string: title, attributes: [
                .font: font,
                .foregroundColor: NSColor(calibratedWhite: 0.95, alpha: 1),
            ])
            let sz = a.size()
            a.draw(at: NSPoint(x: W - sz.width - 18,
                               y: H - barH + (barH - sz.height) / 2))
            print("status item title: \"\(title)\"  (text width \(Int(sz.width))pt)")

            /* Where did macOS actually PUT it? A running, window-server
               registered app whose item is nowhere to be seen usually means
               the bar ran out of room — on a notched display the usable
               left-of-notch strip is short, and overflow items are simply
               not drawn. Report the real geometry instead of guessing. */
            if let win = b.window {
                let f = win.frame
                print(String(format: "item window: x %.0f  y %.0f  w %.0f  h %.0f",
                             f.origin.x, f.origin.y, f.width, f.height))
                if let scr = NSScreen.main {
                    let s = scr.frame
                    print(String(format: "screen:      w %.0f  h %.0f", s.width, s.height))
                    // A notch shows up as an auxiliary top-left area that is
                    // narrower than the full screen width.
                    if #available(macOS 12.0, *) {
                        if let aux = scr.auxiliaryTopLeftArea {
                            print(String(format: "notch: yes — usable left strip is %.0fpt of %.0fpt",
                                         aux.width, s.width))
                        } else {
                            print("notch: none")
                        }
                    }
                    if f.origin.x < 0 || f.maxX > s.maxX {
                        print("⚠ item window is OFF-SCREEN — the bar is full")
                    }
                    if f.width < 1 {
                        print("⚠ item window has zero width — not being drawn")
                    }
                    /* The case that actually bit: on a notched display the
                       item was placed at x=544 when the left strip ends at
                       646 — i.e. it overflowed PAST the notch into the app
                       menu region, where macOS does not reliably draw status
                       items. The item exists, has a window and a sane width,
                       and is still invisible. Checking only for off-screen
                       coordinates misses this entirely. */
                    if #available(macOS 12.0, *), let aux = scr.auxiliaryTopLeftArea,
                       f.origin.x < aux.width {
                        print("⚠ item sits LEFT of the notch (x \(Int(f.origin.x)) < \(Int(aux.width)))")
                        print("  the menu bar is full — this is why it looks missing.")
                        print("  free room by hiding other items, or use a shorter title")
                        print("  (Menu bar shows → a single metric).")
                    }
                }
            } else {
                print("⚠ status item has NO window — never made it onto the bar")
            }

            // Independently confirm the BUTTON is transparent, without
            // letting that opaque cache reach the picture.
            if let rep = b.bitmapImageRepForCachingDisplay(in: b.bounds) {
                b.cacheDisplay(in: b.bounds, to: rep)
                let opaqueBezel = b.isBordered
                print("button bordered: \(opaqueBezel)  (false = no white pill on the real bar)")
            }
        }

        // --- the menu panel ---
        let panel = NSRect(x: 20, y: 20, width: menuW, height: menuH)
        NSColor(calibratedWhite: 0.22, alpha: 1).setFill()
        NSBezierPath(roundedRect: panel, xRadius: 8, yRadius: 8).fill()

        var y = panel.maxY - pad / 2
        for mi in items {
            if mi.isSeparatorItem {
                y -= sepH
                NSColor(calibratedWhite: 0.34, alpha: 1).setFill()
                NSRect(x: panel.minX + 10, y: y + sepH / 2, width: menuW - 20, height: 1).fill()
                continue
            }
            // Custom view: ask it to draw itself into the panel at this y.
            if let v = mi.view {
                let h = v.frame.height
                y -= h
                v.frame = NSRect(x: 0, y: 0, width: menuW, height: h)
                /* Draw the view's content DIRECTLY into the panel context by
                   translating the origin, instead of via
                   bitmapImageRepForCachingDisplay. That call hands back an
                   opaque buffer and clearing it with fill(using:.copy) did
                   not take, so every row landed on a white block — the same
                   opaque-cache trap as the status button earlier. Drawing
                   straight into the current context has no buffer to clear
                   and matches how the real menu composites these views on
                   its own translucent background. */
                NSGraphicsContext.saveGraphicsState()
                let xf = NSAffineTransform()
                xf.translateX(by: panel.minX, yBy: y)
                xf.concat()
                v.draw(v.bounds)
                NSGraphicsContext.restoreGraphicsState()
                continue
            }
            y -= rowH
            let a = attr(mi)
            a.draw(at: NSPoint(x: panel.minX + pad, y: y + 4))
            if mi.state == .on {
                NSAttributedString(string: "✓", attributes: [
                    .font: NSFont.systemFont(ofSize: 12),
                    .foregroundColor: NSColor.labelColor,
                ]).draw(at: NSPoint(x: panel.maxX - 22, y: y + 4))
            }
            if mi.submenu != nil {
                NSAttributedString(string: "›", attributes: [
                    .font: NSFont.systemFont(ofSize: 13),
                    .foregroundColor: NSColor.secondaryLabelColor,
                ]).draw(at: NSPoint(x: panel.maxX - 20, y: y + 4))
            }
        }

        guard let png = bmp.representation(using: .png, properties: [:]) else {
            print("png encode failed"); return
        }
        do {
            try png.write(to: URL(fileURLWithPath: path))
            print("rendered \(items.count) menu items -> \(path)")
        } catch {
            print("write failed: \(error.localizedDescription)")
        }
    }

    // ── Fetch ─────────────────────────────────────────────────────────

    /* Endpoints to try, in order. The menu bar showed ⚠ for days because it
       was installed pointing at the local preview server (port 8796) and
       that server was later shut down — a dev convenience became a hard
       dependency for a thing that runs for weeks. Now a dead endpoint just
       falls through to the next one, and only an ALL-of-them failure is
       worth a warning glyph. */
    /// Pure so --check can assert on it without a network or a UserDefaults
    /// suite. The instance property below just supplies the real inputs.
    static func buildChain(env: String?, pref: String?, fallback: String) -> [String] {
        var chain: [String] = []
        if let e = env, !e.isEmpty { chain.append(e) }
        if let e = pref, !e.isEmpty { chain.append(e) }
        chain.append(fallback)
        // De-dupe while preserving order; the common case is env == fallback.
        var seen = Set<String>()
        return chain.filter { seen.insert($0).inserted }
    }

    /* The local snapshot the CLI writes on every sync (see writeLocalSnapshot
       in scripts/sync-usage.js). Same document shape as the public endpoint,
       so it decodes with the same parser.

       This is kaboo's idea — it caches its scan to menubar_local_usage.json
       from the same pass that uploads, so the menu bar survives being
       offline. The merge policy is inverted though: kaboo trusts its server
       and only falls back when a field is empty, because its backend is
       live. This site's Worker is deployed by hand and can be months
       behind, so here the FRESHER document wins regardless of origin. */
    static func localSnapshotURL() -> URL? {
        let fm = FileManager.default
        if let p = ProcessInfo.processInfo.environment["ANTARES_USAGE_LOCAL_SNAPSHOT"], !p.isEmpty {
            return URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
        }
        if let d = ProcessInfo.processInfo.environment["ANTARES_USAGE_STATE_DIR"], !d.isEmpty {
            let u = URL(fileURLWithPath: (d as NSString).expandingTildeInPath)
                .appendingPathComponent("usage-snapshot.json")
            return fm.fileExists(atPath: u.path) ? u : nil
        }
        let home = fm.homeDirectoryForCurrentUser
        let u = home.appendingPathComponent(".local/share/antares-usage/usage-snapshot.json")
        return fm.fileExists(atPath: u.path) ? u : nil
    }

    private var endpointChain: [String] {
        Self.buildChain(env: ProcessInfo.processInfo.environment["USAGEBAR_ENDPOINT"],
                        pref: defaults.string(forKey: "endpoint"),
                        fallback: kDefaultEndpoint)
    }

    private func refresh() {
        // Read the local snapshot first: it costs a file read, always works
        // offline, and gives the network attempt something to beat.
        var localBody: Data? = nil
        var localSnap: Snapshot? = nil
        if let u = Self.localSnapshotURL(), let d = try? Data(contentsOf: u) {
            let s = Self.parse(d)
            if s.error == nil && s.activeDays > 0 { localBody = d; localSnap = s }
        }
        if let s = localSnap, let d = localBody {
            // Show it immediately, then let the network try to improve on it.
            snap = s; lastBody = d
            activeEndpoint = nil
            renderTitle(); rebuildMenu()
            popover?.push(String(data: d, encoding: .utf8) ?? "")
            runStation()
        }
        attempt(endpointChain, 0, local: localSnap, localBody: localBody)
    }

    /// Compare two candidate documents and keep the more recent one.
    /// "Fresher" = later last-active day; ties go to the remote copy, which
    /// aggregates every device rather than just this one.
    static func remoteWins(_ remote: Snapshot, _ local: Snapshot?) -> Bool {
        guard let l = local else { return true }
        let r = remote.lastActiveDate ?? ""
        let ld = l.lastActiveDate ?? ""
        if r == ld { return true }
        return r > ld
    }

    /// Try one endpoint; on failure recurse to the next. Only the last
    /// failure is surfaced, and it names how many were tried.
    private func attempt(_ chain: [String], _ i: Int,
                         local: Snapshot?, localBody: Data?) {
        guard i < chain.count else { return }
        let isLast = (i == chain.count - 1)
        guard let url = URL(string: chain[i]) else {
            if isLast {
                DispatchQueue.main.async {
                    // A usable local copy is not an error state.
                    if local == nil {
                        self.snap.error = "bad endpoint"
                        self.renderTitle(); self.rebuildMenu()
                    }
                }
            } else { attempt(chain, i + 1, local: local, localBody: localBody) }
            return
        }
        var req = URLRequest(url: url)
        // 20s was fine for one endpoint but stacks up across a chain; a
        // dead loopback port fails instantly anyway.
        req.timeoutInterval = 12
        req.setValue("usagebar", forHTTPHeaderField: "user-agent")

        URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
            guard let self = self else { return }
            var next = Snapshot()
            var ok = false
            var body: Data? = nil
            if let err = err {
                next.error = err.localizedDescription
            } else if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
                next.error = "HTTP \(http.statusCode)"
            } else if let data = data {
                next = Self.parse(data)
                ok = (next.error == nil)
                body = data
            } else {
                next.error = "empty response"
            }

            if !ok && !isLast {
                self.attempt(chain, i + 1, local: local, localBody: localBody)
                return
            }

            if ok && !Self.remoteWins(next, local) {
                // The local snapshot is newer — keep what we already showed.
                // This is the case kaboo's server-first merge would get
                // wrong for this site.
                return
            }
            if !ok, local != nil {
                // Network exhausted but the local copy stands; no ⚠.
                return
            }
            if !ok, let e = next.error, chain.count > 1 {
                next.error = "\(e) (tried \(chain.count) endpoints)"
            }
            if ok, let b = body {
                DispatchQueue.main.async {
                    self.lastBody = b
                    self.activeEndpoint = chain[i]
                }
            }
            DispatchQueue.main.async {
                self.snap = next
                self.renderTitle()
                self.rebuildMenu()
                if let d = self.lastBody, let s = String(data: d, encoding: .utf8) {
                    self.popover?.push(s)
                }
                // Refresh the workstation panel on the same cadence as the
                // usage numbers. runStation() self-guards against overlap.
                self.runStation()
            }
        }.resume()
    }

    // Hand-rolled decode. The endpoint is private-by-default, so most of
    // these keys are absent unless published — every one is optional and
    // missing means zero, never a decode failure that blanks the whole bar.
    static func parse(_ data: Data) -> Snapshot {
        var s = Snapshot()
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            s.error = "bad json"
            return s
        }
        s.updated = root["updated"] as? String ?? ""
        guard let rows = root["days"] as? [[String: Any]] else {
            s.error = "no days"
            return s
        }
        func i(_ d: [String: Any], _ k: String) -> Int {
            if let n = d[k] as? Int { return n }
            if let n = d[k] as? Double { return Int(n) }
            return 0
        }
        s.days = rows.map { r in
            var tc: [String: Int] = [:]
            if let raw = r["toolCounts"] as? [String: Any] {
                for (k, v) in raw {
                    if let n = v as? Int { tc[k] = n } else if let n = v as? Double { tc[k] = Int(n) }
                }
            }
            return Day(
                date: r["date"] as? String ?? "",
                tokens: i(r, "tokens"),
                sessions: i(r, "sessions"),
                costCents: i(r, "costCents"),
                totalTokens: i(r, "totalTokens"),
                cachedInputTokens: i(r, "cachedInputTokens"),
                activeSeconds: i(r, "activeSeconds"),
                toolCounts: tc
            )
        }
        return s
    }
}
