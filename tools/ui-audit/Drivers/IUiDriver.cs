namespace UiAudit.Drivers;

/// <summary>
/// Стек-независимый контракт драйвера UI (seam системы аудита). Сейчас реализован для WinUI
/// (<see cref="WinUiDriver"/> поверх FlaUI/UIA3); web/прочее добавляется позже отдельной
/// реализацией без изменения краулера и оценщика. Краулер видит только этот интерфейс.
/// </summary>
public interface IUiDriver : IDisposable
{
    /// <summary>Поднять приложение (в демо-режиме) и дождаться главного окна.</summary>
    void Launch();

    /// <summary>Закрыть приложение.</summary>
    void Close();

    /// <summary>Пауза, чтобы UI дорендерился/обработал действие.</summary>
    void Settle(int milliseconds);

    /// <summary>Скриншот текущего окна в файл (PNG).</summary>
    void Screenshot(string path);

    /// <summary>Снимок интерактивных контролов текущего представления (пере-строит внутр. карту).</summary>
    IReadOnlyList<UiControl> Enumerate();

    /// <summary>Кликнуть/инвокнуть контрол (Invoke → SelectionItem → мышь). true — успех.</summary>
    bool Invoke(UiControl control);

    /// <summary>Ввести текст в поле (ValuePattern). true — успех.</summary>
    bool SetText(UiControl control, string text);

    /// <summary>Выбрать элемент ComboBox по индексу. true — успех.</summary>
    bool SelectItem(UiControl control, int index);

    /// <summary>Закрыть открытый попап/выпадающий список (Escape). Важно: открытый WinUI
    /// ComboBox-попап усекает дерево дескендантов окна — без сброса последующий
    /// <see cref="Enumerate"/> вернёт почти пусто.</summary>
    void Dismiss();
}

/// <summary>Снимок интерактивного контрола без ссылки на конкретный UI-фреймворк.</summary>
public sealed record UiControl(string Id, string Kind, string Name, string AutomationId, bool Enabled);
