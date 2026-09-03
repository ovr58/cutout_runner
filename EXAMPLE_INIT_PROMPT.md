# Пример инициализации — заполнено по проекту-донору

Это **живой пример** того, как выглядит запускающая фраза с заполненными `X / Y / Z`.
Здесь подставлены реальные значения проекта-донора (GetCourse-парсер), из которого вырос
шаблон. Используй его как образец: скопируй, поменяй на свои значения.

---

## Готовая фраза (скопировать и отредактировать под свой проект)

> Подними этот проект из шаблона `d:\3DWork\конспект3DClub\transcribing\claude-project-template\`.
> Скопируй структуру в корень, замени плейсхолдеры.
> Проект называется **GetCourse Parser** (десктоп-приложение для парсинга и транскрибации
> видео-уроков с платформы GetCourse).
> Стек — **Python 3.11, PySide6 (Qt GUI), PostgreSQL + pgvector, модифицированный scrapling
> (anti-detection scraping), STT-движки + AI-провайдеры (Gemini), Alembic-миграции, Inno Setup
> для сборки инсталлятора Viewer'а**.
> Архитектура — **строгое разделение `app/` (UI: PySide6-виджеты, диалоги, main_window —
> только отображение и Qt-сигналы, без бизнес-логики) и `core/` (бизнес-логика: pipeline со
> стадиями-оркестратором `core/pipeline/stages/*`, scraping в `core/scraping/`, доступ к БД
> только через репозитории `core/db/repositories/` с `%s`-плейсхолдерами, транскрибация,
> экспорт). Точка входа — `getcourse_app/main.py`. Длительные прогоны (пайплайн, сборка
> инсталлятора) логируются в `logs/`, мониторятся через ScheduleWakeup + tail+grep**.
> Долгую память поставь по `docs/MEMORY_GUIDE.md`.

---

## Как это разворачивается в плейсхолдеры

| Плейсхолдер | Значение для проекта-донора |
| --- | --- |
| `{{PROJECT_NAME}}` | GetCourse Parser |
| `{{STACK}}` | Python 3.11 · PySide6 (Qt) · PostgreSQL + pgvector · scrapling (модиф.) · STT + Gemini · Alembic · Inno Setup |
| `{{ARCH_OVERVIEW}}` | `app/` (UI, без логики) ↔ `core/` (pipeline-стадии, scraping, репозитории БД, транскрибация, экспорт); вход — `getcourse_app/main.py` |
| `{{LANGUAGE}}` | python (`applyTo: "**/*.py"`) |
| `{{PRIMARY_LOG_PATH}}` | `logs/tail.log` |
| `{{LOG_NOISE_FILTER_REGEX}}` | `nav_filter.*reprocess_link_ids|_log_cookies|sample names|by domain` |
| `{{PIPELINE_STAGES}}` | stage_nav · stage_lessons · stage_transcription · (embedding/export) |
| `{{RUN_COMMAND}}` | запуск из `getcourse_app/main.py` (GUI) |
| `{{USER_ROLE}}` / `{{USER_EXPERTISE}}` | разработчик-владелец проекта · Python/desktop/scraping |
| `{{LANGUAGE_PREF}}` | пишет по-русски; код/идентификаторы — английские |
| `{{TMP_DIR}}` | `d:\tmp` |

Для **нового** проекта замени правый столбец на свои значения — остальное шаблон проставит сам.

---

## Память для этого пути

Каталог per-project памяти выводится из абсолютного пути проекта (не-буквенно-цифровые
символы → `-`). Для проекта-донора это:

```
~/.claude/projects/d--3DWork---------3DClub-transcribing/memory/
```

Туда копируется содержимое `memory-seed/` (`MEMORY.md`, `user-profile.md`,
`working-rules-limit-discipline.md`). Подробности и формула — в `docs/MEMORY_GUIDE.md`.
