# Launch questions — UI audit

Ask **only** the questions whose answer changes what the run does; for the rest, take the obvious
default and state it. Use one `AskUserQuestion` batch (2–4 questions). Suggested set:

| # | Question | Options (first = default/recommended) | Why it matters |
| --- | --- | --- | --- |
| Scope | Which screens to audit? | **All screens (full crawl)** · Named screen(s) only | Bounds crawl time and output. |
| Environment | Drive against what? | **Demo mode (mock backend)** · Real backend (live) | Demo = deterministic/offline; real = needs creds/network, non-repeatable. |
| Depth | Combinatorial depth on parametric screens (type×period×format…)? | **Representative sampling** · Exhaustive | Exhaustive explodes screenshots; sampling covers the shapes. |
| Capture | What to screenshot? | **Every state (each click)** · Key states only | Fidelity vs volume of shots for the vision pass. |

Extra questions to raise only if relevant:
- **Template mirror push** — if the skill/command are mirrored into a shared template repo, pushing
  is an outward action → confirm before pushing (never push a private repo unprompted).
- **Real-backend safety** — if "real backend" is chosen, confirm it won't mutate production data.

Defaults if the user says "just run it": all screens · demo mode · representative sampling · every
state. State these back in one line, then proceed.
