/**
 * Арифметика маски. Чистые функции: ни модели, ни файлов, ни сети — поэтому проверяются
 * тестом без весов и без прогона инференса.
 */

/** Значение альфы, начиная с которого пиксель считается «товаром» (порог 0,5 от 255). */
const OPAQUE_THRESHOLD = 128;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Логиты BiRefNet -> альфа 0…255.
 *
 * **Сигмоида, и только она.** BiRefNet отдаёт логиты; нормировка по крайним значениям
 * (`(x - min) / (max - min)`) на логитах даёт визуально чистую маску и 99,9% полутона на
 * кромке вместо измеренных 0,2–0,4%. Способ активации — свойство модели, а не общий код:
 * семейство U²-Net отдаёт готовую маску, и там нужна как раз нормировка (docs/SPEC.md §9,
 * docs/TZ.md FR-04).
 */
export function logitsToAlpha(logits: Float32Array): Uint8Array {
  const alpha = new Uint8Array(logits.length);
  for (let i = 0; i < logits.length; i += 1) {
    alpha[i] = Math.round(sigmoid(logits[i] as number) * 255);
  }
  return alpha;
}

/**
 * Доля кадра, занятая товаром по бинаризованной маске. Меньше `minCoverage` — резать нечего;
 * больше `maxCoverage` — вырез совпадает с кадром и слой бессмыслен. И то и другое — 204
 * (docs/TZ.md FR-07).
 */
export function coverage(alpha: Uint8Array): number {
  if (alpha.length === 0) return 0;
  let opaque = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    if ((alpha[i] as number) >= OPAQUE_THRESHOLD) opaque += 1;
  }
  return opaque / alpha.length;
}

/**
 * Доля пикселей строго между 0 и 255 — мера мягкости кромки. Существует затем, что именно по
 * ней ловится перепутанная активация: на логитах с нормировкой это число уходит к 99,9%.
 */
export function halftoneShare(alpha: Uint8Array): number {
  if (alpha.length === 0) return 0;
  let halftone = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    const value = alpha[i] as number;
    if (value > 0 && value < 255) halftone += 1;
  }
  return halftone / alpha.length;
}
