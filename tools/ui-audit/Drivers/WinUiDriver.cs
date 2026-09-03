using System.Diagnostics;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Definitions;
using FlaUI.UIA3;

namespace UiAudit.Drivers;

/// <summary>
/// WinUI-реализация <see cref="IUiDriver"/> поверх FlaUI/UIA3. Управляет целевым приложением как
/// чёрным ящиком через UI Automation (не ссылается на его сборку) — не конфликтует с блокировкой
/// exe и заменяется web-драйвером. <see cref="UiControl.Id"/> — ключ во внутренней карте живых
/// UIA-элементов последнего <see cref="Enumerate"/>.
/// </summary>
public sealed class WinUiDriver : IUiDriver
{
    private static readonly HashSet<string> Interactive = new()
    {
        "Button", "ListItem", "ComboBox", "CheckBox", "Edit", "RadioButton", "Hyperlink", "TabItem",
    };

    private readonly string _exePath;
    private readonly bool _demo;
    private readonly string _demoEnvVar;
    private readonly IReadOnlyDictionary<string, string>? _extraEnv;
    private readonly Dictionary<string, AutomationElement> _map = new();

    private UIA3Automation? _automation;
    private Application? _app;
    private Window? _window;

    /// <param name="demoEnvVar">Имя env-переключателя демо-режима, который читает App при старте
    /// (напр. свой аналог <c>APP_DEMO</c>). Ставится в "1", когда <paramref name="demo"/>=true.</param>
    public WinUiDriver(
        string exePath, bool demo = true, string demoEnvVar = "APP_DEMO",
        IReadOnlyDictionary<string, string>? extraEnv = null)
    {
        _exePath = exePath;
        _demo = demo;
        _demoEnvVar = demoEnvVar;
        _extraEnv = extraEnv;
    }

    public void Launch()
    {
        var psi = new ProcessStartInfo(_exePath) { UseShellExecute = false };
        if (_demo)
        {
            psi.Environment[_demoEnvVar] = "1";
        }
        if (_extraEnv is not null)
        {
            foreach (var (key, value) in _extraEnv)
            {
                psi.Environment[key] = value;
            }
        }
        _app = Application.Launch(psi);
        _automation = new UIA3Automation();
        _window = _app.GetMainWindow(_automation, TimeSpan.FromSeconds(25))
                  ?? throw new InvalidOperationException("главное окно не найдено в отведённое время");
        // Развернуть + на передний план: Capture.Element снимает ЭКРАННУЮ область окна, поэтому
        // окно должно быть не перекрыто (иначе на скриншотах — то, что поверх, напр. IDE).
        try { _window.Patterns.Window.PatternOrDefault?.SetWindowVisualState(WindowVisualState.Maximized); }
        catch { /* не критично */ }
        try { _window.SetForeground(); }
        catch { /* SetForegroundWindow может не сработать — митигируем в Screenshot */ }
        Settle(1500);
    }

    public void Settle(int milliseconds) => Thread.Sleep(milliseconds);

    /// <summary>Экранные границы главного окна (под PerMonitorV2 — физические пиксели). Нужны, чтобы
    /// сверить «размер снятого кадра vs bounds окна» и ловить обрезку скриншота.</summary>
    public (int Width, int Height)? WindowBounds
    {
        get
        {
            try
            {
                var r = _window?.BoundingRectangle;
                return r is { } rect ? (rect.Width, rect.Height) : null;
            }
            catch { return null; }
        }
    }

    public void Screenshot(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // Пере-развернуть + на передний план перед КАЖДЫМ снимком: обход мог свернуть/перекрыть окно.
        try { _window!.Patterns.Window.PatternOrDefault?.SetWindowVisualState(WindowVisualState.Maximized); }
        catch { /* без паттерна окна — пропускаем */ }
        try { _window!.SetForeground(); }
        catch { /* окно на переднем плане не гарантируется — лучшее усилие */ }
        Thread.Sleep(350);
        Capture.Element(_window!).ToFile(path);
    }

    public IReadOnlyList<UiControl> Enumerate()
    {
        _map.Clear();
        var result = new List<UiControl>();
        AutomationElement[] all;
        try { all = _window!.FindAllDescendants(); }
        catch { return result; }

        var i = 0;
        foreach (var el in all)
        {
            string kind;
            try { kind = el.ControlType.ToString(); }
            catch { continue; }
            if (!Interactive.Contains(kind))
            {
                continue;
            }
            var name = Safe(() => el.Name);
            var aid = Safe(() => el.Properties.AutomationId.ValueOrDefault ?? "");
            var enabled = SafeBool(() => el.Properties.IsEnabled.ValueOrDefault);
            var id = $"{kind}#{i++}:{name}:{aid}";
            _map[id] = el;
            result.Add(new UiControl(id, kind, name, aid, enabled));
        }
        return result;
    }

    public bool Invoke(UiControl control)
    {
        if (!_map.TryGetValue(control.Id, out var el))
        {
            return false;
        }
        try
        {
            var invoke = el.Patterns.Invoke.PatternOrDefault;
            if (invoke != null) { invoke.Invoke(); return true; }
            var select = el.Patterns.SelectionItem.PatternOrDefault;
            if (select != null) { select.Select(); return true; }
            el.Click();
            return true;
        }
        catch
        {
            try { el.Click(); return true; }
            catch { return false; }
        }
    }

    public bool SetText(UiControl control, string text)
    {
        if (!_map.TryGetValue(control.Id, out var el))
        {
            return false;
        }
        try
        {
            var value = el.Patterns.Value.PatternOrDefault;
            if (value != null) { value.SetValue(text); return true; }
            el.AsTextBox().Text = text;
            return true;
        }
        catch { return false; }
    }

    public bool SelectItem(UiControl control, int index)
    {
        if (!_map.TryGetValue(control.Id, out var el))
        {
            return false;
        }
        try
        {
            // WinUI ComboBox виртуализирует пункты, а раскрытый попап усекает дерево дескендантов
            // окна — поэтому НЕ раскрываем список. Сфокусированный (свёрнутый) ComboBox меняет
            // выбор стрелками: UP×N гарантированно ставит на первый пункт, затем DOWN×index.
            el.Focus();
            Thread.Sleep(150);
            for (var i = 0; i < 8; i++)
            {
                FlaUI.Core.Input.Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.UP);
                Thread.Sleep(40);
            }
            for (var i = 0; i < index; i++)
            {
                FlaUI.Core.Input.Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.DOWN);
                Thread.Sleep(60);
            }
            return true;
        }
        catch { return false; }
    }

    public void Dismiss()
    {
        // Escape закрывает открытый ComboBox-попап/меню. Пока попап открыт, FindAllDescendants
        // окна возвращает усечённое дерево (нет нав-элементов/контента) — потому сбрасываем.
        try
        {
            _window?.SetForeground();
            FlaUI.Core.Input.Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.ESCAPE);
        }
        catch { /* best-effort */ }
    }

    public void Close()
    {
        try { _app?.Close(); }
        catch { /* best-effort */ }
    }

    public void Dispose()
    {
        Close();
        _automation?.Dispose();
        _app?.Dispose();
    }

    private static string Safe(Func<string?> f)
    {
        try { return f() ?? string.Empty; }
        catch { return "?"; }
    }

    private static bool SafeBool(Func<bool> f)
    {
        try { return f(); }
        catch { return true; }
    }
}
