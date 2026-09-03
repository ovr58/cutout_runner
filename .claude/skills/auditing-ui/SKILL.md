---
name: auditing-ui
description: Use when asked to audit a GUI end-to-end — map every screen/control, click through it, screenshot each state, and judge not just "does the button work" but "does each function serve its purpose and interact correctly with others". Produces ranked findings that seed a fix plan. Stack-agnostic (reference impl = WinUI/FlaUI); web/other via a new IUiDriver.
---

# Auditing a UI (transition-tree → crawl → vision → adequacy → findings)

## Overview

A "green" click-through (every button invokes, every screenshot saves) proves almost nothing:
the screenshots can show the wrong window, a control can fire yet display garbage, a screen can
"work" yet fail its purpose. This skill audits a UI for **adequacy**, not liveness — every state
is screenshotted and reviewed by a **vision model** against a rubric, then cross-checked
semantically against what each screen is *for*. Output is a ranked findings list that becomes the
tasks of a fix plan (backlog entry or `/plan-new`).

The pipeline is five stages behind one stack-agnostic seam (`IUiDriver`), so the same crawler,
rubric, and evaluator serve WinUI today and web/mobile later by swapping only the driver.

## When to Use (and When Not)

**Use when:**
- Asked to "collect the whole UI transition tree / all buttons and functions, click through, and
  rate adequacy in the context of the app's goals" — or to produce fix-plan tasks from a UI sweep.
- You need a repeatable, reviewable UI audit (not a one-off manual poke).

**Don't use when:**
- You need a single-screen visual check → just screenshot + read it inline.
- There's no way to drive the UI headlessly/deterministically and no demo seam → build the demo
  seam first (see step 1) or fall back to manual on-target review.

## Process

1. **Deterministic environment (demo mode).** Real backends make the UI non-deterministic and
   gate it behind network/creds. Require a demo switch (`{{DEMO_ENV}}`, e.g. `ARGUS_UI_DEMO=1`)
   that swaps every backend boundary (client/metrics/supervisor) for **fakes with fixed sample
   data** via DI. Precondition: all backend calls already sit behind interfaces. Verify every
   screen renders offline before crawling.
2. **Interactive config at launch (ask, don't assume).** Before a run, ask the user a short set
   of questions (see `questions.md`) and only the ones that matter for this run: scope (all
   screens vs named), environment (demo vs real backend), combinatorial depth on parametric
   screens, what to screenshot, and whether to push template mirrors. Skip questions with an
   obvious default; state the default you took.
3. **Static transition tree.** From markup + view-models, map screen → control → command →
   backend-call → effect, plus the nav graph and named golden paths. This is the coverage oracle
   for stage 4 (what the crawl should reach) and the source of per-screen *purpose* for stage 5.
   Write it to `{{AUDIT_DIR}}/ui-transition-tree.md`.
4. **Runtime crawl behind `IUiDriver`.** Launch demo UI, walk the nav graph, run golden actions
   (fill a field then submit, sample a combo's types), click safe controls, and **screenshot
   every state**. Emit `crawl.json` (states, controls, actions, coverage-vs-tree) + `screens/*.png`.
   The crawler only sees `IUiDriver` — never the app's own assembly.
5. **Vision review (batch, one cheap fan-out).** Spawn **one** vision subagent (model `sonnet`)
   over **all** screenshots at once — never one-per-shot. Give it the rubric (below), the
   per-screen purpose, and the action that produced each shot. It returns per-screen scores and
   ranked findings tied to screenshot files. This stage catches what a green run cannot (wrong
   window, clipped edges, broken empty-states, missing data).
6. **Semantic adequacy sweep (you).** For each function: does it call the *correct* backend path?
   does the result reflect the screen's purpose? does it interact correctly with neighbours along
   the golden paths (e.g. start source → dashboard fills → history lists → report numbers match)?
   Also mine `crawl.json`'s accessibility names for defects (raw object dumps, garbled/duplicate
   labels, unnamed controls).
7. **Findings → fix plan.** Merge vision + semantic + accessibility findings, rank by severity,
   dedupe. Land them as a `planning/BACKLOG.md` entry with a ready `/plan-new` prompt (default) or
   a new `planning/active/` plan — this is the deliverable, not the crawl.

## The rubric (score every state 1–5 on each axis)

- **Readability** — text legible, contrast sufficient, nothing blends into background.
- **Coherence/integrity** — composition whole; nothing clipped at edges, no overlap, consistent
  spacing, no orphaned/floating blocks.
- **Reachability** — every interactive element visible and reachable; nothing occluded or off-screen;
  sensible focus/tab order.
- **Adequacy to purpose** — the screen visually does its job: the data it should show is present and
  meaningful; post-click state reflects the action's result; global status (header) is correct.

## The `IUiDriver` seam (portability)

Keep the crawler/evaluator stack-agnostic; put stack-specifics only in the driver:
`Launch / Close / Settle / Screenshot / Enumerate → UiControl[] / Invoke / SetText / SelectItem`.
`UiControl` is `(Id, Kind, Name, AutomationId, Enabled)` — no framework types leak out. A web audit
adds a Playwright/CDP driver behind the same interface; the graph, rubric, and vision stage are
reused unchanged. Reference implementation: WinUI via FlaUI/UIA3 (see `{{DRIVER_REF}}`).

## Common Mistakes

- ❌ Trusting a green crawl (all clicks fired, all files saved). → ✅ A run is worthless until the
  screenshots are vision-reviewed — that is the whole point of this skill.
- ❌ Screenshotting a region while the target window is occluded/minimized → the shot captures
  whatever's on top (e.g. the IDE). → ✅ Foreground + maximize (or equivalent) immediately before
  **every** capture.
- ❌ Capturing on a HiDPI display from a process that isn't per-monitor-DPI-aware → the driver reads
  the window rect in *logical* pixels but the screen grab is *physical*, so only the top-left ~40% of
  each window is captured (the rest silently clipped — and vision then false-flags "clipped at edge").
  → ✅ Make the **capture process** per-monitor-DPI-aware **before** it opens any window
  (WinUI/FlaUI: `PerMonitorV2` in the tool's `app.manifest`). Gotcha: a .NET apphost's manifest lives
  in the `.exe`, so **run the built `.exe`, not `dotnet <tool>.dll`** — the latter inherits
  `dotnet.exe`'s (System-aware) DPI mode and the manifest never applies. Sanity-check the first shot's
  pixel size ≈ the monitor's physical resolution. Better: have the crawler **self-check** its own DPI
  context at startup (WinAPI `GetThreadDpiAwarenessContext`) and loudly warn if it isn't PerMonitorV2 —
  the reference harness (`tools/ui-audit/DpiDiagnostics.cs`) does this and records `dpi` (context +
  monitor topology) and `frameCheck` (captured frame vs window bounds) in `crawl.json`, so the clip is
  caught automatically, not by eyeballing sizes.
- ❌ Auto-clicking chrome/native dialogs (titlebar restore/close, file pickers) → they wreck window
  state or block. → ✅ Deny them by stable id (AutomationId), not by localized name.
- ❌ Leaving a combo/menu popup open → it overlays and blocks later nav clicks. → ✅ Collapse after
  selecting; order parametric screens last.
- ❌ One vision subagent per screenshot → ✅ one batch fan-out over all shots (cost-discipline).
- ❌ Stopping at "it works" → ✅ judge purpose + cross-function interaction (golden paths).

## Cross-references

- REQUIRED BACKGROUND: dispatching-parallel-agents, cost-discipline (`docs/WORKING_RULES.md` §2)
  — the vision stage is a single justified Sonnet fan-out, not per-shot spawns.
- SUB-SKILL: writing-plans (land findings as BACKLOG entry / `/plan-new`)
- Reference files next to this skill: `questions.md` (launch protocol), `rubric.md` (scoring detail).
