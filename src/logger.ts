/**
 * Единственный способ писать в журнал. `console.log` в проде не используется (канон AGENTS.md).
 *
 * Тип полей намеренно узкий: примитивы и ничего больше. Буфер с кадром или вырезом через него
 * не пройдёт — в журнал идут метод, код ответа, длительность и размер, но не содержимое
 * (docs/TZ.md FR-14). Секрет тоже не логируется никогда: он живёт только в src/auth.ts.
 */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  // journald читает stdout/stderr службы; отдельного файла лога сервис не заводит.
  process.stdout.write(`${line}\n`);
}

export const log = {
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
} as const;

/**
 * Сообщение ошибки для журнала. Наружу в HTTP-ответ оно не идёт никогда: тело ошибки не
 * содержит ни стека, ни путей, ни имени модели (docs/TZ.md FR-10).
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
