---
applyTo: "**/*.py"
---

# Python Coding Instructions

> Generic-пример. Адаптируй под версию/стиль проекта или удали, если стек не Python.

## Language & Version
- Python 3.11+ синтаксис
- `from __future__ import annotations` в начале файла (для отложенных аннотаций)

## Types
- Все публичные функции/методы — с аннотациями типов
- `list[X]`, `dict[K, V]` (lowercase); `X | None` для nullable
- `@dataclass` для config/DTO-объектов

## Imports Order
1. `from __future__ import annotations`
2. stdlib
3. third-party
4. local

## Logging
- Единый логгер проекта (например `logging`/`loguru`) — для всего прод-логирования
- **Никогда `print()`** в прод-коде

## Naming
- `snake_case` — функции, переменные, модули
- `PascalCase` — классы
- `UPPER_CASE` — константы модуля
- `_single_underscore` — приватное

## Error Handling
- Валидировать только на границах системы (ввод пользователя, внешние API, БД)
- Не добавлять обработку «невозможных» сценариев
- `logger.exception(...)` для неожиданных исключений с трейсбеком

## Paths
- `pathlib.Path`, не `os.path.join`

## Prohibited
- Без «голого» `time.sleep()` в коде с сетью/циклами опроса — использовать rate limiter/backoff
- Без прямых SQL-строк в бизнес-логике — через слой доступа к данным
