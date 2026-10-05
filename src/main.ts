import { join } from 'node:path';

import { makeAuthorizer } from './auth';
import { ConfigError, loadConfig } from './config';
import { createServer } from './http/server';
import { createLayoutRunner } from './layout/scene';
import { errorMessage, log } from './logger';
import { createSegmenter, type Segmenter } from './model/session';
import { makeOperations } from './operations';
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

/** Инференс на `u2netp` — доли секунды (замер 2026-09-06: 0,55 с на одном потоке). */
const RETRY_AFTER_SECONDS = 5;

/**
 * `/layout`: страница карточки — десятки КБ HTML плюс кадр data-URI; потолок и время на страницу
 * заданы планом родительского продукта (html-layout-authoring, шаг C2), а не подобраны здесь.
 */
const LAYOUT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const LAYOUT_TIMEOUT_MS = 10_000;

function main(): void {
  const config = loadConfig();

  const gate = makeGate(config.queueWaiting);
  const authorize = makeAuthorizer(config.secret);
  let segmenter: Segmenter | null = null;
  const operations = makeOperations(gate, () => segmenter, config);
  // Шрифты и код страницы читаются здесь, при старте: их нехватка — отказ запуска, а не 500.
  const layoutRunner = createLayoutRunner({
    assetsDir: join(__dirname, '..', 'assets'),
    timeoutMs: LAYOUT_TIMEOUT_MS,
  });

  const server = createServer({
    authorize,
    isReady: () => segmenter !== null,
    cutout: operations.cutout,
    mask: operations.mask,
    // Та же очередь, что у инференса: на коробке одно ядро, Chromium и ORT разом друг другу мешают.
    layout: (body) => gate(() => layoutRunner.run(body)),
    maxBodyBytes: MAX_BODY_BYTES,
    layoutMaxBodyBytes: LAYOUT_MAX_BODY_BYTES,
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
      // Начатый вырез доводится до конца, простаивающие соединения закрываются сразу; Chromium
      // гасится после последнего ответа.
      server.close(() => {
        void layoutRunner.close();
      });
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
