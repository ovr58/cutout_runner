/**
 * Арифметика маски. Чистые функции: ни модели, ни файлов, ни сети — поэтому проверяются
 * тестом без весов и без прогона инференса.
 */

/** Значение альфы, начиная с которого пиксель считается «товаром» (порог 0,5 от 255). */
const OPAQUE_THRESHOLD = 128;

/**
 * Чем выход модели превращается в маску. **Свойство модели, а не общий код.**
 *
 * - `sigmoid` — модель отдаёт **логиты** (BiRefNet). Нормировка по крайним значениям на
 *   логитах даёт визуально чистую маску и 99,9% полутона на кромке вместо 0,2–0,4%.
 * - `minmax` — модель отдаёт **готовую маску 0…1**, её растягивают по крайним значениям.
 *   Так устроено семейство U²-Net, в том числе `u2netp`: сигмоида стоит внутри графа, и
 *   вторая сигмоида поверх сожмёт маску в 0,5…0,73 — товар перестанет находиться вовсе.
 *
 * Перепутать их — отказ, который не видно глазами (docs/SPEC.md §9, docs/TZ.md FR-04).
 */
export type Activation = 'sigmoid' | 'minmax';

/**
 * Настройка активации спорит с тем, что модель на самом деле отдала. Отдельный класс нужен,
 * чтобы этот случай нельзя было спутать с поломкой картинки: причина всегда одна — в файле
 * окружения выбрана не та активация для этих весов.
 */
export class ActivationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivationMismatchError';
  }
}

/**
 * Допуск, внутри которого выход считается уже активированным. Сигмоида не выходит за 0…1,
 * поэтому запас нужен только на ошибку округления float32.
 */
const ACTIVATED_TOLERANCE = 0.01;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Сырой выход модели -> альфа 0…255 способом, который объявлен рядом с весами.
 *
 * Диапазон выхода проверяется до счёта: он сам говорит, логиты это или готовая маска, и если
 * он спорит с настройкой — считать нечего. Проверка существует затем, что иначе перепутанная
 * активация не падает, а тихо портит результат; ложное срабатывание возможно только на кадре,
 * где ВСЕ логиты уместились в 0…1, а такой кадр и без того ушёл бы в 204 «товара нет».
 */
export function toAlpha(raw: Float32Array, activation: Activation): Uint8Array {
  const alpha = new Uint8Array(raw.length);
  if (raw.length === 0) return alpha;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i] as number;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const looksActivated = min >= -ACTIVATED_TOLERANCE && max <= 1 + ACTIVATED_TOLERANCE;
  if (activation === 'minmax' && !looksActivated) {
    throw new ActivationMismatchError(
      `activation=minmax, but model output spans [${min.toFixed(2)}, ${max.toFixed(2)}] — ` +
        'these are logits; set CUTOUT_ACTIVATION=sigmoid for this model',
    );
  }
  if (activation === 'sigmoid' && looksActivated) {
    throw new ActivationMismatchError(
      `activation=sigmoid, but model output spans [${min.toFixed(2)}, ${max.toFixed(2)}] — ` +
        'the mask is already activated; set CUTOUT_ACTIVATION=minmax for this model',
    );
  }

  // Знаменатель защищён не от красоты: у пустой маски все значения равны, и без него вся
  // альфа стала бы NaN -> 0, то есть «товара нет» вместо честного отказа.
  const span = max - min || 1;
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i] as number;
    const unit = activation === 'sigmoid' ? sigmoid(value) : (value - min) / span;
    alpha[i] = Math.round(unit * 255);
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
 *
 * Мерой КАЧЕСТВА выреза не является: пустая маска даёт идеальные 0% (замер B19, шаг 3).
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
