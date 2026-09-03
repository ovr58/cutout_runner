---
name: plan-new
description: "Завести новый план жизненного цикла в planning/active/ и зарегистрировать в INDEX"
---

# Новый план (lifecycle)

Заголовок плана: {{planTitle}}
Краткая цель: {{planGoal}}

Тонкая команда — БЕЗ субагентов и без свежих контекстов (токен-гигиена). Только правка markdown.

## Шаги

1. Сгенерировать slug из `{{planTitle}}` (kebab-case, латиница/транслит) + дата:
   `<slug>_<YYYY-MM-DD>`.

2. Создать `planning/active/<slug>_<YYYY-MM-DD>.md` с шапкой:

   ```markdown
   # {{planTitle}}

   Status: ACTIVE (с <YYYY-MM-DD — сегодня>)

   ## Context
   <зачем этот план: проблема/потребность, ожидаемый исход>

   ## Цель
   {{planGoal}}

   ## Шаги
   - [ ] …

   ## Verification
   - …
   ```

3. Добавить ОДНУ строку в таблицу `## active/` файла `planning/INDEX.md`:
   `| <slug>_<YYYY-MM-DD>.md | {{planGoal}} | ACTIVE |`

4. Не запускать долгие процессы и не спавнить агентов. Сообщить путь созданного файла.

> Lifecycle: Draft (`~/.claude/plans/`) → ACTIVE (`planning/active/`) → DONE → ARCHIVED
> (`planning/archive/plans/`). См. раздел «Навигация по planning/» в `CLAUDE.md`.
