/* main.swift — entry point and headless modes.

   Split out of usagebar.swift because Swift only permits top-level
   statements in a file named main.swift. That was implicit while this
   was a single-file program; adding popover.swift made it an error.
*/
import Cocoa

// ── Entry point ───────────────────────────────────────────────────────
/* Two headless modes, both of which exist because a menu bar app is
   otherwise unverifiable without a window server and Screen Recording
   permission:

     --check   pure-logic self-test of the formatters and the parser
     --title   fetch the REAL endpoint and print exactly what the status
               item and menu would show

   --title is the one that catches integration mistakes: a wrong endpoint,
   a field that isn't actually published, a number that formats to "0"
   because the key name changed. */
if CommandLine.arguments.contains("--title") {
    /* Walk the SAME fallback chain the app uses. This mode used to hand-roll
       a single fetch against one endpoint, which meant it could not observe
       the fallback at all — pointed at a dead local port it reported
       "Could not connect" while the real app would have quietly succeeded
       against production. A diagnostic that doesn't exercise the real code
       path can only produce false alarms. */
    var chain: [String] = []
    if let e = ProcessInfo.processInfo.environment["USAGEBAR_ENDPOINT"], !e.isEmpty { chain.append(e) }
    if let e = UserDefaults.standard.string(forKey: "endpoint"), !e.isEmpty { chain.append(e) }
    chain.append(kDefaultEndpoint)
    var seen = Set<String>()
    chain = chain.filter { seen.insert($0).inserted }

    var out = Snapshot()
    var used: String? = nil

    /* Load the local snapshot first, exactly as refresh() does. Without
       this the mode reports the network result even when the app would
       actually display local data — the same class of blind spot that made
       an earlier version of --title miss the endpoint fallback entirely. */
    var localSnap: Snapshot? = nil
    if let u = App.localSnapshotURL(), let d = try? Data(contentsOf: u) {
        let s = App.parse(d)
        if s.error == nil && s.activeDays > 0 {
            localSnap = s
            print("local snapshot: \(u.path)  ✓ \(s.activeDays) active days, latest \(s.lastActiveDate ?? "?")")
        } else {
            print("local snapshot: \(u.path)  ✗ unusable")
        }
    } else {
        print("local snapshot: (none)")
    }

    for ep in chain {
        guard let url = URL(string: ep) else { print("skip (bad url): \(ep)"); continue }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        let sem = DispatchSemaphore(value: 0)
        var attemptResult = Snapshot()
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { attemptResult.error = err.localizedDescription }
            else if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
                attemptResult.error = "HTTP \(http.statusCode)"
            } else if let data = data { attemptResult = App.parse(data) }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 15)
        if attemptResult.error == nil {
            out = attemptResult; used = ep
            print("endpoint: \(ep)  ✓ latest \(attemptResult.lastActiveDate ?? "?")")
            break
        }
        print("endpoint: \(ep)  ✗ \(attemptResult.error!)")
        out = attemptResult
    }

    // Apply the same freshness rule the app applies.
    if let l = localSnap {
        if used == nil || !App.remoteWins(out, l) {
            out = l
            used = "local snapshot"
            print("→ using LOCAL (fresher than remote, or remote unavailable)")
        } else {
            print("→ using REMOTE (fresher than local)")
        }
    }
    if used == nil { print("error: all \(chain.count) endpoint(s) failed and no local snapshot"); exit(1) }

    if let e = out.error { print("error: \(e)"); exit(1) }
    print("days returned: \(out.days.count), active: \(out.activeDays)")
    print("")
    print("SHORT MODE — one metric in the bar:")
    for m in Metric.allCases {
        print("  \(m.label.padding(toLength: 20, withPad: " ", startingAt: 0)) → \"\(m.value(out))\"")
    }
    let wide = [Metric.todayTokens, .sevenDayTokens, .allTimeCost]
        .map { "\($0.tag) \($0.value(out))" }.joined(separator: " · ")
    print("")
    print("WIDE MODE  → \"\(wide)\"  (\(wide.count) chars, cap \(kLongTitleMaxChars))")
    if wide.count > kLongTitleMaxChars {
        print("             ⚠ over budget, would be truncated")
    }
    print("")
    print("MENU CONTENTS:")
    let t = out.today
    print("  TODAY       tokens \(compact(t?.tokens ?? 0))  cost \(money(t?.costCents ?? 0))  sessions \(t?.sessions ?? 0)")
    print("  7 DAYS      tokens \(compact(out.sum(7) { $0.tokens }))  cost \(money(out.sum(7) { $0.costCents }))")
    print("  ALL TIME    tokens \(compact(out.sumAll { $0.tokens }))  cost \(money(out.sumAll { $0.costCents }))  days \(out.activeDays)")
    let total = out.sumAll { $0.totalTokens }
    if total > 0 {
        let c = out.sumAll { $0.cachedInputTokens }
        print("              from cache \(String(format: "%.0f%%", 100 * Double(c) / Double(total)))")
    }
    let mix = out.toolMix
    if mix.isEmpty {
        print("  TOOL MIX    (absent — endpoint is not publishing toolCounts)")
    } else {
        let s = mix.reduce(0) { $0 + $1.1 }
        print("  TOOL MIX    " + mix.prefix(4).map {
            "\($0.0) \(String(format: "%.0f%%", 100 * Double($0.1) / Double(s)))"
        }.joined(separator: "  "))
        if out.mcpCalls > 0 {
            print("              via MCP \(String(format: "%.0f%%", 100 * Double(out.mcpCalls) / Double(s)))")
        }
    }
    print("  updated     \(out.updated.isEmpty ? "unknown" : out.updated)")
    exit(0)
}

if CommandLine.arguments.contains("--check") {
    var fails = 0
    func expect(_ got: String, _ want: String, _ label: String) {
        if got == want { print("  ok   \(label): \(got)") }
        else { print("  FAIL \(label): got \(got), want \(want)"); fails += 1 }
    }
    /* Endpoint fallback. The menu bar sat on ⚠ for days because it was
       installed pointing at a local preview server that later stopped;
       a dev convenience had become a hard dependency. These lock in that
       a dead first choice always has somewhere to fall through to. */
    print("endpoint chain:")
    let prod = "https://usage.antaresyuan.site/"
    let local = "http://127.0.0.1:8796/api/usage/"
    expect(String(App.buildChain(env: local, pref: nil, fallback: prod).count), "2",
           "local env still keeps production as a fallback")
    expect(App.buildChain(env: local, pref: nil, fallback: prod).last ?? "", prod,
           "production is last resort")
    expect(App.buildChain(env: local, pref: nil, fallback: prod).first ?? "", local,
           "explicit env wins first try")
    expect(String(App.buildChain(env: prod, pref: nil, fallback: prod).count), "1",
           "no duplicate when env equals default")
    expect(String(App.buildChain(env: nil, pref: nil, fallback: prod).count), "1",
           "bare default is a chain of one")
    expect(String(App.buildChain(env: "", pref: "", fallback: prod).count), "1",
           "empty strings are ignored, not queued as endpoints")
    expect(App.buildChain(env: nil, pref: local, fallback: prod).first ?? "", local,
           "stored preference is tried before the default")

    /* Local-vs-remote freshness. kaboo trusts its server and only consults
       its local cache when a field is empty, which is right for a live
       backend. This site's Worker is hand-deployed and was three months
       stale while the local scan had current data, so here the fresher
       document wins. These pin that inversion down. */
    print("local vs remote:")
    func snapWith(_ dates: [String]) -> Snapshot {
        var s = Snapshot()
        s.days = dates.map {
            Day(date: $0, tokens: 100, sessions: 1, costCents: 10,
                totalTokens: 100, cachedInputTokens: 0, activeSeconds: 0,
                toolCounts: [:])
        }
        return s
    }
    let staleRemote = snapWith(["2026-06-01", "2026-06-20"])
    let freshLocal = snapWith(["2026-09-01", "2026-09-04"])
    expect(String(App.remoteWins(staleRemote, freshLocal)), "false",
           "stale production loses to a fresher local scan")
    expect(String(App.remoteWins(freshLocal, staleRemote)), "true",
           "fresher remote beats an older local snapshot")
    expect(String(App.remoteWins(staleRemote, nil)), "true",
           "no local snapshot means remote is used")
    expect(String(App.remoteWins(staleRemote, staleRemote)), "true",
           "on a tie remote wins (it aggregates every device)")
    expect(String(App.remoteWins(snapWith([]), freshLocal)), "false",
           "an empty remote never displaces real local data")

    print("compact():")
    expect(compact(0), "0", "zero")
    expect(compact(999), "999", "sub-thousand")
    expect(compact(1_000), "1.0k", "exact boundary")
    expect(compact(1_500), "1.5k", "thousands")
    expect(compact(15_000), "15k", "ten-thousands")
    expect(compact(999_999), "1000k", "just under a million")
    expect(compact(1_200_000), "1.2M", "millions")
    expect(compact(15_000_000), "15M", "ten-millions")
    expect(compact(2_313_210_948), "2.31B", "billions")
    print("money():")
    expect(money(0), "$0.00", "zero")
    expect(money(499), "$4.99", "cents")
    expect(money(578102), "$5781", "thousands")
    print("hoursText():")
    expect(hoursText(600), "10m", "minutes")
    expect(hoursText(198000), "55h", "hours")

    print("parse():")
    let json = """
    {"days":[{"date":"2026-09-01","tokens":1000,"sessions":2,"costCents":500,
      "totalTokens":4000,"cachedInputTokens":2000,"activeSeconds":3600,
      "toolCounts":{"shell":10,"edit":4,"mcp":2}}],
     "updated":"2026-09-06T00:00:00.000Z"}
    """
    let snap = App.parse(Data(json.utf8))
    if snap.error != nil { print("  FAIL parse errored: \(snap.error!)"); fails += 1 }
    expect("\(snap.days.count)", "1", "one day")
    // 1000 is the first value that takes the k suffix — the boundary is
    // `< 1_000` for the plain form, so 1000 itself formats as 1.0k.
    expect(compact(snap.sumAll { $0.tokens }), "1.0k", "tokens summed")
    expect("\(snap.toolMix.count)", "2", "two tool categories (mcp excluded)")
    expect("\(snap.mcpCalls)", "2", "mcp counted separately")
    expect(snap.toolMix.first?.0 ?? "", "shell", "mix sorted by size")
    // A response with published-but-absent fields must not error.
    let bare = App.parse(Data("{\"days\":[{\"date\":\"2026-09-01\",\"tokens\":5}]}".utf8))
    if bare.error != nil { print("  FAIL bare response errored"); fails += 1 }
    else { print("  ok   bare response parses (missing keys → 0)") }

    print("date header:")
    // The offscreen render caught this one: DateFormatter follows the system
    // locale, so on a Chinese-locale machine the header read "9月 4" inside
    // an otherwise all-English app.
    expect(App.pretty("2026-09-04"), "Sep 4", "en_US_POSIX, not system locale")
    expect(App.pretty("2026-01-31"), "Jan 31", "two-digit day")
    expect(App.pretty("garbage"), "garbage", "unparseable passes through")
    expect("\(App.localToday().count)", "10", "localToday is yyyy-MM-dd")

    print(fails == 0 ? "\nall checks passed" : "\n\(fails) failed")
    exit(fails == 0 ? 0 : 1)
}

/* --where: report placement only, and exit non-zero if the item cannot
   actually be seen. Exists because "running" and "visible" turned out to be
   completely different things: the process was up, registered with the
   window server, had a window and a 46pt width — and was still invisible,
   because a full menu bar on a notched display pushes overflow items left
   of the notch where they aren't drawn. */
if CommandLine.arguments.contains("--where") {
    /* Poll until the placement stops changing. A single delayed read gave
       x = -679 even with nothing else running: the status item is created
       during applicationDidFinishLaunching but macOS parks it off-screen
       until it has been laid out, and a fixed 1.2s sleep raced that. The
       old reading was the diagnostic's bug, not the app's. */
    /* Order matters: setActivationPolicy(.accessory) BEFORE constructing
       App(). The normal launch path does this (see the bottom of the file)
       and gets a visible item; doing it after meant the status item was
       created while the process was still a regular app, and macOS parked
       it off-screen at a negative x. That was this diagnostic lying about
       the app, not the app misbehaving. */
    NSApplication.shared.setActivationPolicy(.accessory)
    let d2 = App()
    NSApplication.shared.delegate = d2

    var tries = 0
    Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { t in
        tries += 1
        guard let b = d2.statusButton, let win = b.window, let scr = NSScreen.main else {
            if tries > 30 { print("✗ no status item window after 12s"); exit(1) }
            return
        }
        let f = win.frame
        /* Wait for a real placement, not just a settled one. The item holds
           a STABLE negative x while macOS is still positioning it, so
           "two identical reads" declared victory during the parked phase
           and reported a false off-screen. Only a non-negative x means the
           item has actually been laid out on the bar. */
        if f.origin.x < 0 && tries <= 30 { return }
        t.invalidate()

        print("item at x \(Int(f.origin.x))–\(Int(f.maxX)), width \(Int(f.width))pt")
        var visible = true
        if #available(macOS 12.0, *), let aux = scr.auxiliaryTopLeftArea {
            print("notch: left strip is \(Int(aux.width))pt of \(Int(scr.frame.width))pt")
            if f.origin.x < 0 {
                print("✗ off-screen — not placed on the bar")
                visible = false
            } else if f.origin.x < aux.width {
                print("✗ HIDDEN — overflowed left of the notch; the bar is full")
                visible = false
            } else {
                print("✓ visible, right of the notch")
            }
        } else {
            print(f.origin.x >= 0 ? "✓ visible" : "✗ off-screen")
            visible = f.origin.x >= 0
        }
        exit(visible ? 0 : 1)
    }
    NSApplication.shared.run()
}

/* --popover <path>: fetch real data, render the WebView popover, and write
   it to a PNG. Same rationale as --shot for the menu: without Screen
   Recording permission this is the only way to actually look at the UI. */
if let idx = CommandLine.arguments.firstIndex(of: "--popover") {
    let out = CommandLine.arguments.count > idx + 1
        ? CommandLine.arguments[idx + 1] : "/tmp/popover.png"
    let ep = ProcessInfo.processInfo.environment["USAGEBAR_ENDPOINT"]
        ?? UserDefaults.standard.string(forKey: "endpoint")
        ?? kDefaultEndpoint
    print("endpoint: \(ep)")

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    // A real status item, so the popover anchors exactly as it will in use.
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.title = "0"
    let pop = Popover(statusItem: item)

    /* Pick the same document the app would display: local snapshot if it is
       fresher, otherwise the endpoint. This mode previously fetched the
       endpoint unconditionally, so it rendered stale production data while
       the running app was showing the local scan — the third diagnostic in
       this file to quietly bypass the real code path. */
    var chosen: String? = nil
    var localSnap: Snapshot? = nil
    if let u = App.localSnapshotURL(), let d = try? Data(contentsOf: u) {
        let s = App.parse(d)
        if s.error == nil && s.activeDays > 0 {
            localSnap = s
            chosen = String(data: d, encoding: .utf8)
            print("local snapshot: \(u.path)  ✓ latest \(s.lastActiveDate ?? "?")")
        }
    }

    guard let url = URL(string: ep) else { print("bad endpoint"); exit(1) }
    URLSession.shared.dataTask(with: url) { data, resp, err in
        var remoteBody: String? = nil
        var remoteSnap: Snapshot? = nil
        if err == nil, let http = resp as? HTTPURLResponse, http.statusCode == 200,
           let d = data, let s = String(data: d, encoding: .utf8) {
            let parsed = App.parse(d)
            if parsed.error == nil { remoteBody = s; remoteSnap = parsed }
        }
        if let rs = remoteSnap, App.remoteWins(rs, localSnap) {
            chosen = remoteBody
            print("→ rendering REMOTE (latest \(rs.lastActiveDate ?? "?"))")
        } else if localSnap != nil {
            print("→ rendering LOCAL (fresher, or remote unavailable)")
        }
        guard let body = chosen else {
            print("no data available from either source"); exit(1)
        }
        DispatchQueue.main.async {
            pop.push(body)
            /* Run the REAL station probe and wait for it before snapping.
               An earlier version snapped immediately, so every rendered
               PNG showed the workstation block frozen on "checking…" —
               i.e. the one part of the UI this mode exists to inspect was
               the one part it could never show. Diagnostic modes that skip
               the real path have already cost this project three false
               bug reports, so this one runs the same script the app does. */
            let probe = Process()
            /* Resolve from the executable, not the CWD. Using
               currentDirectoryPath meant running this from anywhere other
               than ops/menubar silently skipped the probe and rendered a
               PNG with the workstation block missing — the failure looked
               like "the feature is broken" rather than "you cd'd first". */
            let exeDir = URL(fileURLWithPath: CommandLine.arguments[0])
                .resolvingSymlinksInPath().deletingLastPathComponent()
            // …/usagebar.app/Contents/MacOS → walk out of the bundle.
            var base = exeDir
            if base.path.contains(".app/Contents/MacOS") {
                base = base.deletingLastPathComponent()
                    .deletingLastPathComponent().deletingLastPathComponent()
            }
            let root = base.path
            var node: String? = nil
            for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
            where FileManager.default.isExecutableFile(atPath: c) { node = c; break }
            if node == nil {
                let nvm = NSHomeDirectory() + "/.nvm/versions/node"
                if let vs = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
                    for v in vs.sorted(by: { $0.compare($1, options: .numeric) == .orderedAscending }).reversed() {
                        let cand = "\(nvm)/\(v)/bin/node"
                        if FileManager.default.isExecutableFile(atPath: cand) { node = cand; break }
                    }
                }
            }
            let script = root + "/station.js"
            guard let n = node, FileManager.default.fileExists(atPath: script) else {
                // Render the ERROR state rather than leaving the block on
                // "checking…" — otherwise this mode cannot show the very
                // failure a reader would be using it to diagnose.
                print("station: node or script missing at \(root)")
                pop.stationFailed("probe missing at \(root)")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    pop.snapshot(to: out) { ok in exit(ok ? 0 : 1) }
                }
                return
            }
            probe.executableURL = URL(fileURLWithPath: n)
            probe.arguments = [script]
            probe.currentDirectoryURL = URL(fileURLWithPath: root)
            let pipe = Pipe()
            probe.standardOutput = pipe
            probe.standardError = Pipe()
            DispatchQueue.global().async {
                do { try probe.run() } catch {
                    DispatchQueue.main.async {
                        print("station: failed to run")
                        pop.stationFailed("probe failed to launch")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            pop.snapshot(to: out) { ok in exit(ok ? 0 : 1) }
                        }
                    }
                    return
                }
                let d = pipe.fileHandleForReading.readDataToEndOfFile()
                probe.waitUntilExit()
                let body = String(data: d, encoding: .utf8) ?? ""
                DispatchQueue.main.async {
                    if probe.terminationStatus == 0 && !body.isEmpty {
                        print("station: ok (\(body.count) bytes)")
                        pop.pushStation(body)
                    } else {
                        print("station: probe exited \(probe.terminationStatus)")
                        pop.stationFailed("probe exited \(probe.terminationStatus)")
                    }
                    // Let the re-render settle before capturing.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        pop.snapshot(to: out) { ok in exit(ok ? 0 : 1) }
                    }
                }
            }
        }
    }.resume()
    app.run()
}

let app = NSApplication.shared
// .accessory = menu bar only, no Dock icon, no menu bar menus of its own.
app.setActivationPolicy(.accessory)
let delegate = App()
app.delegate = delegate

/* --shot <path>: run the real app, let it fetch, render itself to a PNG,
   then quit. This exists because Screen Recording permission is not
   available here, so the only way to actually LOOK at the status item and
   menu is to have the app draw them. */
if let idx = CommandLine.arguments.firstIndex(of: "--shot") {
    let out = CommandLine.arguments.count > idx + 1
        ? CommandLine.arguments[idx + 1] : "/tmp/usagebar.png"
    // 3s is comfortably past the fetch; the render must happen after the
    // network round-trip or it captures the "…" placeholder.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
        delegate.renderPreview(to: out)
        app.terminate(nil)
    }
}

app.run()
