import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  ActivationMismatchError,
  coverage,
  downscaleByArea,
  halftoneShare,
  MASK_LONG_SIDE,
  maskDimensions,
  sigmoid,
  toAlpha,
} from './mask';

describe('sigmoid', () => {
  test('переводит логит в 0…1', () => {
    assert.equal(sigmoid(0), 0.5);
    assert.ok(sigmoid(-20) < 1e-8);
    assert.ok(sigmoid(20) > 1 - 1e-8);
  });
});

describe('toAlpha', () => {
  test('sigmoid: насыщенные логиты дают 0 и 255', () => {
    const alpha = toAlpha(Float32Array.from([-20, 0, 20]), 'sigmoid');
    assert.deepEqual([...alpha], [0, 128, 255]);
  });

  test('minmax: готовая маска растягивается по крайним значениям', () => {
    const alpha = toAlpha(Float32Array.from([0.25, 0.5, 0.75]), 'minmax');
    assert.deepEqual([...alpha], [0, 128, 255]);
  });

  test('minmax: одинаковые значения не дают NaN', () => {
    const alpha = toAlpha(Float32Array.from([0.4, 0.4, 0.4]), 'minmax');
    assert.deepEqual([...alpha], [0, 0, 0]);
  });

  test('пустой выход даёт пустую альфу', () => {
    assert.equal(toAlpha(new Float32Array(0), 'minmax').length, 0);
  });
});

describe('ловушка активации', () => {
  /**
   * Тот самый случай, ради которого способ активации записан как свойство модели.
   * Логиты сегментации сильно поляризованы; сигмоида их насыщает, а нормировка по крайним
   * значениям — растягивает, и кромка становится почти сплошным полутоном (docs/SPEC.md §9).
   */
  const logits = Float32Array.from(
    Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? -30 : 30) + Math.sin(i) * 3),
  );
  /** Готовая маска семейства U²-Net: сигмоида уже применена внутри графа. */
  const activated = Float32Array.from(logits, (value) => sigmoid(value));

  test('сигмоида на логитах даёт чистую кромку', () => {
    assert.ok(
      halftoneShare(toAlpha(logits, 'sigmoid')) <= 0.01,
      'доля полутона у правильной активации — единицы десятых процента (docs/TZ.md FR-04)',
    );
  });

  test('min-max на тех же логитах дал бы почти сплошной полутон', () => {
    // Считается вручную, потому что toAlpha такой вход больше не пропускает: это и есть
    // цена ошибки, от которой поставлена проверка ниже.
    let min = Infinity;
    let max = -Infinity;
    for (const value of logits) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const wrong = Uint8Array.from(logits, (value) => Math.round(((value - min) / (max - min)) * 255));
    assert.ok(halftoneShare(wrong) > 0.9);
  });

  test('min-max на логитах отвергается по диапазону', () => {
    assert.throws(() => toAlpha(logits, 'minmax'), ActivationMismatchError);
  });

  test('сигмоида на готовой маске отвергается по диапазону', () => {
    assert.throws(() => toAlpha(activated, 'sigmoid'), ActivationMismatchError);
  });

  test('готовая маска с min-max проходит и остаётся резкой', () => {
    assert.ok(halftoneShare(toAlpha(activated, 'minmax')) <= 0.01);
  });
});

describe('coverage', () => {
  test('считает долю пикселей товара по порогу 0,5', () => {
    assert.equal(coverage(Uint8Array.from([0, 0, 255, 255])), 0.5);
    assert.equal(coverage(Uint8Array.from([127, 128])), 0.5);
    assert.equal(coverage(new Uint8Array(0)), 0);
  });
});

describe('halftoneShare', () => {
  test('считает долю пикселей строго между 0 и 255', () => {
    assert.equal(halftoneShare(Uint8Array.from([0, 255, 128, 254])), 0.5);
  });
});

describe('maskDimensions', () => {
  test('длинная сторона — 256, короткая — в пропорции кадра', () => {
    assert.equal(MASK_LONG_SIDE, 256);
    assert.deepEqual(maskDimensions(1440, 1920), { width: 192, height: 256 });
    assert.deepEqual(maskDimensions(1920, 1440), { width: 256, height: 192 });
    assert.deepEqual(maskDimensions(100, 100), { width: 256, height: 256 });
  });

  test('короткая сторона округляется, а не отбрасывается', () => {
    // 256·91/137 = 170,05 -> 170; 256·90/137 = 168,18 -> 168; 256·93/137 = 173,78 -> 174.
    assert.deepEqual(maskDimensions(137, 91), { width: 256, height: 170 });
    assert.deepEqual(maskDimensions(91, 137), { width: 170, height: 256 });
    assert.deepEqual(maskDimensions(137, 93), { width: 256, height: 174 });
  });

  test('вырожденно вытянутый кадр не даёт нулевую сторону', () => {
    assert.deepEqual(maskDimensions(1, 5000), { width: 1, height: 256 });
  });

  test('кадр меньше 256 тоже приводится к длинной стороне 256', () => {
    assert.deepEqual(maskDimensions(16, 8), { width: 256, height: 128 });
  });
});

describe('downscaleByArea', () => {
  test('ячейка — среднее по площади, полутон сохраняется', () => {
    // Два пикселя 0 и 255 в одну ячейку: 127,5 -> 128. Порог дал бы 0 или 255.
    assert.deepEqual([...downscaleByArea(Uint8Array.from([0, 255]), 2, 1, 1, 1)], [128]);
    assert.deepEqual([...downscaleByArea(Uint8Array.from([0, 255, 255, 0]), 2, 2, 1, 1)], [128]);
  });

  test('целая кратность: блоки усредняются независимо', () => {
    // 4×2 -> 2×1: левый блок 2×2 = (10+20+30+40)/4 = 25, правый = (100+100+200+200)/4 = 150.
    const alpha = Uint8Array.from([10, 20, 100, 100, 30, 40, 200, 200]);
    assert.deepEqual([...downscaleByArea(alpha, 4, 2, 2, 1)], [25, 150]);
  });

  test('дробная кратность: пиксель делится между ячейками по площади', () => {
    // 3 -> 2: ячейка 0 = [0; 1,5) = (0·1 + 90·0,5)/1,5 = 30; ячейка 1 = (90·0,5 + 180·1)/1,5 = 150.
    assert.deepEqual([...downscaleByArea(Uint8Array.from([0, 90, 180]), 3, 1, 2, 1)], [30, 150]);
    // То же по вертикали.
    assert.deepEqual([...downscaleByArea(Uint8Array.from([0, 90, 180]), 1, 3, 1, 2)], [30, 150]);
  });

  test('постоянная альфа остаётся постоянной при любых размерах', () => {
    for (const [w, h, ow, oh] of [
      [7, 5, 3, 2],
      [1440, 1920, 192, 256],
      [5, 7, 11, 13],
    ] as const) {
      const out = downscaleByArea(new Uint8Array(w * h).fill(200), w, h, ow, oh);
      assert.equal(out.length, ow * oh);
      assert.ok(out.every((v) => v === 200), `${w}x${h} -> ${ow}x${oh}`);
    }
  });

  test('совпадает с прямым подсчётом площадей на произвольных размерах', () => {
    // Эталон — перекрытие прямоугольников в числах с плавающей точкой, без целочисленных весов.
    for (const [w, h, ow, oh] of [
      [9, 7, 4, 3],
      [13, 5, 6, 5],
      [6, 11, 7, 4],
    ] as const) {
      const alpha = Uint8Array.from({ length: w * h }, (_, i) => (i * 37 + 11) % 256);
      const out = downscaleByArea(alpha, w, h, ow, oh);
      for (let oy = 0; oy < oh; oy += 1) {
        for (let ox = 0; ox < ow; ox += 1) {
          const x0 = (ox * w) / ow;
          const x1 = ((ox + 1) * w) / ow;
          const y0 = (oy * h) / oh;
          const y1 = ((oy + 1) * h) / oh;
          let sum = 0;
          for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
            for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
              const overlap =
                (Math.min(x1, x + 1) - Math.max(x0, x)) * (Math.min(y1, y + 1) - Math.max(y0, y));
              sum += overlap * (alpha[y * w + x] as number);
            }
          }
          const expected = sum / ((x1 - x0) * (y1 - y0));
          const actual = out[oy * ow + ox] as number;
          assert.ok(
            Math.abs(actual - expected) <= 0.5 + 1e-9,
            `${w}x${h} -> ${ow}x${oh} (${ox},${oy}): ${actual} против ${expected}`,
          );
        }
      }
    }
  });

  test('строки идут сверху вниз: верх и низ не путаются', () => {
    const alpha = Uint8Array.from([0, 0, 255, 255]); // верхняя строка 0, нижняя 255
    assert.deepEqual([...downscaleByArea(alpha, 2, 2, 1, 2)], [0, 255]);
    assert.deepEqual([...downscaleByArea(alpha, 2, 2, 2, 1)], [128, 128]);
  });

  test('длина входа не по размерам — явная ошибка', () => {
    assert.throws(() => downscaleByArea(new Uint8Array(5), 2, 3, 1, 1), /expected 6/);
  });
});
