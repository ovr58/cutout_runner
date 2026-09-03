/**
 * Ворота «один вырез за раз».
 *
 * Инференс занимает все ядра, поэтому параллельные запросы не ускоряют, а мешают друг другу.
 * Честная очередь лучше конкуренции за ядра: одна исполняемая работа плюс `maxWaiting`
 * ожидающих, сверх этого — отказ (docs/TZ.md FR-11).
 */
export class GateBusyError extends Error {
  constructor() {
    super('gate is busy');
    this.name = 'GateBusyError';
  }
}

export type Gate = <T>(job: () => Promise<T>) => Promise<T>;

export function makeGate(maxWaiting: number): Gate {
  // Принятые, но ещё не завершённые работы: одна исполняется, остальные ждут в цепочке.
  let accepted = 0;
  // Хвост цепочки: следующая работа стартует не раньше, чем завершится предыдущая.
  let tail: Promise<void> = Promise.resolve();

  return <T>(job: () => Promise<T>): Promise<T> => {
    if (accepted > maxWaiting) return Promise.reject(new GateBusyError());
    accepted += 1;

    const result = tail.then(job);
    // Хвост не должен нести отказ дальше по цепочке: провал одной работы не отменяет следующую.
    tail = result.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      accepted -= 1;
    });

    return result;
  };
}
