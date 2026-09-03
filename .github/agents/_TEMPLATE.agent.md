---
name: <agent-name>
description: "<когда использовать этого агента — по описанию его выбирают>"
tools:
  - read_file
  - replace_string_in_file
  - grep_search
  - run_in_terminal
  - get_errors
---

# <Название агента>

<Роль и экспертиза одним абзацем.>

## Your Context
- <ключевые файлы/модули области>

## Workflow
1. <по шагам>

## Rules
- <границы, что нельзя>

<!--
Copilot agent: вызывается через @<name> в Copilot Chat. tools — список Copilot-инструментов
(read_file, replace_string_in_file, multi_replace_string_in_file, grep_search,
semantic_search, run_in_terminal, get_errors, …).
-->
