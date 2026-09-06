import { cpus } from 'node:os';

import type { Activation } from './cutout/mask';

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
  /**
   * Чем выход этих весов превращается в маску. Живёт рядом с путём к весам, потому что это
   * свойство файла модели, а не общая настройка: сменил веса — меняй и активацию.
   */
  readonly activation: Activation;
  /** Сколько запросов ждут сверх исполняемого; сверх этого — 503 с Retry-After. */
  readonly queueWaiting: number;
  /** Ниже этой доли кадра вырез считается несостоявшимся -> 204. */
  readonly minCoverage: number;
  /** Выше этой доли вырез совпадает с кадром и слой бессмыслен -> 204. */
  readonly maxCoverage: number;
  /**
   * Доля площади товара, ниже которой запертая внутри контура область считается дырой модели
   * и заливается. Выше — это настоящий просвет (дужки очков, промежутки между ножками
   * кресла), и его трогать нельзя. Ноль — заливку выключить.
   */
  readonly maxHoleShare: number;
}

export class ConfigError extends Error {}

/**
 * Замер 2026-09-06 на `u2netp`: 1 поток — 0,55 с, 4 потока — 0,25 с. Отдача от потоков есть,
 * но небольшая, и после четырёх она пропадает, поэтому умолчание ограничено сверху.
 */
const MAX_DEFAULT_THREADS = 4;

const DEFAULTS = {
  port: 8787,
  modelPath: 'models/u2netp.onnx',
  activation: 'minmax',
  queueWaiting: 1,
  minCoverage: 0.01,
  maxCoverage: 0.99,
  maxHoleShare: 0.02,
} as const;

const ACTIVATIONS: readonly Activation[] = ['sigmoid', 'minmax'];

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
    activation: readActivation(env),
    queueWaiting: readInt(env, 'CUTOUT_QUEUE_WAITING', DEFAULTS.queueWaiting, 0, 64),
    minCoverage: readFraction(env, 'CUTOUT_MIN_COVERAGE', DEFAULTS.minCoverage),
    maxCoverage: readFraction(env, 'CUTOUT_MAX_COVERAGE', DEFAULTS.maxCoverage),
    maxHoleShare: readFraction(env, 'CUTOUT_MAX_HOLE_SHARE', DEFAULTS.maxHoleShare),
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

/**
 * Значение проверяется по списку, а не приводится типом: опечатка в файле окружения иначе
 * дошла бы до инференса и дала не отказ, а тихо неверную маску.
 */
function readActivation(env: NodeJS.ProcessEnv): Activation {
  const raw = env['CUTOUT_ACTIVATION'];
  if (raw === undefined || raw === '') return DEFAULTS.activation;
  const value = ACTIVATIONS.find((known) => known === raw);
  if (value === undefined) {
    throw new ConfigError(`CUTOUT_ACTIVATION must be one of: ${ACTIVATIONS.join(', ')}`);
  }
  return value;
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
