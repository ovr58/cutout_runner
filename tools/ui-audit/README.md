# tools/ui-audit — харнесс UI-аудита (референс-реализация)

Консольный краулер для системы **`auditing-ui`** (`.claude/skills/auditing-ui/SKILL.md`): запускает
твой WinUI-app в демо-режиме, обходит экраны, снимает скриншот каждого состояния и пишет
`crawl.json` + `screens/*.png`. Это Phase 3 («краул») методики; дальше — vision-обзор (Phase 4/5).

Управляет приложением как **чёрным ящиком** через UI Automation (FlaUI/UIA3) — НЕ ссылается на
сборку app. Логика обхода стек-независима за контрактом `IUiDriver`; для web добавляется свой
драйвер (Playwright/CDP) без изменения краулера.

## Что здесь

| Файл | Назначение | Правишь? |
| --- | --- | --- |
| `Drivers/IUiDriver.cs` | Стек-независимый контракт драйвера (seam). | нет |
| `Drivers/WinUiDriver.cs` | WinUI-драйвер поверх FlaUI/UIA3 (Launch/Screenshot/Enumerate/…). | редко |
| `DpiDiagnostics.cs` | **Self-check DPI** на старте (WinAPI) + топология мониторов + размер PNG. | нет |
| `app.manifest` | **PerMonitorV2 DPI-awareness** — без него скриншоты на HiDPI обрезаются. | нет |
| `UiAudit.csproj` | Проект (net8.0-windows, FlaUI.UIA3, apphost с манифестом). | нет |
| `Program.cs` | Краулер + **блок `AuditConfig`** внизу — единственное место с project-spec. | **да** |

## Настройка (перед первым прогоном)

Открой `Program.cs`, найди `AuditConfig` внизу и заполни под свой UI:

- `DemoEnvVar` — env-переключатель демо-режима, который App читает при старте (подменяет backend на
  фейки через DI). Драйвер ставит его в `"1"`. Демо-режим обязателен: реальные backend'ы делают
  краул недетерминированным (см. SKILL.md, шаг 1).
- `NavLabels` — порядок обхода экранов (`Name` у `ListItem` в `NavigationView`).
- `StartButton` — кнопка, наполняющая состояние в начале (напр. `Start`). Пусто → пропустить.
- `DenyButtons` — кнопки, которые НЕ кликать (модалки, file-picker'ы, деструктив, старт/стоп).
- Примеры golden-действий (`TextInputScreen`, `ParametricScreen`) — адаптируй или удали.

Имена элементов (`Name`/`AutomationId`) видно в `crawl.json` после первого прогона — прогони,
подсмотри реальные имена, заполни CONFIG.

## Сборка и запуск

```sh
dotnet build tools/ui-audit/UiAudit.csproj -c Debug
# ⚠ Запускать собранный .exe, НЕ `dotnet ui-audit.dll`:
tools/ui-audit/bin/Debug/net8.0-windows/ui-audit.exe  <path-to-app.exe>  <run-dir>
```

**Почему `.exe`, а не `dotnet <dll>`:** DPI-манифест (`PerMonitorV2`) вшит в apphost-`.exe`. Через
`dotnet ui-audit.dll` DPI-режим наследуется от `dotnet.exe` (System-aware), манифест не применяется,
и `Capture` снимает лишь верхний-левый ~40% окна на HiDPI. **Контроль:** размер первого кадра ≈
физическому разрешению монитора (напр. 3872×2072), а не ~1500px.

Ручной контроль дублируется **само-проверкой**: харнесс на старте (`DpiDiagnostics`) проверяет свой
DPI-контекст и при не-PerMonitorV2 печатает громкий варн в stderr + заметку в `crawl.json` — если
запустил через `dotnet <dll>`, увидишь предупреждение и перезапустишь через `.exe`.

## Выхлоп

```
<run-dir>/
  crawl.json      # dpi (контекст+мониторы), frameCheck (кадр vs bounds), экраны, контролы, заметки
  screens/*.png   # скриншот каждого состояния
```

Блоки `dpi` (DPI-контекст процесса + топология мониторов) и `frameCheck` (размер первого кадра vs
bounds окна, флаг обрезки) пишутся всегда — обрезка/несовпадение ловятся автоматически.

`crawl.json` — вход для vision-обзора (Phase 4): один пакетный Sonnet-субагент по всем скриншотам
сразу оценивает адекватность по рубрике (`.claude/skills/auditing-ui/rubric.md`). Плюс `crawl.json`
майнится на дефекты accessibility-имён (сырые дампы объектов, склеенные/пустые/`"?"` имена).

## Расширение на другой стек

Реализуй `IUiDriver` для web (Playwright/CDP) — краулер, рубрика и vision-этап не меняются.
Референс WinUI-реализации в этом проекте — образец того, что должен уметь драйвер.
