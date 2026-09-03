# Cross-AI template upgrade for Claude Code, Harvi Code, and Copilot

Status: SUPERSEDED (2026-08-26) by
`planning/active/cross-ai-rule-enforcement-harvi-opus_2026-08-26.md`

> Черновик, написанный Harvi Code. Сохранён как **вход** для плана-преемника: часть решений
> взята, часть пересмотрена (разбор — в разделе «Что взято, что отвергнуто» преемника).
> Ключевые расхождения: слой `.ai/` отклонён (ADR-0001), удаление fast-merge отклонено,
> полоса доверия привязана к модели, а не к хосту (ADR-0002). Отдельно: этот черновик
> называет `.github/claude-instructions.md` рабочим Copilot-входом — файл под этим именем
> Copilot не автозагружает.
>
> Не исполнять напрямую.

## Context

The template is designed primarily around Claude Code: `CLAUDE.md` is its always-on
project instruction file; `.claude/commands/`, `.claude/skills/`, `.claude/agents/`,
and the external `~/.claude/.../memory/` directory depend on its native runtime.

Harvi Code automatically recognizes `AGENTS.md` / `AGENTS.local.md`, but does not
natively register Claude commands, execute Claude hooks, or load Claude Code's external
memory. The goal is one coherent project workflow rather than falsely claiming identical
host-runtime capabilities.

## Goal

Upgrade the template so Claude Code, Harvi Code, and GitHub Copilot follow the same
canonical instructions, planning lifecycle, skill methodology, branch discipline, and
project artifacts, while preserving their native adapters.

## Target architecture

```text
Shared project rules and artifacts
├── AGENTS.md                         canonical cross-AI always-on policy
├── CLAUDE.md                         Claude Code entrypoint
├── .github/claude-instructions.md    Copilot entrypoint
├── .ai/                              portable canonical procedures and templates
│   ├── README.md
│   ├── commands/
│   ├── skills/
│   ├── agents/
│   └── memory-seed/
└── platform adapters
    ├── .claude/commands/, agents/, skills/
    └── .github/prompts/, agents/, instructions/
```

`AGENTS.md` is the source of truth for cross-AI policy. `CLAUDE.md` remains because
Claude Code loads it natively. `.github/claude-instructions.md` remains the Copilot
entrypoint. The platform directories preserve native formats and point to the canonical
portable process in `.ai/`.

## Scope and steps

### 1. Establish canonical entrypoints

- [ ] Create root `AGENTS.md` in Russian as the canonical policy for Harvi and all
  cross-AI workflow.
- [ ] Keep `AGENTS.md` concise enough for always-on context and include:
  - sources of truth and session bootstrap;
  - `CONTEXT.md`, ADR, and planning lifecycle discipline;
  - consult-first skill rule;
  - portable command resolution;
  - minimal code changes, validation, secrets, and honest reporting;
  - portable definition of low-noise monitoring without requiring Claude-specific tools;
  - explicit runtime limitations.
- [ ] Convert `CLAUDE.md` into a short Claude Code entrypoint that links to `AGENTS.md`,
  keeps only Claude-native instructions, and does not duplicate the complete policy.
- [ ] Convert `.github/claude-instructions.md` into the equivalent concise Copilot
  entrypoint linked to `AGENTS.md`.

### 2. Introduce the portable `.ai/` layer

- [ ] Create `.ai/README.md` describing canonical artifacts, supported hosts, adapter
  responsibilities, and intentional runtime differences.
- [ ] Create `.ai/commands/` with portable canonical procedures for `plan-new`,
  `plan-status`, `plan-archive`, `review-branches`, and portable portions of
  `bug-intake` / `audit-ui` where applicable.
- [ ] Give portable commands neutral frontmatter: `name`, `description`, `arguments`,
  `portability`.
- [ ] Add `.ai/commands/_TEMPLATE.md` and document that Harvi resolves `/name arguments`
  by reading `.ai/commands/name.md`; it does not register native slash commands.
- [ ] Create `.ai/skills/INDEX.md` and portable copies/adaptations of applicable
  `.claude/skills/<name>/SKILL.md` methodology. Preserve the subagent gate and label
  host-specific behavior rather than presenting it as portable.
- [ ] Create `.ai/agents/README.md`, `_TEMPLATE.md`, and canonical `domain-dev.md` with
  `recommended-model-tier` and `allowed-capabilities`, not vendor-specific model/tool
  lists.
- [ ] Document Harvi's agent adapter: read `.ai/agents/<name>.md`, scope the task, then
  use `new_task` only if the common subagent criteria justify it.

### 3. Preserve and align platform adapters

- [ ] Retain `.claude/commands/`, `.claude/agents/`, and `.claude/skills/` in their
  native formats.
- [ ] Retain `.github/prompts/`, `.github/agents/`, and `.github/instructions/` in their
  native formats.
- [ ] Add a source marker to every adapter identifying the corresponding `.ai/` canonical
  process and describing intentional native differences.
- [ ] Do not add a generator, scripts, or dependencies merely to remove small Markdown
  duplication; document synchronization responsibilities instead.
- [ ] Do not state that Harvi registers Claude commands, executes Claude hooks, accesses
  Claude external memory, or discovers Claude agents automatically.

### 4. Make memory portable and private

- [ ] Move or copy `memory-seed/` to `.ai/memory-seed/` as the canonical portable seed.
- [ ] Keep `memory-seed/` as a compatibility mirror with an explicit source marker.
- [ ] Define `.ai-memory/` as optional local-only portable project memory and add it to
  `.gitignore`.
- [ ] Keep `MEMORY.md` as a lightweight index and one fact per frontmatter-bearing file.
- [ ] Update `docs/MEMORY_GUIDE.md` to distinguish Claude Code's external
  `~/.claude/projects/<derived>/memory/` integration from Harvi-compatible
  `.ai-memory/`.
- [ ] State that only the index is read at bootstrap; detailed memory facts are read only
  when relevant.

### 5. Apply the unified branch and model discipline

- [ ] Make `AGENTS.md` canonical, then align `CLAUDE.md`,
  `.github/claude-instructions.md`, `.github/prompts/ai-branch-workflow.prompt.md`,
  `githooks/pre-commit`, `.claude/commands/review-branches.md`, `README.md`, and `INIT.md`.
- [ ] Preserve a hard rule for every actor: no direct commits to `main` / `master`; no
  commit, merge, push, or deploy without explicit user instruction.
- [ ] Add `harvi/<slug>` to the accepted side-branch prefix list, while using
  `feature/`, `fix/`, or `exp/` for the conservative workflow.
- [ ] Establish the conservative lane for Harvi and every Claude model other than
  Opus 4.8 / Opus 5:
  - work in `feature/`, `fix/`, or `exp/` branches;
  - never self-approve;
  - use plan suffixes `*_harvi_*`, `*_claude_<model-slug>_*`, and `*_copilot_*` as
    applicable;
  - prepare a review handoff with changed files, purpose, risks, manual checks, and a
    ready-to-send review prompt;
  - require review by Claude Code on Opus 4.8 / Opus 5 and explicit user approval before
    merging.
- [ ] If a host cannot verify the active model as Opus 4.8 or Opus 5, require the
  conservative lane.
- [ ] Establish the trusted Claude Code lane exclusively for Opus 4.8 / Opus 5:
  `claude/<slug>` branches, self-review permitted, mandatory reviewer for conservative
  branches, but no commit/merge/push/deploy without explicit user instruction.
- [ ] Remove the current "fast merge without approval" exception because it conflicts
  with the template's safety rules and cross-host workflow.
- [ ] Update `/review-branches` to include `harvi/*` and applicable non-Opus `claude/*`
  branches. It may recommend a model tier but requests a model-switch pause only where
  the host supports switching. Its final report always requires user approval to merge.

### 6. Update initialization and documentation

- [ ] Update `INIT.md` and `README.md` for Claude Code, Harvi Code, Copilot, and mixed
  deployments.
- [ ] Add `AGENTS.md` and `.ai/` to the required template structure.
- [ ] Continue placeholder replacement across portable files and adapters, excluding
  command mechanics and explicit template examples.
- [ ] Ask which hosts are used, but retain unused adapters by default; remove an adapter
  only after explicit user confirmation.
- [ ] Explain that Claude's external memory is Claude-only, whereas optional
  `.ai-memory/` is project-local and Harvi-compatible.
- [ ] Use Windows-compatible command examples where the current guide assumes Unix-only
  commands.

### 7. Resolve inconsistencies repository-wide

- [ ] Search for `CLAUDE.md`, `memory-seed`, `.claude/skills`, `fast-merge`,
  `без ожидания апрува`, `Copilot`, branch prefixes, `main`, and `master`.
- [ ] Update stale references without changing the underlying project conventions.
- [ ] Verify that every claimed path exists, every adapter has a canonical source or
  documented exception, and no document promises unavailable Harvi runtime features.

## Acceptance criteria

- [ ] Harvi automatically receives the cross-AI policy from root `AGENTS.md`.
- [ ] Claude Code continues to receive project instructions through root `CLAUDE.md`.
- [ ] Copilot continues to receive project instructions through
  `.github/claude-instructions.md` and scoped instruction files.
- [ ] Portable commands, skills, agent definitions, and memory seed have a documented
  canonical home in `.ai/`.
- [ ] Native Claude Code and Copilot commands/agents remain usable and explicitly point
  to their shared processes.
- [ ] Harvi command, skill, and agent behavior is described accurately as explicit file
  consultation, not as native registration/discovery.
- [ ] `.ai-memory/` is ignored, documented, and does not expose or depend on Claude Code
  private memory.
- [ ] All models use side branches and need explicit user instruction for commit, merge,
  push, and deployment.
- [ ] Harvi and any Claude model not verifiably Opus 4.8 / Opus 5 follow the same
  conservative review workflow as Copilot / DeepSeek.
- [ ] Only Claude Code running Opus 4.8 / Opus 5 is permitted to provide the mandatory
  trusted review for conservative branches.
- [ ] The hook still blocks direct commits on both `main` and `master`.
- [ ] No unintended placeholder, broken reference, or documentation contradiction remains.

## Risks and decisions

1. **Host-runtime parity is impossible from repository files alone.** Native slash-command
   registration, Claude hooks, and Claude's external memory are platform features. The
   template must distinguish native integration from a shared procedural equivalent.
2. **Duplicate Markdown can drift.** A generator would add needless complexity. Instead,
   use a portable canonical source and clear markers in small platform adapters.
3. **Model identity may not be exposed reliably.** Use a safe capability fallback: unless
   Opus 4.8 / Opus 5 can be confirmed in Claude Code, use the conservative lane.
4. **The existing fast-merge rule is unsafe and contradictory.** Replace it with the
   universal explicit-user-instruction requirement for repository-mutating actions.

## Verification

- [ ] Search all files for unresolved `{{...}}` placeholders; distinguish intended command
  mechanics/templates from accidental leftovers.
- [ ] Confirm every path linked by `AGENTS.md`, `CLAUDE.md`,
  `.github/claude-instructions.md`, `.ai/README.md`, `README.md`, and `INIT.md` exists.
- [ ] Confirm each portable command, skill, and agent has intended Claude/Copilot adapters
  or an explicitly documented platform-specific exception.
- [ ] Confirm `githooks/pre-commit` still rejects commits on `main` and `master` and lists
  `harvi/` as an accepted side-branch prefix in its explanatory text.
- [ ] Run available Markdown/link validation, or explicitly report that none exists.
- [ ] Inspect `git diff` for unintentional broad rewrites.
- [ ] Do not commit, merge, push, delete adapter directories, or delete bootstrap files as
  part of this plan.
