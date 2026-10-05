/**
 * Разбор тела `POST /layout` — чистая функция, без браузера и без HTTP.
 *
 * HTML пишет модель родительского продукта, значит это **недоверенный ввод**. Настоящая граница —
 * Chromium без сети и без JS (`scene.ts`); здесь — быстрый отказ на том, что подмножество вёрстки
 * запрещает заведомо: `<script>` и `url(…)` на что-либо, кроме `frame.png`. Отказ (`refused`)
 * отличается от неразборчивого тела (`invalid`): первое — штатное «эту карточку не снять», на
 * которое вызывающий откатывается к библиотеке макетов; второе — ошибка вызывающего кода.
 */

export interface Canvas {
  readonly width: number;
  readonly height: number;
}

export interface LayoutRequest {
  readonly html: string;
  readonly canvas: Canvas;
  /** Кадр карточки — байты из data-URI тела, отдаются странице как `frame.png`. */
  readonly frame: Buffer;
  readonly frameType: 'image/png' | 'image/jpeg';
}

export type ParsedLayoutRequest =
  | { readonly kind: 'request'; readonly request: LayoutRequest }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'refused'; readonly reason: 'script' | 'url' };

/** Холст карточки — единицы тысяч пикселей; больше — не карточка, а попытка занять память. */
const MAX_SIDE = 4096;

const FRAME_URI = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const SCRIPT = /<script\b/i;
const URL_REF = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export function parseLayoutRequest(body: Buffer): ParsedLayoutRequest {
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof value !== 'object' || value === null) return { kind: 'invalid' };
  const { html, canvas, frame } = value as Record<string, unknown>;

  if (typeof html !== 'string' || html === '') return { kind: 'invalid' };
  if (!isCanvas(canvas)) return { kind: 'invalid' };
  const uri = typeof frame === 'string' ? FRAME_URI.exec(frame) : null;
  if (uri === null) return { kind: 'invalid' };

  if (SCRIPT.test(html)) return { kind: 'refused', reason: 'script' };
  for (const [, , target] of html.matchAll(URL_REF)) {
    if (target !== 'frame.png') return { kind: 'refused', reason: 'url' };
  }

  return {
    kind: 'request',
    request: {
      html,
      canvas: { width: canvas.width, height: canvas.height },
      frame: Buffer.from(uri[2] ?? '', 'base64'),
      frameType: uri[1] === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    },
  };
}

function isCanvas(value: unknown): value is Canvas {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height } = value as Record<string, unknown>;
  return isSide(width) && isSide(height);
}

function isSide(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SIDE;
}
