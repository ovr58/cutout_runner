import sharp from 'sharp';

import type { Segmenter } from '../model/session';
import { coverage, logitsToAlpha } from './mask';

/**
 * Кадр -> вырез. Этот слой ничего не знает про HTTP: «выреза нет» выражается значением `null`,
 * а не статусом 204 — статус ставит src/http/server.ts.
 *
 * Весь путь целиком — схема V-04 в docs/VISUALS.md.
 */

/** Тело не разбирается как изображение. Наружу превращается в 400. */
export class UnreadableImageError extends Error {
  constructor(cause: unknown) {
    super('image is not readable');
    this.name = 'UnreadableImageError';
    this.cause = cause;
  }
}

export interface CutoutThresholds {
  readonly minCoverage: number;
  readonly maxCoverage: number;
}

/**
 * Нормировка входа BiRefNet: те же константы, на которых обучалась его основа.
 * Источник — сессия `birefnet_general` из rembg (docs/VISUALS.md, раздел «Референсы»).
 */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/**
 * Потолок на разжатый кадр. Тело ограничивает nginx, но сжатый PNG разворачивается в куда
 * больший растр, а память процесса ограничена `MemoryMax` в unit systemd. Рабочий кадр —
 * 1440×1920 = 2,8 Мп, так что запас восемнадцатикратный.
 */
const MAX_INPUT_PIXELS = 50_000_000;

export async function computeCutout(
  body: Buffer,
  segmenter: Segmenter,
  thresholds: CutoutThresholds,
): Promise<Buffer | null> {
  const frame = await decodeRgb(body);
  const size = segmenter.inputSize;

  const resized = await sharp(frame.rgb, {
    raw: { width: frame.width, height: frame.height, channels: 3 },
  })
    // fit: 'fill' — соотношение сторон сознательно не сохраняется: модель обучалась на
    // квадратном входе, а маска всё равно растягивается обратно к точным W×H кадра.
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  const logits = await segmenter.run(toTensor(resized, size));
  if (logits.length !== size * size) {
    throw new Error(`model returned ${logits.length} values, expected ${size * size}`);
  }

  const alpha = logitsToAlpha(logits);
  const covered = coverage(alpha);
  if (covered < thresholds.minCoverage || covered > thresholds.maxCoverage) {
    return null; // товара не нашлось — штатный исход, вызывающий снимет слой
  }

  // Маска растягивается к ТОЧНЫМ размерам кадра: вызывающий проверяет размер по самому файлу
  // и вырез другого размера отвергает как отказ (docs/TZ.md FR-05).
  const alphaFull = await resizeMask(alpha, size, frame.width, frame.height);

  // RGB берётся из исходного растра нетронутым: приём «текст за товаром» работает ровно
  // потому, что оба слоя — один растр, пиксель в пиксель (docs/TZ.md FR-06).
  return sharp(frame.rgb, { raw: { width: frame.width, height: frame.height, channels: 3 } })
    .joinChannel(alphaFull, { raw: { width: frame.width, height: frame.height, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Маска модельного разрешения -> альфа размера кадра, строго ОДИН канал.
 *
 * Одноканальность приходится требовать явно: на одноканальном сыром входе sharp возвращает
 * результат в трёх каналах, и `joinChannel` получает буфер втрое длиннее, чем ему обещано.
 * Ошибки при этом не будет — будет молча съехавшая на чужой шаг строки альфа: полосы вместо
 * выреза. Отказ, который видно только глазами на готовой карточке.
 */
async function resizeMask(
  alpha: Uint8Array,
  size: number,
  width: number,
  height: number,
): Promise<Buffer> {
  const { data, info } = await sharp(
    Buffer.from(alpha.buffer, alpha.byteOffset, alpha.byteLength),
    { raw: { width: size, height: size, channels: 1 } },
  )
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 1 || data.byteLength !== width * height) {
    throw new Error(
      `mask resize produced ${info.channels} channel(s), ${data.byteLength} bytes; ` +
        `expected 1 channel, ${width * height} bytes`,
    );
  }
  return data;
}

interface DecodedFrame {
  readonly rgb: Buffer;
  readonly width: number;
  readonly height: number;
}

async function decodeRgb(body: Buffer): Promise<DecodedFrame> {
  try {
    const { data, info } = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
      // Приводим к трём каналам явно: полутоновый или CMYK-кадр иначе дал бы другое число
      // каналов, и сборка RGBA развалилась бы уже после инференса.
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3 || info.width < 1 || info.height < 1) {
      throw new Error(`unexpected raw geometry: ${info.width}x${info.height}x${info.channels}`);
    }
    return { rgb: data, width: info.width, height: info.height };
  } catch (err) {
    throw new UnreadableImageError(err);
  }
}

/** Плоский RGB -> тензор NCHW 1×3×size×size с ImageNet-нормировкой. */
function toTensor(rgb: Buffer, size: number): Float32Array {
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const base = i * 3;
    for (let c = 0; c < 3; c += 1) {
      tensor[c * plane + i] =
        ((rgb[base + c] as number) / 255 - (MEAN[c] as number)) / (STD[c] as number);
    }
  }
  return tensor;
}
