import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { ActivationMismatchError, coverage, halftoneShare, sigmoid, toAlpha } from './mask';

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
