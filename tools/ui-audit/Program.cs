using System.Text.Json;
using UiAudit;
using UiAudit.Drivers;

// UI-аудит — краул (референс-реализация системы `auditing-ui`, Phase 3): запускает целевой
// WinUI-app в демо-режиме, обходит экраны навигации, выполняет golden-действия и кликает
// безопасные кнопки, снимая скриншот каждого состояния. Выхлоп: <run>/crawl.json + <run>/screens/*.png
// — вход для vision-обзора (Phase 4/5, см. .claude/skills/auditing-ui).
//
//   ЗАПУСК:  ui-audit.exe <path-to-app.exe> [run-dir]
//   ⚠ Запускать собранный ui-audit.exe, а НЕ `dotnet ui-audit.dll`: DPI-манифест (PerMonitorV2)
//     вшит в apphost .exe; иначе на HiDPI скриншоты обрежутся до левого-верхнего ~40% окна.
//
//   НАСТРОЙКА: правь блок AuditConfig внизу под свой app (имена экранов, кнопок, demo-env,
//   golden-действия). Логика обхода/скриншотов/JSON — переиспользуемая, менять обычно не нужно.

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: ui-audit <path-to-app.exe> [run-dir]");
    return 2;
}
var exe = args[0];
if (!File.Exists(exe))
{
    Console.Error.WriteLine($"exe not found: {exe}");
    return 2;
}
var runDir = args.Length > 1
    ? args[1]
    : Path.Combine(AppContext.BaseDirectory, "runs", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
var shotsDir = Path.Combine(runDir, "screens");
Directory.CreateDirectory(shotsDir);

var screens = new List<object>();
var notes = new List<string>();
var shot = 0;

// Self-check DPI: если процесс НЕ PerMonitorV2-aware (харнесс запущен как `dotnet ui-audit.dll`, а не
// через apphost `.exe` с вшитым манифестом), Capture.Element снимет лишь верхний-левый ~40% окна на
// HiDPI — молча деградирует vision-обзор. Правильный режим один — предупреждаем громко, не спрашиваем.
var dpi = DpiDiagnostics.Capture();
if (!dpi.IsPerMonitorV2)
{
    var warn = $"⚠ DPI-контекст процесса = '{dpi.ProcessDpiAwareness}', а не PerMonitorV2: "
             + "запусти ui-audit.exe, НЕ `dotnet ui-audit.dll` — иначе на HiDPI "
             + "скриншоты будут обрезаны (в кадр попадёт лишь верхний-левый ~40% окна).";
    Console.Error.WriteLine(warn);
    notes.Add(warn);
}
if (dpi.Monitors.Any(m => m.ScalePercent != 100))
{
    notes.Add("мониторы: " + string.Join(", ", dpi.Monitors.Select((m, i) =>
        $"#{i}{(m.Primary ? "*" : "")} {m.Width}×{m.Height}@{m.ScalePercent}%")));
}
object? frameCheck = null;

using var driver = new WinUiDriver(
    exe, demo: true, demoEnvVar: AuditConfig.DemoEnvVar, extraEnv: AuditConfig.ExtraEnv(runDir));
try
{
    driver.Launch();
    Console.WriteLine("launched (demo mode)");

    // 0) стартовое представление
    var firstShot = Snap("start");
    frameCheck = BuildFrameCheck(firstShot, driver.WindowBounds);
    RecordScreen("start", driver.Enumerate(), new List<string> { "initial view" });

    // 1) наполнить состояние стартовой кнопкой (если задана в CONFIG)
    if (!string.IsNullOrEmpty(AuditConfig.StartButton))
    {
        var start = driver.Enumerate().FirstOrDefault(c => c.Name == AuditConfig.StartButton && c.Enabled);
        if (start is not null && driver.Invoke(start))
        {
            driver.Settle(2500);
            notes.Add($"clicked '{AuditConfig.StartButton}'");
            Snap("after-start");
        }
        else
        {
            notes.Add($"start-кнопка '{AuditConfig.StartButton}' не найдена/недоступна");
        }
    }

    // 2) обход экранов навигации
    foreach (var label in AuditConfig.NavLabels)
    {
        var nav = driver.Enumerate().FirstOrDefault(c => c.Kind == "ListItem" && c.Name == label);
        if (nav is null)
        {
            notes.Add($"nav '{label}' не найден");
            continue;
        }
        driver.Invoke(nav);
        driver.Settle(900);
        Snap(label);
        var controls = driver.Enumerate();
        var actions = new List<string>();

        // ==== ПРИМЕР golden-действия: заполнить текстовое поле (иначе кнопка отправки задизейблена).
        //      Адаптируй имя экрана/текст в CONFIG или удали блок. ====
        if (label == AuditConfig.TextInputScreen)
        {
            var edit = controls.FirstOrDefault(c => c.Kind == "Edit");
            if (edit is not null && driver.SetText(edit, AuditConfig.TextInputSample))
            {
                actions.Add("text input");
                driver.Settle(300);
                controls = driver.Enumerate();
            }
        }

        // ==== ПРИМЕР golden-действия: семплировать варианты ComboBox (параметрический экран).
        //      WinUI ComboBox виртуализирует пункты, раскрытый попап усекает дерево окна — SelectItem
        //      выбирает клавиатурой без раскрытия. Адаптируй экран/число в CONFIG или удали блок. ====
        if (label == AuditConfig.ParametricScreen && AuditConfig.ParametricCount > 0)
        {
            var combo = driver.Enumerate().FirstOrDefault(c => c.Kind == "ComboBox");
            for (var idx = 0; combo is not null && idx < AuditConfig.ParametricCount; idx++)
            {
                if (driver.SelectItem(combo, idx))
                {
                    driver.Settle(400);
                    actions.Add($"вариант[{idx}]");
                    Snap($"{label}-type{idx}");
                }
                combo = driver.Enumerate().FirstOrDefault(c => c.Kind == "ComboBox");
            }
        }

        // Клик безопасных кнопок экрана (без модалок/деструктива/chrome окна; снимок фиксирован).
        foreach (var b in controls.Where(c => c.Kind == "Button" && c.Enabled
            && !AuditConfig.DenyButtons.Contains(c.Name)
            && !AuditConfig.DenyAutomationIds.Contains(c.AutomationId)))
        {
            if (driver.Invoke(b))
            {
                driver.Settle(800);
                actions.Add($"click:{b.Name}");
                Snap($"{label}-{b.Name}");
            }
        }

        RecordScreen(label, controls, actions);
    }

    // ==== ПРИМЕР: снимок «пустого состояния» без активного стрима (снимать ПОСЛЕДНИМ).
    //      Если демо-стрим дописывает события и перекрывает очищенный список — сначала останови
    //      стрим (напр. кнопкой Stop), затем очисти и сними. driver.Dismiss() сбрасывает залипший
    //      попап (иначе Enumerate вернёт усечённое дерево). Раскомментируй/адаптируй под свой app:
    //
    // driver.Dismiss();
    // driver.Settle(600);
    // var stop = driver.Enumerate().FirstOrDefault(c => c.Name == "Stop" && c.Enabled);
    // if (stop is not null) { driver.Invoke(stop); driver.Settle(800); }
    // var histNav = driver.Enumerate().FirstOrDefault(c => c.Kind == "ListItem" && c.Name == "History");
    // if (histNav is not null)
    // {
    //     driver.Invoke(histNav); driver.Settle(600);
    //     var clear = driver.Enumerate().FirstOrDefault(c => c.Name == "Clear" && c.Enabled);
    //     if (clear is not null) { driver.Invoke(clear); driver.Settle(600); }
    //     Snap("History-empty");
    //     RecordScreen("History-empty", driver.Enumerate(), new List<string> { "stop", "clear" });
    // }

    driver.Close();
}
finally
{
    driver.Close();
}

var result = new
{
    app = exe,
    startedUtc = DateTime.UtcNow,
    screensCaptured = screens.Count,
    dpi = new
    {
        processAwareness = dpi.ProcessDpiAwareness,
        isPerMonitorV2 = dpi.IsPerMonitorV2,
        monitors = dpi.Monitors.Select(m => new { m.Primary, m.Width, m.Height, m.ScalePercent }),
    },
    frameCheck,
    screens,
    notes,
};
File.WriteAllText(
    Path.Combine(runDir, "crawl.json"),
    JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));

Console.WriteLine($"screens={screens.Count} shots={shot} notes={notes.Count}");
Console.WriteLine($"run: {runDir}");
return 0;

// ── helpers (замыкания над driver/screens/shot) ─────────────────────────────
string Snap(string label)
{
    var file = Path.Combine(shotsDir, $"{shot++:D2}-{Sanitize(label)}.png");
    driver.Screenshot(file);
    return Path.GetFileName(file);
}

void RecordScreen(string screen, IReadOnlyList<UiControl> controls, List<string> actions)
{
    screens.Add(new
    {
        screen,
        controls = controls
            .Select(c => new { c.Kind, c.Name, c.AutomationId, c.Enabled })
            .ToList(),
        actions,
    });
}

// Сверяет размер снятого кадра с экранными bounds окна: под PerMonitorV2 они должны совпадать
// (кадр ≈ окно). Заметное расхождение = обрезка/несовпадение — ловим автоматически, а не глазами.
object BuildFrameCheck(string shotFile, (int Width, int Height)? bounds)
{
    var size = DpiDiagnostics.ReadPngSize(Path.Combine(shotsDir, shotFile));
    if (size is not { } frame || bounds is not { } win || win.Width == 0 || win.Height == 0)
    {
        notes.Add("frame-check: не удалось сверить кадр с bounds окна (нет размеров PNG/окна)");
        return new { firstShot = shotFile, captured = size, windowBounds = bounds, matchesWindow = (bool?)null };
    }
    // ≥10% недобор по любой оси относительно окна = обрезка (типовой симптом не-PMv2 — кадр ~40% окна).
    var ratioW = (double)frame.Width / win.Width;
    var ratioH = (double)frame.Height / win.Height;
    var ok = ratioW >= 0.9 && ratioH >= 0.9;
    if (!ok)
    {
        notes.Add($"frame-check: кадр {frame.Width}×{frame.Height} меньше bounds окна "
                + $"{win.Width}×{win.Height} (×{ratioW:F2}/{ratioH:F2}) — вероятна обрезка скриншота.");
    }
    return new
    {
        firstShot = shotFile,
        captured = new { frame.Width, frame.Height },
        windowBounds = new { win.Width, win.Height },
        matchesWindow = ok,
    };
}

static string Sanitize(string s)
{
    var cleaned = string.Concat(s.Split(Path.GetInvalidFileNameChars()));
    return cleaned.Replace(' ', '-').Replace('…', '_');
}

// ==================== CONFIG — ЗАПОЛНИ ПОД СВОЙ APP ====================
// Единственное место с project-spec. Замени примерные значения на имена экранов/кнопок твоего UI
// (Name у элементов из UIA-дерева — их видно в crawl.json после первого прогона). Логика обхода
// выше — переиспользуемая.
static class AuditConfig
{
    // Env-переключатель демо-режима, который твой App читает при старте (свой аналог APP_DEMO,
    // подменяющий backend-границы на фейки через DI). Драйвер ставит его в "1".
    public const string DemoEnvVar = "APP_DEMO";

    // Доп. env приложению на время аудита (напр. каталог для picker-bypass выгрузок отчётов).
    public static Dictionary<string, string> ExtraEnv(string runDir) => new()
    {
        // ["APP_DEMO_REPORT_SAMPLES"] = Path.Combine(runDir, "report-samples"),
    };

    // Порядок обхода экранов навигации (Name у ListItem в NavigationView). ← ЗАМЕНИ на свои.
    public static readonly string[] NavLabels = { "Screen1", "Screen2", "Screen3" };

    // Кнопка, наполняющая состояние в начале (Start/Запустить). Пусто → пропустить.
    public const string StartButton = "";

    // ПРИМЕР golden-действия: экран с текстовым вводом + пример текста. Пусто → пропустить.
    public const string TextInputScreen = "";
    public const string TextInputSample = "example query";

    // ПРИМЕР golden-действия: параметрический экран с ComboBox + число вариантов. 0 → пропустить.
    public const string ParametricScreen = "";
    public const int ParametricCount = 0;

    // Кнопки, которые НЕ кликаем автоматически (модалки/пикеры/деструктив/жизненный цикл). ← ЗАПОЛНИ.
    public static readonly HashSet<string> DenyButtons = new()
    {
        // "Start", "Stop", "Generate", "Browse…", "Browse...",
    };

    // Chrome окна по AutomationId (локаль-независимо) — не кликаем никогда. Обычно менять не нужно.
    public static readonly HashSet<string> DenyAutomationIds = new()
    {
        "Minimize-Restore", "Maximize-Restore", "Close", "TogglePaneButton",
    };
}
