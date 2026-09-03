import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Право звать доказывается общим секретом в `Authorization: Bearer` поверх TLS
 * (docs/adr/0006-service-trust-boundary.md).
 *
 * Секрет живёт только здесь: ни логгер, ни обработчики ошибок его не видят.
 */
export type Authorizer = (header: string | undefined) => boolean;

/** RFC 7235: имя схемы регистронезависимо. */
const BEARER = /^Bearer[ \t]+(.+)$/i;

export function makeAuthorizer(secret: string): Authorizer {
  const expected = digest(secret);

  return (header: string | undefined): boolean => {
    // Заголовка нет — сравниваем с пустой строкой, а не выходим раньше: путь исполнения и
    // ответ для «секрета нет» и «секрет неверный» должны совпадать (docs/TZ.md FR-09).
    const presented = extractBearer(header);
    // timingSafeEqual бросает при разной длине буферов, поэтому сравниваются хэши: они
    // всегда по 32 байта, и длина секрета не утекает (docs/SPEC.md §9).
    return timingSafeEqual(digest(presented), expected);
  };
}

function extractBearer(header: string | undefined): string {
  if (header === undefined) return '';
  const match = BEARER.exec(header);
  return match?.[1] ?? '';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
