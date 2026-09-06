import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  ActivationMismatchError,
  coverage,
  fillHoles,
  halftoneShare,
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

/**
 * Картинка маски строкой: `#` — товар (255), `.` — фон (0), `o` — полутон фоновой стороны
 * (100), `O` — полутон стороны товара (200). Полутон нужен затем, что главное требование к
 * заливке — не тронуть мягкую кромку.
 */
function picture(rows: readonly string[]): Uint8Array {
  const width = (rows[0] as string).length;
  const alpha = new Uint8Array(rows.length * width);
  rows.forEach((row, y) => {
    assert.equal(row.length, width, 'строки картинки должны быть одной длины');
    for (let x = 0; x < width; x += 1) {
      const cell = row[x] as string;
      alpha[y * width + x] = cell === '#' ? 255 : cell === 'O' ? 200 : cell === 'o' ? 100 : 0;
    }
  });
  return alpha;
}

/** Обратно в строки — так расхождение видно глазами, а не как индекс в тысячном массиве. */
function render(alpha: Uint8Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < alpha.length / width; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) {
      const value = alpha[y * width + x] as number;
      row += value === 255 ? '#' : value === 200 ? 'O' : value === 100 ? 'o' : value === 0 ? '.' : '?';
    }
    rows.push(row);
  }
  return rows;
}

describe('fillHoles', () => {
  /** Рамка товара 8 пикселей с одной запертой дырой в 1 пиксель: доля дыры 1/8 = 0,125. */
  const ring = ['.....', '.###.', '.#.#.', '.###.', '.....'];

  test('дыра мельче порога заливается', () => {
    assert.deepEqual(render(fillHoles(picture(ring), 5, 5, 0.2), 5), [
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
  });

  test('дыра крупнее порога остаётся — это настоящий просвет', () => {
    // Дужки очков и промежутки между ножками кресла живут ровно этим порогом.
    assert.deepEqual(render(fillHoles(picture(ring), 5, 5, 0.1), 5), ring);
  });

  test('нулевой порог выключает заливку', () => {
    assert.deepEqual(render(fillHoles(picture(ring), 5, 5, 0), 5), ring);
  });

  test('фон, связанный с краем кадра, не заливается никогда', () => {
    // Сквозная щель шириной в пиксель выходит на верх и низ кадра — она не заперта контуром,
    // и порог площади к ней неприменим даже при заливке «чего угодно».
    const slit = ['##.##', '##.##', '##.##'];
    assert.deepEqual(render(fillHoles(picture(slit), 5, 3, 1), 5), slit);
  });

  test('мягкая кромка остаётся мягкой', () => {
    // Требование, которое нельзя нарушить: наружу уезжает альфа 0…255, бинаризация — только
    // внутри. Полутон снаружи контура граничит с фоном до края кадра, значит он «снаружи».
    const soft = [
      '.........',
      '.ooooooo.',
      '.oO###Oo.',
      '.oO#.#Oo.',
      '.oO###Oo.',
      '.ooooooo.',
      '.........',
    ];
    const filled = fillHoles(picture(soft), 9, 7, 0.2);
    assert.deepEqual(render(filled, 9), [
      '.........',
      '.ooooooo.',
      '.oO###Oo.',
      '.oO###Oo.',
      '.oO###Oo.',
      '.ooooooo.',
      '.........',
    ]);
    assert.ok(halftoneShare(filled) > 0, 'значения строго между 0 и 255 обязаны уцелеть');
  });

  test('товар от края до края: маска становится сплошной и уходит в отсечку', () => {
    // Патологический случай: фона у краёв нет вовсе, флудфилл не помечает ничего, и весь
    // внутренний фон читается как дыра. Исход правильный — вырез, совпадающий с кадром,
    // бессмыслен, и его режет maxCoverage.
    const edgeToEdge = ['#####', '#.###', '#####'];
    const filled = fillHoles(picture(edgeToEdge), 5, 3, 0.2);
    assert.deepEqual(render(filled, 5), ['#####', '#####', '#####']);
    assert.equal(coverage(filled), 1);
  });

  test('пустая маска не заливается: товара нет — нет и площади под порог', () => {
    const empty = new Uint8Array(25);
    assert.deepEqual([...fillHoles(empty, 5, 5, 1)], [...empty]);
    assert.equal(fillHoles(new Uint8Array(0), 0, 0, 0.2).length, 0);
  });

  test('вход не мутируется — функция чистая', () => {
    const source = picture(ring);
    fillHoles(source, 5, 5, 0.2);
    assert.deepEqual(render(source, 5), ring);
  });

  test('несогласованная геометрия — отказ, а не молча съехавшая маска', () => {
    assert.throws(() => fillHoles(new Uint8Array(24), 5, 5, 0.2), /expected/);
  });
});
