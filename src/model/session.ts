import { InferenceSession, Tensor } from 'onnxruntime-node';

import { log } from '../logger';

/**
 * Модель сегментации, спрятанная за узким интерфейсом: конвейер выреза знает только размер
 * входа и то, что `run` возвращает **сырой выход**. Ни имён тензоров, ни опций сессии, ни ORT.
 *
 * Именно сырой, а не маску: логиты это или уже готовая маска — свойство весов, и объявлено
 * оно рядом с ними (`CUTOUT_ACTIVATION`, src/cutout/mask.ts).
 */
export interface Segmenter {
  /** Сторона квадратного входа модели, пикселей. */
  readonly inputSize: number;
  /** Сырой выход 1×1×inputSize×inputSize, развёрнутый в плоский массив. */
  run(input: Float32Array): Promise<Float32Array>;
}

export interface SegmenterOptions {
  readonly modelPath: string;
  readonly threads: number;
}

/**
 * Запасное значение на случай, если модель не объявила форму входа статически. Обе
 * проверенные модели её объявляют (`u2netp` — 320, `birefnet-general-lite` — 1024), так что
 * до него доходить не должно; 1024 оставлено как заведомо не занижающее.
 */
const DEFAULT_INPUT_SIZE = 1024;

/**
 * Создаётся ОДИН раз при старте процесса: у крупных весов это секунды (замер 2026-09-03 на
 * `birefnet-general-lite` — 5,0 с), и всё это время `/health` честно отвечает 503 `loading`
 * (docs/TZ.md FR-01).
 */
export async function createSegmenter(options: SegmenterOptions): Promise<Segmenter> {
  const startedAt = process.hrtime.bigint();

  const session = await InferenceSession.create(options.modelPath, {
    // Арена памяти ORT включена по умолчанию и на входе 1024 даёт пик 11,9 ГиБ против
    // 6,0 ГиБ без неё (замер 2026-09-06). Это не настройка на вкус, а требование к
    // развёртыванию: с ареной процесс снимает OOM-killer. Цена — 10–15% скорости.
    // На лёгком входе 320 разница в абсолютных числах меньше, но знак тот же
    // (docs/TZ.md FR-02, ADR-0005).
    enableCpuMemArena: false,
    enableMemPattern: false,
    // Один вырез за раз, поэтому параллелить между операторами нечего.
    executionMode: 'sequential',
    interOpNumThreads: 1,
    intraOpNumThreads: options.threads,
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  });

  const inputName = requireName(session.inputNames, 'input');
  const outputName = requireName(session.outputNames, 'output');
  const inputSize = detectInputSize(session, inputName);

  log.info('model.loaded', {
    ms: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
    threads: options.threads,
    inputSize,
    outputs: session.outputNames.length,
  });

  return {
    inputSize,
    async run(input: Float32Array): Promise<Float32Array> {
      const tensor = new Tensor('float32', input, [1, 3, inputSize, inputSize]);
      const outputs = await session.run({ [inputName]: tensor });
      const result = outputs[outputName];
      if (result === undefined || !(result.data instanceof Float32Array)) {
        throw new Error('model output is not a float32 tensor');
      }
      return result.data;
    },
  };
}

/**
 * Берётся ПЕРВЫЙ тензор, и это не небрежность: у `u2netp` выходов семь (`d0`…`d6` — побочные
 * выходы глубокого надзора, оставшиеся в экспорте), и рабочий из них ровно первый. Так же
 * поступает `rembg`. У `birefnet-general-lite` выход один, и правило совпадает с очевидным.
 */
function requireName(names: readonly string[], kind: string): string {
  const name = names[0];
  if (name === undefined) throw new Error(`model has no ${kind}`);
  return name;
}

/**
 * Сторона входа берётся из метаданных модели, а не зашивается: у моделей она разная
 * (`u2netp` — 320, `birefnet-general-lite` — 1024), и молча посчитать не на том разрешении —
 * как раз тот отказ, который не видно.
 */
function detectInputSize(session: InferenceSession, inputName: string): number {
  const meta = session.inputMetadata.find((entry) => entry.name === inputName);
  if (meta === undefined || !meta.isTensor) return DEFAULT_INPUT_SIZE;

  // NCHW: [batch, channels, height, width]. Символьные (динамические) оси — строки.
  const height = meta.shape[2];
  const width = meta.shape[3];
  if (typeof height === 'number' && typeof width === 'number' && height > 0 && height === width) {
    return height;
  }
  return DEFAULT_INPUT_SIZE;
}
