import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { coverage, halftoneShare, logitsToAlpha, sigmoid } from './mask';

describe('sigmoid', () => {
  test('переводит логит в 0…1', () => {
    assert.equal(sigmoid(0), 0.5);
    assert.ok(sigmoid(-20) < 1e-8);
    assert.ok(sigmoid(20) > 1 - 1e-8);
  });
});

describe('logitsToAlpha', () => {
  test('насыщенные логиты дают 0 и 255', () => {
    const alpha = logitsToAlpha(Float32Array.from([-20, 0, 20]));
    assert.deepEqual([...alpha], [0, 128, 255]);
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

describe('ловушка активации', () => {
  /**
   * Тот самый случай, ради которого способ активации записан как свойство модели.
   * Логиты сегментации сильно поляризованы; сигмоида их насыщает, а нормировка по крайним
   * значениям — растягивает, и кромка становится почти сплошным полутоном (docs/SPEC.md §9).
   */
  const logits = Float32Array.from(
    Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? -30 : 30) + Math.sin(i) * 3),
  );

  test('сигмоида даёт чистую кромку', () => {
    assert.ok(
      halftoneShare(logitsToAlpha(logits)) <= 0.01,
      'доля полутона у правильной активации — единицы десятых процента (docs/TZ.md FR-04)',
    );
  });

  test('min-max нормировка на тех же логитах даёт почти сплошной полутон', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const value of logits) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const normalized = new Uint8Array(logits.length);
    for (let i = 0; i < logits.length; i += 1) {
      normalized[i] = Math.round((((logits[i] as number) - min) / (max - min)) * 255);
    }

    assert.ok(
      halftoneShare(normalized) > 0.9,
      'если эта проверка когда-нибудь перестанет падать в другую сторону — значит активацию поменяли',
    );
  });
});
