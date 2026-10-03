import sharp from 'sharp';

import type { Segmenter } from '../model/session';
import { type Activation, coverage, downscaleByArea, maskDimensions, toAlpha } from './mask';

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

export interface CutoutSettings {
  readonly minCoverage: number;
  readonly maxCoverage: number;
  /** Чем выход модели превращается в маску — свойство весов, приходит из конфигурации. */
  readonly activation: Activation;
}

/**
 * Нормировка входа: константы ImageNet, на которых обучались основы обеих моделей.
 * Источник — сессии `birefnet_general` и `u2netp` из rembg: у второй те же mean/std, меняется
 * только сторона входа (docs/VISUALS.md, раздел «Референсы»).
 */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/**
 * Потолок на разжатый кадр. Тело ограничивает nginx, но сжатый PNG разворачивается в куда
 * больший растр, а память процесса ограничена `MemoryMax` в unit systemd. Рабочий кадр —
 * 1440×1920 = 2,8 Мп, так что запас восемнадцатикратный.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** Кадр и альфа его размера: общий результат инференса для выреза и для сэмплов маски. */
interface FrameAlpha {
  readonly frame: DecodedFrame;
  /** Один канал, `frame.width × frame.height` байт, строки сверху вниз. */
  readonly alpha: Buffer;
}

/**
 * Кадр -> альфа размера кадра, либо `null` — «товара не нашлось».
 *
 * Единственное место, где решается, есть ли в кадре товар: `/cutout` и `/mask` обязаны
 * отвечать 204 на одних и тех же кадрах (ADR-0018 п. 4 Merch Kit), поэтому условие не копируется.
 */
async function computeFrameAlpha(
  body: Buffer,
  segmenter: Segmenter,
  settings: CutoutSettings,
): Promise<FrameAlpha | null> {
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

  const raw = await segmenter.run(toTensor(resized, size));
  if (raw.length !== size * size) {
    throw new Error(`model returned ${raw.length} values, expected ${size * size}`);
  }

  const alpha = toAlpha(raw, settings.activation);
  const covered = coverage(alpha);
  if (covered < settings.minCoverage || covered > settings.maxCoverage) {
    return null; // товара не нашлось — штатный исход, вызывающий снимет слой
  }

  // Маска растягивается к ТОЧНЫМ размерам кадра: вызывающий проверяет размер по самому файлу
  // и вырез другого размера отвергает как отказ (docs/TZ.md FR-05).
  return { frame, alpha: await resizeMask(alpha, size, frame.width, frame.height) };
}

export async function computeCutout(
  body: Buffer,
  segmenter: Segmenter,
  settings: CutoutSettings,
): Promise<Buffer | null> {
  const found = await computeFrameAlpha(body, segmenter, settings);
  if (found === null) return null;
  const { frame, alpha } = found;

  // RGB берётся из исходного растра нетронутым: приём «текст за товаром» работает ровно
  // потому, что оба слоя — один растр, пиксель в пиксель (docs/TZ.md FR-06).
  return sharp(frame.rgb, { raw: { width: frame.width, height: frame.height, channels: 3 } })
    .joinChannel(alpha, { raw: { width: frame.width, height: frame.height, channels: 1 } })
    .png()
    .toBuffer();
}

/** Сэмплы альфы: `width × height` байт 0…255 построчно сверху вниз (docs/SPEC.md §5). */
export interface MaskSamples {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

/**
 * Кадр -> сэмплы альфы, либо `null` — «товара не нашлось» (то же суждение, что у выреза).
 * Берётся альфа в размере кадра до наложения на кадр и уменьшается усреднением по площади,
 * без порога.
 */
export async function computeMask(
  body: Buffer,
  segmenter: Segmenter,
  settings: CutoutSettings,
): Promise<MaskSamples | null> {
  const found = await computeFrameAlpha(body, segmenter, settings);
  if (found === null) return null;
  const { frame, alpha } = found;

  const { width, height } = maskDimensions(frame.width, frame.height);
  const data = downscaleByArea(alpha, frame.width, frame.height, width, height);
  return { width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
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
