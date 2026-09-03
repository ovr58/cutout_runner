---
name: plan-archive
description: "Перевести выполненный план в DONE и перенести в planning/archive/plans/, обновив INDEX"
---

# Архивировать выполненный план

Slug плана (файл в planning/active/): {{planSlug}}

Тонкая команда — БЕЗ субагентов. Перемещение + правка markdown.

## Шаги

1. Открыть `planning/active/{{planSlug}}.md`. В шапке заменить `Status: ACTIVE …` на
   `Status: DONE (выполнено <YYYY-MM-DD — сегодня>)` и дописать в конец короткий блок
   `## Что реально сделано` (3–6 строк по факту).

2. Переместить файл: `planning/active/{{planSlug}}.md` → `planning/archive/plans/{{planSlug}}.md`
   (если репозиторий под git — `git mv`; иначе обычный move).

3. В `planning/INDEX.md`: удалить строку плана из таблицы `## active/` и добавить её в
   `## archive/plans/` со статусом `ARCHIVED`.

4. Не удалять файл (archive-never-delete). Сообщить новый путь.

> Lifecycle: ACTIVE → DONE → ARCHIVED. Обновление INDEX — обязательная часть того же изменения.
