import { makeAuthorizer } from './auth';
import { ConfigError, loadConfig } from './config';
import { computeCutout } from './cutout/pipeline';
import { createServer } from './http/server';
import { errorMessage, log } from './logger';
import { createSegmenter, type Segmenter } from './model/session';
import { makeGate } from './queue';

/**
 * Порядок старта важен: сокет поднимается ДО загрузки модели, чтобы `/health` честно отвечал
 * 503 `loading` те ~5 секунд, пока создаётся сессия ORT (docs/VISUALS.md V-06).
 */

/**
 * Потолок тела на стороне приложения. Основной стоит в nginx — запрос, отбитый до Node, не
 * занимает ни ядра, ни памяти инференса. Этот нужен на случай запуска без nginx.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Инференс занимает 12–24 с; предлагать повтор раньше бессмысленно. */
const RETRY_AFTER_SECONDS = 30;

function main(): void {
  const config = loadConfig();

  const gate = makeGate(config.queueWaiting);
  const authorize = makeAuthorizer(config.secret);
  let segmenter: Segmenter | null = null;

  const server = createServer({
    authorize,
    isReady: () => segmenter !== null,
    cutout: (body) =>
      gate(async () => {
        if (segmenter === null) throw new Error('segmenter is not ready');
        return computeCutout(body, segmenter, config);
      }),
    maxBodyBytes: MAX_BODY_BYTES,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
  });

  // Без сокета сервис бессмыслен. Ошибка `listen` (чаще всего EADDRINUSE) приходит событием, а
  // не исключением, и без этого обработчика Node вываливает сырой стек мимо логгера — под
  // systemd с Restart=on-failure он повторялся бы в журнале на каждой попытке.
  server.on('error', (err) => {
    log.error('server.failed', { port: config.port, reason: errorMessage(err) });
    // Запись в pipe на Linux синхронна, поэтому строка журнала уходит до выхода.
    process.exit(1);
  });

  // Только 127.0.0.1: наружу сервис выпускает исключительно nginx, и ошибка в конфигурации
  // приложения не открывает его в интернет (docs/TZ.md FR-13).
  server.listen(config.port, '127.0.0.1', () => {
    log.info('server.listening', { port: config.port });
  });

  createSegmenter(config)
    .then((ready) => {
      segmenter = ready;
      log.info('service.ready');
    })
    .catch((err: unknown) => {
      // Без модели сервис бессмыслен: падаем, systemd поднимет заново по Restart=on-failure.
      log.error('model.failed', { reason: errorMessage(err) });
      server.close();
      // Иначе процесс повис бы на keep-alive соединении и systemd не увидел бы отказа.
      server.closeAllConnections();
      process.exitCode = 1;
    });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info('server.stopping', { signal });
      server.close();
      // Начатый вырез доводится до конца, простаивающие соединения закрываются сразу.
      server.closeIdleConnections();
    });
  }
}

try {
  main();
} catch (err) {
  // Молча подняться без секрета сервис не имеет права (docs/TZ.md FR-12).
  log.error(err instanceof ConfigError ? 'config.invalid' : 'startup.failed', {
    reason: errorMessage(err),
  });
  process.exit(1);
}
