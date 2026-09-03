---
name: systematic-debugging
description: Use when something is broken, flaky, hanging, crashing, or producing wrong output and the cause isn't obvious — to find the root cause from evidence (logs, repro, reads) instead of guessing and patching symptoms.
---

# Systematic Debugging

## Overview

Guess-and-patch debugging fixes symptoms, multiplies edits, and often breaks something else.
Working from evidence to root cause fixes the bug once, in one place.

## When to Use (and When Not)

**Use when:**
- A failure's cause is not immediately obvious from a single glance.
- Behavior is intermittent, timing-dependent, or environment-specific.

**Don't use when:**
- The cause is already proven and the fix is mechanical.

## Process (Reproduce → Locate → Understand → Fix → Verify)

1. **Reproduce.** Get a reliable repro (a failing test, a command, exact steps). No repro →
   gather more evidence first; don't fix blind.
2. **Read the evidence.** Inspect журнал службы (`journalctl -u cutout-runner`; локально — stdout процесса) (filtered: `tail -N | grep -vE
   '<noise>'`), stack traces, dumps. Note the *first* anomaly, not the last symptom.
3. **Locate.** Read the *full* implicated function/module (Read, not a grep snippet) before
   theorizing. Narrow with bisection (recent diff? minimal input that still fails?).
4. **Understand the root cause.** State, in one sentence, *why* it happens. If you can't, you
   haven't found it — keep going.
5. **Fix minimally.** One root cause = one change in one place. Don't refactor "while here".
6. **Verify** the repro now passes and nothing adjacent regressed (`test-driven-development`:
   the repro becomes a permanent test).

## Common Mistakes

- ❌ Patching the symptom that's easiest to see → ✅ trace to the first cause.
- ❌ Multiple speculative edits at once → ✅ one hypothesis, one test, repeat.
- ❌ Theorizing from a grep snippet → ✅ read the whole affected code first.
- ❌ Declaring it fixed without re-running the repro → ✅ verify.

## Cross-references

- SUB-SKILL: test-driven-development, verification-before-completion
- For long runs, follow the host adapter's monitoring section (`CLAUDE.md`) —
  `ScheduleWakeup`, not `Monitor`. This project has no long pipelines: the slowest
  operation is a 12–24 s inference.
