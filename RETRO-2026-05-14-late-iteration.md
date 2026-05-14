# Retrospective — /devloop late-iteration tail · 2026-05-14

**Run**: `usage-loop-20260513` (continuation)
**Working directory**: `/Users/antaresyuan/Downloads/personal_website`
**PRs analyzed**: 12 follow-ups (`#157` through `#168`) merged after the formal queue-exhausted marker at `2026-05-13T21:31Z`
**Friction events added**: 12 (from 5 → 17 in `LOOP-FRICTION.jsonl`)
**Headline**: Several friction classes crossed the threshold-3 line in this single tail — they should have triggered SKILL.md PR proposals already, but `/iterate`'s rigid invocation at queue-exhaustion missed them.

---

## A. Why the previous RETRO missed this

The /devloop skill auto-invokes /iterate **at queue exhaustion** (§5 in SKILL.md). At that moment the loop had merged #154/#155/#156 and the friction log had 5 events. /iterate ran, wrote `RETRO-2026-05-13.md`, marked the run "complete."

Then the user kept asking for changes — visual polish, metric correctness, device setup, etc. — and the same session shipped **12 more PRs** in the next 8 hours. None of those friction events were logged (no one was writing to `LOOP-FRICTION.jsonl`), and /iterate was never re-invoked, so the learning was lost.

**This is a structural bug in the /devloop ↔ /iterate handshake.** Real projects have post-merge iteration tails; /iterate needs to either auto-re-trigger when the log grows past the last analyzed point, or expose a manual re-run that pulls in newly-added events.

## B. Friction this run — classes that crossed threshold

(Counts include the 12 retroactively-added events. Threshold is 3 cumulative.)

### 🔴 `viz_visual_weight::iterative_revision` — count 4 — **CROSSED THRESHOLD**

Cell size revised across PR #162 → #163 → #165 → #167. Each time I picked a number and shipped; user pushed back; cycle repeated. Could have been **one** round with 2-3 ASCII mockups + AskUserQuestion at the start.

**Proposed SKILL.md diff** (for /devloop §2 step 3 "Implement in small steps"):

```diff
+ **Visual decisions where "right size" is taste-dependent** (cell sizes,
+ font sizes, padding, layout density): don't ship blind. Show 2-3 sized
+ mockups (ASCII art, annotated SVG, or named ranges like "tight/balanced/
+ generous") via AskUserQuestion and let the operator pick. Resist "I have
+ good intuition" — the operator's eye knows their site's vibe better.
+ Iterating 3+ PRs to converge on taste is a smell that you skipped this
+ step.
```

### 🟡 `metric_correctness::sanity_smell_test` — count 2 — one more occurrence and PR

PR #157 shipped 3.6B tokens/14d (off by ~100×, cache_read inflation). PR #158 shipped 63M (off by ~5×, cache_creation inflation). Both visible to user in one screen-grab; both should have triggered "this can't be right for a human" before merging.

**Proposed SKILL.md diff** (for /devloop §2 step 4 "Build & test hard"):

```diff
+ **User-visible aggregates: sanity-grep before shipping.** For any number
+ that lands on a public surface (dashboard totals, count stats, headline
+ KPIs), mentally check it against intuition. "A human cannot reasonably
+ hit X in a Y window" is a real review gate. If the user has shown a
+ reference tool (screenshot, third-party CLI output) in the same session,
+ grep back for it and compare — that's your calibration anchor.
```

### 🟡 `setup_collision::source_label_overlap` + `::stale_keychain_after_worker_rotate` — combined count 2

`setup-sync.sh` accepts any source label without checking the Worker's existing slots. Then on secret rotation, it keeps the old keychain entry silently. Two distinct ops bugs same area — both surfaced by operator.

Not strictly /devloop's responsibility (operator-side setup script lives in the user's repo, not in the skill), but a related lesson:

```diff
+ **Operator-facing setup scripts you write should validate against live
+ state.** A setup script that takes a label / name / ID input should
+ check it doesn't collide with what's already deployed. A setup script
+ that uses a stored credential should test the credential in its
+ dry-run step and surface auth failures before installing.
```

### 🟢 Other patterns, each count 1 this run (under threshold but worth noting)

- `dom_lifecycle::innerhtml_wipes_appended_children` (PR #160): sub-agent (read-only) can't catch dynamic lifecycle bugs. Self-review needs an explicit checklist item for "anything appended to a container that gets innerHTML'd?"
- `pacing_mismatch::frontend_polling_vs_data_cadence` (PR #159): refetch interval should match data-update frequency, not "feels live" UX.
- `viz_semantic_ambiguity::missing_vs_zero` (PR #161): distinct semantic categories ("no data" vs "real zero") need distinct visual encoding.
- `viz_motion::pulse_without_purpose` (PR #166): default to no motion; add only when it conveys a specific signal.
- `agent_assumption_error::device_identity_from_hostname` (mbp/iMac confusion): don't infer device type from hostname; ask once and pin to session memory.

## C. Quality observations

**Sub-agent review didn't catch the bulk of these.** The independent code-review sub-agent (§2.9) reads files with Read/Grep/Glob — it sees static structure, not runtime behavior. Bugs it missed:
- Tooltip lifecycle (PR #160) — needs runtime tracing
- Metric magnitude wrong (PR #157, #158) — needs comparison to external reference
- Pulse-dot annoyance (PR #166) — needs visual judgment
- Layout imbalance (PR #162) — needs visual judgment

These are bugs in the **author's** self-review, not the sub-agent's. /devloop §2 step 5 ("Self-review the diff") needs more teeth for the visual/UX-judgment + metric-correctness dimensions where sub-agent is blind.

## D. Pacing

Not relevant for this tail — the entire run was interactive (operator awake), so ScheduleWakeup defaults were never exercised.

## E. Cross-cutting lessons (one-liners worth promoting to /devloop SKILL.md "common pitfalls")

- E1. For visual sizing decisions, show 2-3 mockups + AskUserQuestion BEFORE shipping the first version.
- E2. For user-visible aggregate metrics, sanity-check against intuition + any reference tools the user mentioned this session.
- E3. Any container that gets `el.innerHTML = ...` from a refetch loop will wipe everything appended to it — audit before assuming the tooltip / overlay / observer survives.
- E4. Match refetch / poll cadence to the data-update cadence (not "feels live" UX defaults).
- E5. Distinct semantic categories need distinct visual encoding ("no data" ≠ "zero"; "future" ≠ "past empty").
- E6. Default to NO motion. Add only when motion conveys a specific signal.
- E7. Don't infer device type from hostname; ask once + pin to working memory.

## F. PR-eligible diffs summary

| Friction class | This tail | Cumulative | Threshold | PR action |
|---|---:|---:|---:|---|
| `viz_visual_weight::iterative_revision` | 4 | 4 | 3 | **PR to claude-devloop**: §2 step 3 diff |
| `metric_correctness::sanity_smell_test` | 2 | 2 | 3 | wait 1 more — but lesson E2 worth promoting now to common-pitfalls |
| `setup_collision::*` | 2 | 2 | 3 | not directly /devloop; lives in project's own setup-sync.sh |
| `iterate_invocation::late_iteration_blind_spot` | 1 | 1 | 3 | **PR to claude-skill-iterate**: re-run support for post-handoff events |

## G. Anti-pattern check

Reviewed all proposed diffs:
- None remove/weaken deny entries or safety rules ✓
- None bypass hooks / force push / skip verification ✓
- None alter `safety_intentional` handling ✓
- E2 (metric sanity check) and E3 (innerHTML lifecycle) are additive guidance, not weakening of any existing review pass ✓

PASS — none `BLOCKED_BY_ANTI_PATTERN`.

## H. What I'd do differently next time

If the user invoked /devloop with the same 3 issues today, knowing what I know now:

1. **For #152 (frontend)**: AskUserQuestion up front with 2-3 ASCII mockups for cell size + layout. Would have collapsed PR #162/#163/#165/#167 into one round.
2. **For #150 (sync agent)**: After computing the dry-run total, print it alongside "for reference, a typical Claude Code user shows X tokens/month on ccusage" — calibration anchor inline.
3. **For #151 (Worker)**: Single-line note in `wrangler.toml` template: "Don't use *.workers.dev for CN-reachable surfaces; bind a same-zone custom domain." Already there, but I'd have it earlier in deploy flow.
4. **For the device-setup tail**: Don't trust the example config's `source: "claude-mbp"` default — make it explicit per-machine. Validate label uniqueness via a Worker LIST endpoint before installing.

## I. Action items

| What | Where |
|---|---|
| **Append friction events** to LOOP-FRICTION.jsonl | ✅ done — 12 events added |
| **Write this retro** | ✅ this file |
| Update `.iteration-state.json` accumulators | pending — see §F counts |
| **Open PR to claude-devloop** with §F's diff for `viz_visual_weight::iterative_revision` (the cleared threshold) | pending — needs operator approval |
| **Open issue on claude-skill-iterate** about late-iteration blind spot | pending — needs operator approval |
| Consider hardening `ops/setup-sync.sh` with label-collision detection | personal_website repo, separate task |
