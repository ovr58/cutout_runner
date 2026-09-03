# Claude-ready Project Template

Переносимый шаблон, который поднимает **любой** новый проект (любой стек) в то же рабочее
состояние с Claude Code и агентами, что и проект-донор: долгая память, дисциплина затрат
лимитов подписки, конвенции кода, слэш-команды/скилы, субагенты и lifecycle планов.

## Три хоста, один канон

Шаблон рассчитан на **Claude Code**, **Harvi Code** и **GitHub Copilot** одновременно.
Правила лежат в одном месте, а каждый хост получает их своим способом:

| Хост | Файл-вход | Как получает |
| --- | --- | --- |
| — | **`AGENTS.md`** | **канон: источник истины, при расхождении прав он** |
| Harvi Code | `AGENTS.md` | автозагружает напрямую (+ `AGENTS.local.md` — личный оверлей) |
| Claude Code | `CLAUDE.md` | `@AGENTS.md`-импорт + Claude-native рантайм |
| Copilot | `.github/copilot-instructions.md` | выжимка + ссылка (импортов не поддерживает) |

Раскладка обоснована в [`docs/adr/0001-agents-md-canon-without-ai-layer.md`](docs/adr/0001-agents-md-canon-without-ai-layer.md):
отдельного «нейтрального» слоя вроде `.ai/` намеренно **нет** — у Harvi и Copilot всё равно нет
автообнаружения, они читают markdown по пути, поэтому третья копия скилов не добавила бы
исполняемости, а только источник расхождений.

Адаптеры команд/агентов остаются в нативных форматах:

- **Claude Code native** — `.claude/commands/`, `.claude/agents/`, `.claude/skills/`
  (работают как `/slash` и субагенты).
- **GitHub Copilot mirror** — `.github/instructions/`, `.github/prompts/`, `.github/agents/`.
- **Harvi Code** — нативных форматов не имеет: читает `.claude/skills/INDEX.md` и
  `.claude/commands/*.md` по пути, как обычный markdown. Каталог `.claude/` — **host-neutral**
  склад методики для всех хостов, имя историческое.

> **Полосы доверия — по модели, а не по хосту** ([ADR-0002](docs/adr/0002-trust-lane-by-model-not-host.md)):
> Opus в любом хосте — self-review и fast-merge; любая не-Opus модель — review-handoff, ревью
> Opus и явный апрув пользователя. Детали — в `AGENTS.md`.

---

## Что внутри

| Путь | Назначение |
| --- | --- |
| `AGENTS.md` | **Канон** кросс-AI правил — источник истины для всех хостов. Автозагружается Harvi Code. Заполнить плейсхолдеры. |
| `CLAUDE.md` | Адаптер Claude Code: `@AGENTS.md` + Claude-native рантайм (скилы, память, мониторинг). |
| `.github/copilot-instructions.md` | Адаптер Copilot: выжимка канона + ссылка. Имя файла обязано быть именно таким — иначе автозагрузки нет. |
| `.claude/settings.json` | Allowlist прав + `additionalDirectories` + заготовка hooks. |
| `.claude/settings.local.json.example` | Пример локальных override прав (НЕ в git). |
| `.claude/commands/*.md` | Нативные слэш-команды: `spec-intake`, `plan-new`, `plan-status`, `plan-archive`, `bug-intake`, `audit-ui`, `review-branches` + `_TEMPLATE`. |
| `docs/INTAKE_QUESTIONNAIRE.md` | Опросник интейка: ядро + модули по стеку (`web-react`, `react-native`, `ios-xcode`, `backend-api`, `cli`, `desktop`, `data-ml`) + блок прошлого опыта. |
| `docs/TZ.md` · `docs/SPEC.md` | Шаблоны артефактов интейка: ТЗ (что и зачем) и спецификация (как, + handoff в планирование). |
| `docs/VISUALS.md` · `docs/assets/` | **Единственный** визуальный артефакт: схемы (Mermaid), референсы, состояния экранов; бинарники — в `assets/`. |
| `planning/reference/SPEC_INTAKE_RESEARCH.md` | Разведка с цитированием, из которой выведена форма ТЗ/спецификации и стековые грабли. |
| `.claude/agents/*.md` | Нативные субагенты: `domain-dev` (пример) + `_TEMPLATE`. |
| `.claude/skills/<name>/SKILL.md` | Набор generic-скилов (методика): planning, TDD, отладка, ревью, git, оркестрация субагентов. Карта — `.claude/skills/INDEX.md`. Скелет — `_TEMPLATE/SKILL.md`. См. раздел «Skills» ниже. |
| `.github/instructions/*.instructions.md` | Контекстные правила по `applyTo`-глобу: `general-code` и `ponytail` (всегда) + по стеку — `python`, `typescript`, `react`, `react-native`, `swift`; `_TEMPLATE` для своего языка. |
| `docs/PONYTAIL_SETUP.md` | Как ponytail запечён «из коробки» (Claude Code плагин + Copilot Chat) и как проверить. |
| `.github/prompts/*.prompt.md` | Copilot-зеркало команд. |
| `.github/agents/*.agent.md` | Copilot-зеркало субагентов. |
| `planning/` | Lifecycle планов: `INDEX.md`, `BACKLOG.md` (предтечи планов), `reference/`, `active/`, `archive/{reviews,bugs,plans,runs}`. |
| `planning/reference/CLAUDE_MONITORING_GUIDE.md` | Generic-гайд мониторинга/дисциплины лимитов. |
| `memory-seed/` | Seed долгой памяти (копируется вручную в per-project memory-каталог). |
| `docs/WORKING_RULES.md` | Дисциплина затрат лимитов подписки (развёрнуто). |
| `docs/MEMORY_GUIDE.md` | Как устроена долгая память + как вычислить per-project каталог. |

---

## Поднятие нового проекта — быстрый путь (одна фраза)

1. Скопировать содержимое `claude-project-template/` в корень нового проекта.
2. Открыть новый проект в Claude Code и сказать: **«инициализируй проект из шаблона»**
   (или «выполни `INIT.md`»).

Claude пройдёт по [`INIT.md`](INIT.md): **сначала выяснит, что вы строите** (интейк, шаг 2 —
см. ниже), потом выведет плейсхолдеры из полученных документов и покажет на подтверждение,
подберёт стековый профиль инструкций, установит seed-память в per-project каталог, поможет
выбрать хосты и подчистит бутстрап-артефакты.

> Образец запускающей фразы с заполненными значениями (`X/Y/Z`) — в
> [`EXAMPLE_INIT_PROMPT.md`](EXAMPLE_INIT_PROMPT.md) (заполнен по проекту-донору).

## Spec-first интейк: что происходит на шаге 2

Шаблон не начинает работу, пока не понятно, **что строим** — иначе генеральный план
составляется из воздуха ([ADR-0003](docs/adr/0003-spec-first-initialization.md)).

**Три входа, один выход.** Вход определяется автоматически, пользователь может переопределить:

| Вход | Когда срабатывает | Что происходит |
| --- | --- | --- |
| **docs-first** | В `docs/` уже есть ТЗ / бриф / PRD | Читается целиком; интервью — только добивание пробелов |
| **reference-first** | Даны ссылки на сайт/репозиторий/конкурента, скриншоты | Референс разбирается, требования **выводятся** и выносятся на подтверждение |
| **questionnaire-first** | Нет ничего | Полный опросник с нуля |

**На выходе во всех трёх случаях — одни и те же три артефакта:**

- [`docs/TZ.md`](docs/TZ.md) — что и зачем: цель, пользователи, scope и **явный не-scope**,
  сценарии, требования (каждое — с проверяемым критерием), НФТ, критерии приёмки;
- [`docs/SPEC.md`](docs/SPEC.md) — как: архитектура, стек и обоснование, модули, данные,
  окружения, **«Опыт и грабли»** и **handoff в планирование**;
- [`docs/VISUALS.md`](docs/VISUALS.md) — **единственный** визуальный артефакт: схемы
  (Mermaid), референсы со скриншотами, состояния экранов. ТЗ и спека на него **ссылаются**
  по стабильным ID (`V-03`), а не копируют; файл переписывается на месте, дублёры запрещены
  ([ADR-0004](docs/adr/0004-single-visual-artifact.md)).

Интервью ведётся **по одному вопросу за раз** (скил `grill-with-docs`), с само-ответом из
репозитория там, где ответ выводится. Пробел помечается `> TODO(пользователь):`, а не
додумывается. Обязательный блок на любом входе — **прошлый опыт двумя раздельными вопросами**:
что взлетело и что **не** взлетело (про неудачный опыт не рассказывают, если не спросить).

**Handoff в планирование.** В конце `docs/SPEC.md` — раздел для **следующей** модели: рубрика
«признак задачи → модель + эффорт», рекомендация с обоснованием и **пауза** до слова
«продолжить», чтобы генеральный план строила уже подходящая модель. Механика паузы та же, что
в `/review-branches`. Оговорка: смена модели машинно не проверяется — это самообъявление.

Запуск отдельно от `INIT.md`: `/spec-intake` (Claude Code, Copilot) либо чтение
[`.claude/skills/spec-intake/SKILL.md`](.claude/skills/spec-intake/SKILL.md) по пути (Harvi Code).
Вопросы — [`docs/INTAKE_QUESTIONNAIRE.md`](docs/INTAKE_QUESTIONNAIRE.md); откуда взята форма
артефактов — [`planning/reference/SPEC_INTAKE_RESEARCH.md`](planning/reference/SPEC_INTAKE_RESEARCH.md).

Ниже — те же шаги вручную, если хочется без `INIT.md`.

## Поднятие нового проекта (ручные шаги)

1. **Скопировать содержимое** `claude-project-template/` в корень нового проекта
   (можно без `README.md` и `docs/` — но `docs/` стоит оставить как справочник).
   В итоге в корне нового проекта должны лежать: `AGENTS.md`, `CLAUDE.md`, `.claude/`,
   `.github/`, `planning/`, `docs/`.

2. **Провести интейк** (см. «Spec-first интейк» выше): заполнить `docs/TZ.md`, `docs/SPEC.md`
   и `docs/VISUALS.md` по опроснику `docs/INTAKE_QUESTIONNAIRE.md`. Отсюда же берутся
   значения для следующего шага — стек, архитектура, команды запуска и тестов.

3. **Заменить плейсхолдеры** `{{...}}` во всех файлах. Минимально обязательные:
   - `{{PROJECT_NAME}}` — имя проекта;
   - `{{STACK}}` — стек (язык/фреймворк/БД);
   - `{{ARCH_OVERVIEW}}` — 3–6 строк про архитектуру;
   - `{{PRIMARY_LOG_PATH}}`, `{{LOG_NOISE_FILTER_REGEX}}`, `{{PIPELINE_STAGES}}`,
     `{{RUN_COMMAND}}` — для гайда мониторинга (если есть длительные прогоны);
   - `{{ACTIONS_LOG_PATH}}`, `{{CURSOR_PATH}}`, `{{TARGET_TO_FILE_MAP}}` — для `bug-intake`
     (если ведёте лог UI-действий; иначе — удалить `bug-intake`).
   > Быстро найти все плейсхолдеры: `grep -rn "{{" .` в корне нового проекта.

4. **Установить seed-память** (см. `docs/MEMORY_GUIDE.md`):
   открыть новый проект в Claude Code один раз (создастся per-project каталог), затем
   скопировать содержимое `memory-seed/` в
   `~/.claude/projects/<derived-from-path>/memory/`. Заполнить плейсхолдеры в
   `user-profile.md`. Память живёт **вне** репозитория.

5. **Выбрать стековый профиль инструкций** `.github/instructions/`: `general-code` и
   `ponytail` остаются всегда; из стековых оставить нужные (`python` · `typescript` ·
   `react` · `react-native` · `swift`), остальные удалить. Стек не покрыт — скопировать
   `_TEMPLATE.instructions.md`, задать `applyTo`-глоб и заполнить. Таблица профилей — в
   [`INIT.md`](INIT.md) шаг 4; там же — что делать с `tools/ui-audit/` (WinUI-референс,
   для web/RN/iOS нужен свой `IUiDriver` либо удаление).

6. **Расширить allowlist** в `.claude/settings.json` под реальные команды проекта
   (запуск тестов, линтер, БД-клиент и т.п.).

7. **Выбрать хосты.** По умолчанию **ничего не удалять** — неиспользуемые адаптеры безвредны,
   а хост может добавиться позже. Если всё же чистите: не используете Copilot — можно удалить
   `.github/prompts/`, `.github/agents/`, `.github/copilot-instructions.md`; не используете
   Claude Code — `.claude/commands/`, `.claude/agents/`, `CLAUDE.md`.
   **`AGENTS.md`, `.claude/skills/` и `.github/instructions/` не удалять никогда** — это канон
   и host-neutral склад методики, их читают все хосты.

8. **Hooks (опционально):** в `.claude/settings.json` есть закомментированная заготовка
   секции `hooks`. Раскомментировать, если нужны автоматические действия
   (форматирование на Stop, защита путей на PreToolUse и т.п.).

---

## Skills (методика, consult-first)

Скилы — переносимая методика, которую Claude подтягивает в контекст **по релевантности**
(`.claude/skills/<name>/SKILL.md`). Это «как работать», а не «что за проект»: planning,
TDD, отладка, ревью, git, оркестрация субагентов.

- **Формат `SKILL.md`:** фронтматтер `name` + `description`; `description` начинается с
  **«Use when …»** и перечисляет ТОЛЬКО триггеры (≤500 симв., весь фронтматтер ≤1024). Тело —
  Overview / When to Use / Process / Common Mistakes / Cross-references. Тело EN для
  generic-методики, RU для проектных конвенций. Tech-specifics — плейсхолдерами
  (`{{TEST_COMMAND}}` и т.п.). Скелет — `_TEMPLATE/SKILL.md`.
- **Карта:** `.claude/skills/INDEX.md` — одна строка на скил (как `planning/INDEX.md`).
- **Consult-first:** правило в `CLAUDE.md` — перед нетривиальным действием свериться с картой
  и следовать подходящему скилу. Это **правило, а не хук**.
- **Opt-in SessionStart-хук:** если хочешь, чтобы карта скилов автоматически подмешивалась в
  контекст каждой сессии — в `.claude/settings.json` есть закомментированный пример (блок
  `_hooks.SessionStart`, команда `cat .claude/skills/INDEX.md`). Переименуй `_hooks` → `hooks`,
  чтобы включить. По умолчанию выключено — consult-first держится правилом.
- **Как добавить скил:** см. скил `writing-skills` — скопировать `_TEMPLATE/SKILL.md`,
  написать триггер-`description`, заполнить тело, **добавить строку в `INDEX.md`** в том же
  изменении.
- **Оркестрация субагентов гейтится cost-discipline:** скилы `subagent-driven-development` и
  `dispatching-parallel-agents` по умолчанию ведут к **inline**; спавн — только под fan-out /
  настоящую параллельность / изоляцию контекста / явную просьбу, модель — по сложности
  (`docs/WORKING_RULES.md` §2). Это сделано намеренно: на метрируемой подписке субагент-тяжёлые
  сессии — главный источник расхода лимита.
- **Copilot-зеркало:** не все скилы дублируются; ключевые invokable вынесены в
  `.github/prompts/` (`brainstorming`, `systematic-debugging`), остальное — указатель на
  нативные скилы из `.github/copilot-instructions.md`.

## Жизненный цикл планов (коротко)

`BACKLOG` (`planning/BACKLOG.md`, предтеча — готовый промпт+референсы) → `Draft`
(`~/.claude/plans/<slug>.md`, plan mode) → `ACTIVE` (`planning/active/`) →
`DONE` (правка шапки + блок «что сделано») → `ARCHIVED` (`planning/archive/plans/`).
Переходы делают команды `/plan-new`, `/plan-status`, `/plan-archive`. Любое
перемещение/добавление плана — **в том же изменении** обновляет одну строку в
`planning/INDEX.md`. Развилку на будущий план — в `BACKLOG.md` (`docs/WORKING_RULES.md` §8).

## Дисциплина затрат лимитов (коротко)

Полный список — `docs/WORKING_RULES.md`. Ключевое: мониторинг длительных прогонов —
только `ScheduleWakeup` + tail+grep (не `Monitor`); интервал 270 с держит кэш промптов
тёплым; ≤30 событий мониторинга в час; tool-вывод ≤50 строк; минимальные правки.

## Заметка о формате frontmatter

- **Нативная слэш-команда** (`.claude/commands/x.md`): frontmatter-ключи `description`,
  `argument-hint`, `allowed-tools`, `model` (все опциональны). Аргументы в теле — `$ARGUMENTS`
  / `$1`,`$2`. Имя команды = имя файла.
- **Нативный субагент** (`.claude/agents/x.md`): `name`, `description`, `tools`
  (CSV или опустить, чтобы наследовать все), `model`. Тело — системный промпт агента.
- **Нативный скил** (`.claude/skills/<name>/SKILL.md`): `name`, `description`.
- **Copilot prompt** (`.github/prompts/x.prompt.md`): `name`, `description`; переменные `{{var}}`.
- **Copilot instructions** (`.github/instructions/x.instructions.md`): `applyTo` (glob, CSV).
- **Copilot agent** (`.github/agents/x.agent.md`): `name`, `description`, `tools:` (список).

При сомнениях по нативному формату — `/help` в Claude Code или спросить агента
`claude-code-guide`.
