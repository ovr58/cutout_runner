import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { GateBusyError, makeGate } from './queue';

/** Работа, завершением которой управляет тест. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = () => rej(new Error('job failed'));
  });
  return { promise, resolve, reject };
}

describe('makeGate', () => {
  test('считает по одному вырезу за раз, вторая работа ждёт первую', async () => {
    const gate = makeGate(1);
    const order: string[] = [];
    const first = deferred();

    const a = gate(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = gate(async () => {
      order.push('b:start');
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['a:start'], 'вторая работа не должна стартовать до конца первой');

    first.resolve();
    await Promise.all([a, b]);
    assert.deepEqual(order, ['a:start', 'a:end', 'b:start']);
  });

  test('сверх очереди — отказ, а не конкуренция за ядра', async () => {
    const gate = makeGate(1); // ёмкость: одна исполняемая + одна ожидающая
    const running = deferred();

    const a = gate(() => running.promise);
    const b = gate(async () => undefined);
    await assert.rejects(gate(async () => undefined), GateBusyError);

    running.resolve();
    await Promise.all([a, b]);
  });

  test('место освобождается и после успеха, и после провала работы', async () => {
    const gate = makeGate(0); // только исполняемая, без ожидающих
    const first = deferred();

    const a = gate(() => first.promise);
    await assert.rejects(gate(async () => undefined), GateBusyError);

    first.reject();
    await assert.rejects(a, /job failed/);

    // Провал предыдущей работы не отменяет следующую и не занимает место навсегда.
    assert.equal(await gate(async () => 'ok'), 'ok');
  });

  test('возвращает значение работы как есть', async () => {
    const gate = makeGate(2);
    const values = await Promise.all([gate(async () => 1), gate(async () => 2)]);
    assert.deepEqual(values, [1, 2]);
  });
});
