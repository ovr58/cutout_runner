import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import sharp from 'sharp';

import type { Segmenter } from './model/session';
import { makeOperations } from './operations';
import { GateBusyError, makeGate } from './queue';

const SETTINGS = { minCoverage: 0.01, maxCoverage: 0.99, activation: 'sigmoid' } as const;
const INPUT_SIZE = 16;

async function frame(): Promise<Buffer> {
  return sharp(Buffer.alloc(32 * 32 * 3, 90), { raw: { width: 32, height: 32, channels: 3 } })
    .png()
    .toBuffer();
}

/** Модель, которая стоит на `run`, пока тест не вызовет `release`: держит ворота занятыми. */
function blockedSegmenter(): { segmenter: Segmenter; release: () => void } {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const segmenter: Segmenter = {
    inputSize: INPUT_SIZE,
    async run(): Promise<Float32Array> {
      await released;
      return Float32Array.from({ length: INPUT_SIZE * INPUT_SIZE }, (_, i) =>
        i % INPUT_SIZE < INPUT_SIZE / 2 ? 30 : -30,
      );
    },
  };
  return { segmenter, release };
}

describe('makeOperations', () => {
  test('вырез и маска стоят в одной очереди: пока идёт одна, вторая ждёт или получает отказ', async () => {
    const png = await frame();
    for (const [first, second] of [
      ['cutout', 'mask'],
      ['mask', 'cutout'],
    ] as const) {
      const { segmenter, release } = blockedSegmenter();
      // Ни одного ожидающего сверх исполняемой работы: вторая операция обязана упереться в ворота.
      const operations = makeOperations(makeGate(0), () => segmenter, SETTINGS);

      const running = operations[first](png);
      const other = operations[second](png).then(
        () => 'ran',
        (err: unknown) => (err instanceof GateBusyError ? 'busy' : 'failed'),
      );
      // Отказ ворот приходит сразу; если вторая операция стоит в другой очереди, она ждёт модель,
      // и без этого сравнения тест повис бы, а не упал.
      const pending = new Promise((resolve) => setImmediate(resolve, 'pending'));
      const early = await Promise.race([other, pending]);
      release();
      assert.equal(early, 'busy', `${first} -> ${second}`);
      assert.ok((await running) !== null, `${first} доходит до конца`);
      await other;
    }
  });

  test('модель не готова — отказ у обеих операций', async () => {
    const png = await frame();
    const operations = makeOperations(makeGate(1), () => null, SETTINGS);
    await assert.rejects(operations.cutout(png), /not ready/);
    await assert.rejects(operations.mask(png), /not ready/);
  });

  test('готовая модель — обе операции отвечают на одном кадре', async () => {
    const png = await frame();
    const { segmenter, release } = blockedSegmenter();
    release();
    const operations = makeOperations(makeGate(1), () => segmenter, SETTINGS);

    assert.ok((await operations.cutout(png)) !== null);
    const samples = await operations.mask(png);
    assert.ok(samples !== null);
    assert.deepEqual([samples.width, samples.height], [256, 256]);
  });
});
