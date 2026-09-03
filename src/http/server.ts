import http from 'node:http';

import type { Authorizer } from '../auth';
import { UnreadableImageError } from '../cutout/pipeline';
import { GateBusyError } from '../queue';
import { errorMessage, log } from '../logger';

/**
 * Контракт HTTP. Вызывающий код на той стороне **уже написан и ждёт именно этого**: менять
 * контракт в одиночку нельзя, расхождение обнаружится не тестом, а пустым слоем в оплаченной
 * карточке. Полностью — docs/SPEC.md §5.
 *
 * Этот слой ничего не знает про ONNX: он различает только «вырез», «выреза нет»,
 * «не разобралось» и «занято».
 */
export interface ServerDeps {
  readonly authorize: Authorizer;
  readonly isReady: () => boolean;
  /** Вырез или `null` — «товара не нашлось». Может бросить {@link GateBusyError}. */
  readonly cutout: (body: Buffer) => Promise<Buffer | null>;
  /** Потолок тела. Основной стоит в nginx (413 до Node); этот — на случай запуска без него. */
  readonly maxBodyBytes: number;
  /** Значение заголовка `Retry-After` при занятой очереди, секунды. */
  readonly retryAfterSeconds: number;
}

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg']);

export function createServer(deps: ServerDeps): http.Server {
  return http.createServer((req, res) => {
    void handle(deps, req, res);
  });
}

async function handle(
  deps: ServerDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const startedAt = process.hrtime.bigint();
  const method = req.method ?? '';
  const path = (req.url ?? '').split('?')[0] ?? '';
  let bytesIn = 0;

  try {
    if (path === '/health') {
      if (method !== 'GET') return send(res, 405);
      return sendHealth(res, deps.isReady());
    }

    if (path !== '/cutout') return send(res, 404);
    if (method !== 'POST') return send(res, 405);

    // Авторизация — до всего остального: неавторизованный не должен узнать даже того,
    // готова ли модель. «Секрета нет» и «секрет неверный» дают один и тот же ответ.
    if (!deps.authorize(req.headers.authorization)) return send(res, 401);

    if (!deps.isReady()) return sendBusy(res, deps.retryAfterSeconds);

    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType === undefined || !ACCEPTED_TYPES.has(contentType)) return send(res, 400);

    const body = await readBody(req, deps.maxBodyBytes);
    if (body === TOO_LARGE) return send(res, 413);
    if (body === UNREADABLE) return send(res, 400);
    bytesIn = body.byteLength;

    const cutout = await deps.cutout(body);
    if (cutout === null) return send(res, 204); // штатный исход: товара не нашлось
    return send(res, 200, cutout, { 'content-type': 'image/png' });
  } catch (err) {
    if (err instanceof GateBusyError) return sendBusy(res, deps.retryAfterSeconds);
    if (err instanceof UnreadableImageError) return send(res, 400);
    // Наружу — только код. Ни стека, ни путей, ни имени модели (docs/TZ.md FR-10).
    log.error('request.failed', { method, path, reason: errorMessage(err) });
    return send(res, 500);
  } finally {
    // В журнал идут метод, код, длительность и размер — но не кадр и не вырез (FR-14).
    log.info('request', {
      method,
      path,
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
      bytesIn,
    });
  }
}

function sendHealth(res: http.ServerResponse, ready: boolean): void {
  // Ни версии, ни имени модели, ни путей: живость проверяет и тот, кто секрета не знает.
  const body = ready
    ? '{"status":"ok","ready":true}'
    : '{"status":"loading","ready":false}';
  send(res, ready ? 200 : 503, Buffer.from(body, 'utf8'), {
    'content-type': 'application/json',
  });
}

function sendBusy(res: http.ServerResponse, retryAfterSeconds: number): void {
  send(res, 503, undefined, { 'retry-after': String(retryAfterSeconds) });
}

function send(
  res: http.ServerResponse,
  status: number,
  body?: Buffer,
  headers: http.OutgoingHttpHeaders = {},
): void {
  if (body === undefined) {
    // Явный нулевой Content-Length вместо chunked: у 204 тела нет по определению, и Node сам
    // не поставит ни того, ни другого.
    res.writeHead(status, status === 204 ? headers : { ...headers, 'content-length': 0 });
    res.end();
    return;
  }
  res.writeHead(status, { ...headers, 'content-length': body.byteLength });
  res.end(body);
}

const TOO_LARGE = Symbol('too-large');
const UNREADABLE = Symbol('unreadable');

/** Тело — сырые байты кадра: ни JSON, ни multipart, ни base64. */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<Buffer | typeof TOO_LARGE | typeof UNREADABLE> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (value: Buffer | typeof TOO_LARGE | typeof UNREADABLE): void => {
      if (settled) return;
      settled = true;
      req.removeAllListeners('data');
      resolve(value);
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        req.pause();
        finish(TOO_LARGE);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', () => finish(UNREADABLE));
    req.on('aborted', () => finish(UNREADABLE));
  });
}
