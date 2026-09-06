import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import sharp from 'sharp';

import type { Segmenter } from '../model/session';
import { ActivationMismatchError, halftoneShare } from './mask';
import { computeCutout, UnreadableImageError } from './pipeline';

/** Маленький вход: тесты проверяют геометрию и арифметику, а не качество сегментации. */
const INPUT_SIZE = 16;

const SETTINGS = {
  minCoverage: 0.01,
  maxCoverage: 0.99,
  maxHoleShare: 0.02,
  activation: 'sigmoid',
} as const;

/**
 * Модель подменяется заглушкой: настоящие веса в git не идут, а прогон настоящей модели
 * зависит от машины (docs/SPEC.md §7). Заглушка отдаёт ровно тот сырой выход, который
 * задал тест — здесь это логиты, поэтому активация в SETTINGS сигмоидная.
 */
function fakeSegmenter(fill: (index: number, size: number) => number): Segmenter {
  return {
    inputSize: INPUT_SIZE,
    async run(input: Float32Array): Promise<Float32Array> {
      assert.equal(input.length, 3 * INPUT_SIZE * INPUT_SIZE, 'ожидается тензор NCHW 1×3×S×S');
      return Float32Array.from({ length: INPUT_SIZE * INPUT_SIZE }, (_, i) =>
        fill(i, INPUT_SIZE),
      );
    },
  };
}

/** Левая половина кадра — товар, правая — фон. Покрытие ~50%. */
const halfAndHalf = fakeSegmenter((i, size) => ((i % size) < size / 2 ? 30 : -30));

/**
 * Рамка товара 12×12 с запертой дырой 8×8 внутри. До заливки товар — 80 px из 256
 * (coverage 0,3125), после — 144 (0,5625). Доля дыры от площади товара 0,8, поэтому порог
 * заливки в тесте задаётся заведомо выше.
 */
const ringWithHole = fakeSegmenter((i, size) => {
  const x = i % size;
  const y = Math.floor(i / size);
  const outer = x >= 2 && x <= 13 && y >= 2 && y <= 13;
  const inner = x >= 4 && x <= 11 && y >= 4 && y <= 11;
  return outer && !inner ? 30 : -30;
});

/** Пёстрый кадр, чтобы совпадение RGB проверялось не на однотонной заливке. */
async function makeFrame(width: number, height: number): Promise<{ png: Buffer; rgb: Buffer }> {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = (i * 7) % 256;
    rgb[i * 3 + 1] = (i * 13 + 40) % 256;
    rgb[i * 3 + 2] = (i * 29 + 90) % 256;
  }
  const png = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return { png, rgb };
}

describe('computeCutout', () => {
  test('размер ответа совпадает с размером кадра — на любых сторонах', async () => {
    // Вызывающий проверяет размер по самому файлу и вырез другого размера отвергает
    // как отказ (docs/TZ.md FR-05).
    for (const [width, height] of [
      [16, 16],
      [137, 91],
      [1, 5],
      [240, 320],
    ] as const) {
      const { png } = await makeFrame(width, height);
      const cutout = await computeCutout(png, halfAndHalf, SETTINGS);
      assert.ok(cutout !== null, `${width}x${height}: ожидался вырез`);

      const meta = await sharp(cutout).metadata();
      assert.equal(meta.width, width);
      assert.equal(meta.height, height);
      assert.equal(meta.format, 'png');
      assert.equal(meta.channels, 4, 'в ответе должен быть альфа-канал');
    }
  });

  test('RGB ответа совпадает с кадром пиксель в пиксель', async () => {
    // На этом стоит весь приём «текст за товаром»: оба слоя — один растр (docs/TZ.md FR-06).
    const { png, rgb } = await makeFrame(97, 53);
    const cutout = await computeCutout(png, halfAndHalf, SETTINGS);
    assert.ok(cutout !== null);

    const back = await sharp(cutout).removeAlpha().raw().toBuffer();
    assert.equal(Buffer.compare(back, rgb), 0);
  });

  test('альфа непостоянна и почти без полутона', async () => {
    const { png } = await makeFrame(64, 64);
    const cutout = await computeCutout(png, halfAndHalf, SETTINGS);
    assert.ok(cutout !== null);

    const alpha = await sharp(cutout).extractChannel(3).raw().toBuffer();
    const values = new Uint8Array(alpha.buffer, alpha.byteOffset, alpha.byteLength);
    assert.ok(values.includes(0) && values.includes(255), 'альфа должна быть непостоянной');
    // Полутон остаётся только на самой кромке после ресайза маски (docs/TZ.md FR-04).
    assert.ok(halftoneShare(values) < 0.05, `доля полутона ${halftoneShare(values)}`);
  });

  test('альфа лежит там же, где товар на маске — на кадре любых пропорций', async () => {
    // Проверка геометрии, а не только гистограммы. Ловит подмену числа каналов при ресайзе
    // маски: буфер втрое длиннее обещанного съезжает на чужой шаг строки, и вместо выреза
    // получаются полосы — ошибка, которую «доля полутона» и «альфа непостоянна» пропускают.
    for (const [width, height] of [
      [120, 80],
      [61, 173],
    ] as const) {
      const { png } = await makeFrame(width, height);
      const cutout = await computeCutout(png, halfAndHalf, SETTINGS);
      assert.ok(cutout !== null);

      const alpha = await sharp(cutout).extractChannel(3).raw().toBuffer();
      assert.equal(alpha.byteLength, width * height, `${width}x${height}: длина альфы`);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = alpha[y * width + x] as number;
          // Кромка приходится на середину; проверяются заведомо однозначные полосы по краям.
          if (x < width * 0.3) {
            assert.equal(value, 255, `${width}x${height}: (${x},${y}) должен быть товаром`);
          } else if (x > width * 0.7) {
            assert.equal(value, 0, `${width}x${height}: (${x},${y}) должен быть фоном`);
          }
        }
      }
    }
  });

  test('товара не нашлось — null, а не мусорная маска', async () => {
    const { png } = await makeFrame(32, 32);

    const nothing = fakeSegmenter(() => -30); // покрытие 0%
    assert.equal(await computeCutout(png, nothing, SETTINGS), null);

    const everything = fakeSegmenter(() => 30); // покрытие 100% — слой бессмыслен
    assert.equal(await computeCutout(png, everything, SETTINGS), null);
  });

  test('порог берётся из настроек, а не зашит в код', async () => {
    const { png } = await makeFrame(32, 32);
    // Половина кадра: проходит при пороге 0,01…0,99 и не проходит при 0,6…0,99.
    assert.notEqual(await computeCutout(png, halfAndHalf, SETTINGS), null);
    assert.equal(
      await computeCutout(png, halfAndHalf, { ...SETTINGS, minCoverage: 0.6 }),
      null,
    );
  });

  test('JPEG на входе тоже принимается', async () => {
    const { png } = await makeFrame(48, 32);
    const jpeg = await sharp(png).jpeg().toBuffer();
    const cutout = await computeCutout(jpeg, halfAndHalf, SETTINGS);
    assert.ok(cutout !== null);
    const meta = await sharp(cutout).metadata();
    assert.equal(meta.width, 48);
    assert.equal(meta.height, 32);
  });

  test('неразбираемое тело — UnreadableImageError, а не пятисотка', async () => {
    await assert.rejects(
      computeCutout(Buffer.from('это не картинка'), halfAndHalf, SETTINGS),
      UnreadableImageError,
    );
    await assert.rejects(
      computeCutout(Buffer.alloc(0), halfAndHalf, SETTINGS),
      UnreadableImageError,
    );
  });

  test('несовпадение формы выхода модели — явная ошибка, а не тихий брак', async () => {
    const wrongShape: Segmenter = {
      inputSize: INPUT_SIZE,
      async run() {
        return new Float32Array(INPUT_SIZE * INPUT_SIZE - 1);
      },
    };
    const { png } = await makeFrame(32, 32);
    await assert.rejects(computeCutout(png, wrongShape, SETTINGS), /expected/);
  });

  test('готовая маска U²-Net проходит через min-max', async () => {
    // Тот же кадр и тот же товар, но модель отдаёт уже активированный выход 0…1.
    const activated = fakeSegmenter((i, size) => ((i % size) < size / 2 ? 0.98 : 0.02));
    const { png } = await makeFrame(32, 32);
    const cutout = await computeCutout(png, activated, { ...SETTINGS, activation: 'minmax' });
    assert.ok(cutout !== null);

    const { data, info } = await sharp(cutout)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.equal(data[3], 255, 'левый край — товар');
    assert.equal(data[(32 - 1) * 4 + 3], 0, 'правый край — фон');
  });

  test('перепутанная активация — явная ошибка, а не тихий брак', async () => {
    // Логиты, поданные как готовая маска: именно этот случай раньше проходил молча
    // и портил кромку (docs/SPEC.md §9).
    const { png } = await makeFrame(32, 32);
    await assert.rejects(
      computeCutout(png, halfAndHalf, { ...SETTINGS, activation: 'minmax' }),
      ActivationMismatchError,
    );
  });
});

describe('заливка дыр в конвейере', () => {
  /** Порог отсечения между покрытием до заливки (0,3125) и после (0,5625). */
  const BETWEEN = { ...SETTINGS, minCoverage: 0.4 } as const;

  test('coverage считается ПОСЛЕ заливки, а не до неё', async () => {
    // Порядок принципиален: заливка увеличивает долю товара, и отсечение обязано судить о
    // той маске, которая уедет наружу. Тест ловит перестановку строк местами.
    const { png } = await makeFrame(16, 16);

    assert.notEqual(
      await computeCutout(png, ringWithHole, { ...BETWEEN, maxHoleShare: 0.9 }),
      null,
      'с залитой дырой покрытие 0,5625 > 0,4 — вырез должен состояться',
    );
    assert.equal(
      await computeCutout(png, ringWithHole, { ...BETWEEN, maxHoleShare: 0 }),
      null,
      'без заливки покрытие 0,3125 < 0,4 — честное «товара нет»',
    );
  });

  test('дыра в готовом вырезе действительно залита', async () => {
    const { png } = await makeFrame(16, 16);
    const cutout = await computeCutout(png, ringWithHole, { ...SETTINGS, maxHoleShare: 0.9 });
    assert.ok(cutout !== null);

    const alpha = await sharp(cutout).extractChannel('alpha').raw().toBuffer();
    assert.equal(alpha[8 * 16 + 8], 255, 'центр бывшей дыры — товар');
  });

  test('умолчание порога дыру такого размера НЕ заливает', async () => {
    // Дыра здесь — 80% площади товара, то есть настоящий просвет, а не артефакт.
    const { png } = await makeFrame(16, 16);
    const cutout = await computeCutout(png, ringWithHole, SETTINGS);
    assert.ok(cutout !== null);

    const alpha = await sharp(cutout).extractChannel('alpha').raw().toBuffer();
    assert.equal(alpha[8 * 16 + 8], 0, 'просвет обязан уцелеть при умолчании 2%');
  });
});
