import { type CutoutSettings, computeCutout, computeMask, type MaskSamples } from './cutout/pipeline';
import type { Segmenter } from './model/session';
import type { Gate } from './queue';

/**
 * Операции сервиса поверх одной модели и одних ворот: «один инференс за раз» держится на
 * воротах, а не на операции — `/cutout` и `/mask` стоят в одной очереди и делят её лимит.
 */
export interface Operations {
  readonly cutout: (body: Buffer) => Promise<Buffer | null>;
  readonly mask: (body: Buffer) => Promise<MaskSamples | null>;
}

export function makeOperations(
  gate: Gate,
  getSegmenter: () => Segmenter | null,
  settings: CutoutSettings,
): Operations {
  const inference = <T>(job: (ready: Segmenter) => Promise<T>): Promise<T> =>
    gate(async () => {
      const segmenter = getSegmenter();
      if (segmenter === null) throw new Error('segmenter is not ready');
      return job(segmenter);
    });

  return {
    cutout: (body) => inference((ready) => computeCutout(body, ready, settings)),
    mask: (body) => inference((ready) => computeMask(body, ready, settings)),
  };
}
