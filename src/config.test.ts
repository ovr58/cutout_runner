import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { ConfigError, loadConfig } from './config';

const MINIMAL = { CUTOUT_SECRET: 's3cret' } as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  test('без CUTOUT_SECRET конфигурация не собирается', () => {
    // Молча подняться без секрета сервис не имеет права (docs/TZ.md FR-12).
    assert.throws(() => loadConfig({}), ConfigError);
    assert.throws(() => loadConfig({ CUTOUT_SECRET: '' }), ConfigError);
  });

  test('текст ошибки не содержит значения секрета', () => {
    try {
      loadConfig({});
      assert.fail('ожидалось исключение');
    } catch (err) {
      assert.ok(err instanceof ConfigError);
      assert.ok(!err.message.includes('s3cret'));
    }
  });

  test('умолчания разумны, потоков не больше четырёх', () => {
    const config = loadConfig(MINIMAL);
    assert.equal(config.port, 8787);
    assert.equal(config.queueWaiting, 1);
    assert.equal(config.minCoverage, 0.01);
    assert.equal(config.maxCoverage, 0.99);
    // После четырёх потоков отдача падает: 24 / 15,8 / 13,0 / 12,0 с на 1/2/4/8.
    assert.ok(config.threads >= 1 && config.threads <= 4);
  });

  test('значения из окружения перекрывают умолчания', () => {
    const config = loadConfig({
      ...MINIMAL,
      CUTOUT_PORT: '9000',
      CUTOUT_THREADS: '8',
      CUTOUT_MODEL_PATH: '/srv/weights.onnx',
      CUTOUT_QUEUE_WAITING: '2',
      CUTOUT_MIN_COVERAGE: '0.05',
      CUTOUT_MAX_COVERAGE: '0.9',
    });
    assert.equal(config.port, 9000);
    assert.equal(config.threads, 8);
    assert.equal(config.modelPath, '/srv/weights.onnx');
    assert.equal(config.queueWaiting, 2);
    assert.equal(config.minCoverage, 0.05);
    assert.equal(config.maxCoverage, 0.9);
  });

  test('негодные значения отвергаются на старте, а не в проде', () => {
    assert.throws(() => loadConfig({ ...MINIMAL, CUTOUT_PORT: '0' }), ConfigError);
    assert.throws(() => loadConfig({ ...MINIMAL, CUTOUT_PORT: 'вжух' }), ConfigError);
    assert.throws(() => loadConfig({ ...MINIMAL, CUTOUT_THREADS: '0' }), ConfigError);
    assert.throws(() => loadConfig({ ...MINIMAL, CUTOUT_MIN_COVERAGE: '2' }), ConfigError);
    assert.throws(
      () => loadConfig({ ...MINIMAL, CUTOUT_MIN_COVERAGE: '0.9', CUTOUT_MAX_COVERAGE: '0.5' }),
      ConfigError,
    );
  });
});
