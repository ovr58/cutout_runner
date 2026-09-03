import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test, { describe } from 'node:test';

/**
 * Проверки на собранном процессе целиком: то, что нельзя проверить по частям — порядок старта
 * и поведение при отказе. Веса модели тут не нужны: путь к ним заведомо негодный.
 */

const ENTRY = path.join(__dirname, 'main.js');

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, CUTOUT_MODEL_PATH: './заведомо-нет-такого-файла.onnx', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Занимает порт, чтобы проверить поведение при конфликте. */
async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return {
    port: address.port,
    release: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('старт процесса', () => {
  test('без CUTOUT_SECRET не стартует и не подсказывает значение', async () => {
    // Молча подняться без секрета сервис не имеет права (docs/TZ.md FR-12).
    const { code, stdout } = await run({ CUTOUT_SECRET: '' });
    assert.equal(code, 1);
    assert.match(stdout, /"event":"config\.invalid"/);
    assert.doesNotMatch(stdout, /"event":"server\.listening"/);
  });

  test('занятый порт — строка журнала и код 1, а не сырой стек', async () => {
    // Под systemd с Restart=on-failure конфликт порта повторяется в цикле: он обязан читаться
    // одной строкой, а не «Unhandled 'error' event» со стеком на каждой попытке.
    const held = await occupyPort();
    try {
      const { code, stdout, stderr } = await run({
        CUTOUT_SECRET: 'x',
        CUTOUT_PORT: String(held.port),
      });
      assert.equal(code, 1);
      assert.match(stdout, /"event":"server\.failed"/);
      assert.match(stdout, /EADDRINUSE/);
      assert.doesNotMatch(stderr, /Unhandled 'error' event/);
      assert.doesNotMatch(stderr, /^\s+at /m);
    } finally {
      await held.release();
    }
  });

  test('сокет поднимается до загрузки модели, отказ модели роняет процесс', async () => {
    // Порядок важен: /health честно отвечает 503 loading, пока создаётся сессия ORT.
    const free = await occupyPort();
    await free.release();
    const { code, stdout } = await run({ CUTOUT_SECRET: 'x', CUTOUT_PORT: String(free.port) });
    assert.equal(code, 1);
    const listening = stdout.indexOf('"event":"server.listening"');
    const failed = stdout.indexOf('"event":"model.failed"');
    assert.ok(listening >= 0, 'сокет должен подняться первым');
    assert.ok(failed > listening, 'отказ модели — после того, как сокет уже слушает');
    assert.doesNotMatch(stdout, /"event":"service\.ready"/);
  });
});
