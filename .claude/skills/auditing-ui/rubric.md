# Rubric — UI adequacy (scoring detail)

Score every captured state **1–5** on each axis. 5 = flawless, 3 = usable with issues, 1 = broken.
A finding is anything scoring ≤3 (or any hard defect regardless of score).

## Axes

### 1. Readability
- Text legible at rendered size; sufficient contrast against background.
- No text clipped by its container; no overlap of glyphs; no placeholder/lorem left in.
- Numbers/labels formatted (not raw timestamps, not `1.0000000001`).

### 2. Coherence / integrity
- Composition whole: nothing cut off at any edge (esp. right edge / bottom).
- No overlapping panels; consistent margins/padding; aligned columns.
- No orphaned or floating blocks; empty-states are intentional, not "looks broken".

### 3. Reachability
- Every interactive control visible and reachable without off-screen scroll surprises.
- Nothing occluded by a stuck popup/overlay; primary action is discoverable.
- Focus/tab order sensible; disabled states are correct (not everything greyed).

### 4. Adequacy to purpose
- The screen shows the data it exists to show, and it is meaningful (not empty/garbage).
- After an action, the state reflects the result (submit → response appears; load → list fills;
  clear → list empties with an empty-state, not a crash).
- Global/header status is correct for the current app state.
- Cross-function: along golden paths, one screen's output correctly feeds the next.

## Severity for findings

- **high** — screen fails its purpose, data wrong/absent, control unreachable, content clipped so a
  function is unusable, or accessibility name is a raw object dump / misleading.
- **medium** — usable but degraded: minor clipping, weak contrast, inconsistent spacing, confusing
  empty-state, cosmetic-but-noticeable.
- **low** — polish: alignment nits, wording, placeholder art (e.g. demo placeholder frame).

## Accessibility-name defects (from `crawl.json`, not the image)
Flag controls whose exposed `Name` is: a raw object/`ToString()` dump; a concatenation of
label+min+max or other garbled text; empty/`"?"` on a meaningful control; or duplicated across
unrelated controls. These break screen readers and automation even when the pixels look fine.
