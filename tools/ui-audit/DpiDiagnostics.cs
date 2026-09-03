using System.Runtime.InteropServices;

namespace UiAudit;

/// <summary>
/// Самопроверка DPI-контекста процесса аудита и топологии мониторов. Нужна, чтобы ловить молчаливую
/// обрезку скриншотов на HiDPI: если процесс НЕ PerMonitorV2-aware (например харнесс запущен как
/// <c>dotnet ui-audit.dll</c> — DPI-режим наследуется от System-aware <c>dotnet.exe</c>, а вшитый в
/// apphost <c>.exe</c> манифест не применяется), <c>Capture.Element</c> снимает лишь верхний-левый
/// ~40% окна. Единственный правильный режим — PerMonitorV2 (задаётся до первого окна), поэтому это
/// «обнаружить и громко предупредить», а не спросить пользователя.
/// </summary>
public static class DpiDiagnostics
{
    // Предопределённые псевдо-хэндлы DPI_AWARENESS_CONTEXT (winuser.h): значения-«ручки», сравниваются
    // через AreDpiAwarenessContextsEqual (числовое равенство ненадёжно между версиями Windows).
    private static readonly IntPtr ContextUnaware = new(-1);
    private static readonly IntPtr ContextSystemAware = new(-2);
    private static readonly IntPtr ContextPerMonitorAware = new(-3);
    private static readonly IntPtr ContextPerMonitorAwareV2 = new(-4);
    private static readonly IntPtr ContextUnawareGdiScaled = new(-5);

    public sealed record MonitorInfo(bool Primary, int Width, int Height, int ScalePercent);

    public sealed record DpiReport(
        string ProcessDpiAwareness,
        bool IsPerMonitorV2,
        IReadOnlyList<MonitorInfo> Monitors);

    /// <summary>Снять DPI-контекст текущего процесса и топологию мониторов (число + масштабы).</summary>
    public static DpiReport Capture()
    {
        string awareness;
        bool isPmV2;
        try
        {
            var ctx = GetThreadDpiAwarenessContext();
            awareness = Describe(ctx);
            isPmV2 = AreDpiAwarenessContextsEqual(ctx, ContextPerMonitorAwareV2);
        }
        catch (DllNotFoundException)
        {
            // API появились в Windows 10 1607; на старших ОС считаем контекст неизвестным.
            awareness = "unknown (DPI-context API недоступны)";
            isPmV2 = false;
        }
        catch (EntryPointNotFoundException)
        {
            awareness = "unknown (DPI-context API недоступны)";
            isPmV2 = false;
        }

        return new DpiReport(awareness, isPmV2, EnumerateMonitors());
    }

    private static string Describe(IntPtr ctx)
    {
        if (AreDpiAwarenessContextsEqual(ctx, ContextPerMonitorAwareV2)) return "PerMonitorV2";
        if (AreDpiAwarenessContextsEqual(ctx, ContextPerMonitorAware)) return "PerMonitor";
        if (AreDpiAwarenessContextsEqual(ctx, ContextSystemAware)) return "System";
        if (AreDpiAwarenessContextsEqual(ctx, ContextUnawareGdiScaled)) return "Unaware (GdiScaled)";
        if (AreDpiAwarenessContextsEqual(ctx, ContextUnaware)) return "Unaware";
        return "Unknown";
    }

    private static List<MonitorInfo> EnumerateMonitors()
    {
        var monitors = new List<MonitorInfo>();
        try
        {
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hMonitor, IntPtr _, ref Rect rect, IntPtr _) =>
            {
                var primary = false;
                var info = new MonitorInfoEx { cbSize = Marshal.SizeOf<MonitorInfoEx>() };
                if (GetMonitorInfo(hMonitor, ref info))
                {
                    primary = (info.dwFlags & MonitorinfofPrimary) != 0;
                }

                var scale = 100;
                if (GetDpiForMonitor(hMonitor, MdtEffectiveDpi, out var dpiX, out _) == 0 && dpiX > 0)
                {
                    scale = (int)Math.Round(dpiX * 100.0 / 96.0);
                }

                monitors.Add(new MonitorInfo(primary, rect.Right - rect.Left, rect.Bottom - rect.Top, scale));
                return true;
            }, IntPtr.Zero);
        }
        catch (DllNotFoundException) { /* нет user32/shcore — вернём что собрали */ }
        catch (EntryPointNotFoundException) { /* старая ОС — best-effort */ }
        return monitors;
    }

    /// <summary>Прочитать размеры PNG из его IHDR-чанка (без загрузки картинки/System.Drawing).</summary>
    public static (int Width, int Height)? ReadPngSize(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            Span<byte> header = stackalloc byte[24];
            if (fs.Read(header) < 24)
            {
                return null;
            }
            // PNG-сигнатура (8 байт) + длина+тип чанка (8) → ширина/высота в IHDR, big-endian.
            if (header[0] != 0x89 || header[1] != 0x50 || header[2] != 0x4E || header[3] != 0x47)
            {
                return null;
            }
            var width = (header[16] << 24) | (header[17] << 16) | (header[18] << 8) | header[19];
            var height = (header[20] << 24) | (header[21] << 16) | (header[22] << 8) | header[23];
            return (width, height);
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    // ── WinAPI ──────────────────────────────────────────────────────────────────
    private const int MdtEffectiveDpi = 0;
    private const int MonitorinfofPrimary = 0x1;

    [DllImport("user32.dll")]
    private static extern IntPtr GetThreadDpiAwarenessContext();

    [DllImport("user32.dll")]
    private static extern bool AreDpiAwarenessContextsEqual(IntPtr dpiContextA, IntPtr dpiContextB);

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref Rect rect, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MonitorInfoEx info);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr hMonitor, int dpiType, out uint dpiX, out uint dpiY);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int cbSize;
        public Rect rcMonitor;
        public Rect rcWork;
        public uint dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }
}
