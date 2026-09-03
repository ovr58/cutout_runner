import { cpus } from 'node:os';

/**
 * Конфигурация сервиса. Источник — только окружение: секрет и пути на машине не должны
 * попадать в репозиторий (репозиторий публичный, docs/adr/0006-service-trust-boundary.md).
 */
export interface Config {
  /** Общий секрет из `Authorization: Bearer`. Без него процесс не стартует. */
  readonly secret: string;
  /** Порт на 127.0.0.1. Наружу сервис выпускает только nginx. */
  readonly port: number;
  /** `intraOpNumThreads` ONNX-сессии. */
  readonly threads: number;
  /** Путь к файлу весов. Веса в git не идут — их скачивает установщик. */
  readonly modelPath: string;
  /** Сколько запросов ждут сверх исполняемого; сверх этого — 503 с Retry-After. */
  readonly queueWaiting: number;
  /** Ниже этой доли кадра вырез считается несостоявшимся -> 204. */
  readonly minCoverage: number;
  /** Выше этой доли вырез совпадает с кадром и слой бессмыслен -> 204. */
  readonly maxCoverage: number;
}

export class ConfigError extends Error {}

/**
 * Замер 2026-09-03: 1/2/4/8 потоков дают 24 / 15,8 / 13,0 / 12,0 с. После четырёх отдача
 * падает, поэтому умолчание ограничено сверху, даже если ядер больше.
 */
const MAX_DEFAULT_THREADS = 4;

const DEFAULTS = {
  port: 8787,
  modelPath: 'models/birefnet-general-lite.onnx',
  queueWaiting: 1,
  minCoverage: 0.01,
  maxCoverage: 0.99,
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env['CUTOUT_SECRET'];
  if (secret === undefined || secret === '') {
    // Ни значения, ни намёка на него в тексте ошибки — только имя переменной.
    throw new ConfigError('CUTOUT_SECRET is not set');
  }

  const config: Config = {
    secret,
    port: readInt(env, 'CUTOUT_PORT', DEFAULTS.port, 1, 65535),
    threads: readInt(env, 'CUTOUT_THREADS', defaultThreads(), 1, 64),
    modelPath: env['CUTOUT_MODEL_PATH'] ?? DEFAULTS.modelPath,
    queueWaiting: readInt(env, 'CUTOUT_QUEUE_WAITING', DEFAULTS.queueWaiting, 0, 64),
    minCoverage: readFraction(env, 'CUTOUT_MIN_COVERAGE', DEFAULTS.minCoverage),
    maxCoverage: readFraction(env, 'CUTOUT_MAX_COVERAGE', DEFAULTS.maxCoverage),
  };

  if (config.minCoverage >= config.maxCoverage) {
    throw new ConfigError('CUTOUT_MIN_COVERAGE must be below CUTOUT_MAX_COVERAGE');
  }
  return config;
}

function defaultThreads(): number {
  const cores = cpus().length || 1;
  return Math.min(cores, MAX_DEFAULT_THREADS);
}

function readInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function readFraction(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfigError(`${name} must be a number in [0, 1]`);
  }
  return value;
}
