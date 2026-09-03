import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { describe } from 'node:test';

import { UnreadableImageError } from '../cutout/pipeline';
import { GateBusyError } from '../queue';
import { createServer, type ServerDeps } from './server';

const SECRET = 'shared-secret';
const PNG = Buffer.from('fake-png-bytes');

const BASE_DEPS: ServerDeps = {
  authorize: (header) => header === `Bearer ${SECRET}`,
  isReady: () => true,
  cutout: async () => PNG,
  maxBodyBytes: 1024,
  retryAfterSeconds: 30,
};

/** Поднимает сервер на свободном порту и гарантированно гасит его после теста. */
async function withServer(
  overrides: Partial<ServerDeps>,
  body: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer({ ...BASE_DEPS, ...overrides });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function post(base: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}/cutout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'image/png' },
    body: PNG,
    ...init,
  });
}

describe('GET /health', () => {
  test('до готовности модели — 503 loading, без секрета', async () => {
    await withServer({ isReady: () => false }, async (base) => {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: 'loading', ready: false });
    });
  });

  test('после готовности — 200 ok, и ничего лишнего в теле', async () => {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text, '{"status":"ok","ready":true}');
      // Ни версии, ни имени модели, ни путей (docs/TZ.md US-02).
      assert.ok(!/version|model|path|onnx/i.test(text));
    });
  });
});

describe('POST /cutout — авторизация', () => {
  test('без секрета и с неверным секретом отвечает одинаково', async () => {
    await withServer({}, async (base) => {
      const missing = await post(base, { headers: { 'content-type': 'image/png' } });
      const wrong = await post(base, {
        headers: { authorization: 'Bearer nope', 'content-type': 'image/png' },
      });

      assert.equal(missing.status, 401);
      assert.equal(wrong.status, 401);
      assert.equal(await missing.text(), '');
      assert.equal(await wrong.text(), '');
      // Заголовок Date отличается по определению; всё остальное обязано совпасть (FR-09).
      assert.deepEqual(headersWithoutDate(missing), headersWithoutDate(wrong));
    });
  });

  test('неавторизованный не узнаёт даже того, готова ли модель', async () => {
    await withServer({ isReady: () => false }, async (base) => {
      const res = await post(base, { headers: { 'content-type': 'image/png' } });
      assert.equal(res.status, 401);
    });
  });
});

describe('POST /cutout — контракт', () => {
  test('вырез отдаётся как image/png', async () => {
    await withServer({}, async (base) => {
      const res = await post(base);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.compare(Buffer.from(await res.arrayBuffer()), PNG), 0);
    });
  });

  test('товара не нашлось — 204 без тела', async () => {
    await withServer({ cutout: async () => null }, async (base) => {
      const res = await post(base);
      assert.equal(res.status, 204);
      assert.equal(await res.text(), '');
    });
  });

  test('чужой Content-Type — 400', async () => {
    await withServer({}, async (base) => {
      for (const type of ['application/json', 'image/webp', 'multipart/form-data']) {
        const res = await post(base, {
          headers: { authorization: `Bearer ${SECRET}`, 'content-type': type },
        });
        assert.equal(res.status, 400, type);
      }
    });
  });

  test('Content-Type с параметрами принимается', async () => {
    await withServer({}, async (base) => {
      const res = await post(base, {
        headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'image/jpeg; charset=binary' },
      });
      assert.equal(res.status, 200);
    });
  });

  test('тело не разбирается как изображение — 400 без внутренностей', async () => {
    await withServer(
      {
        cutout: async () => {
          throw new UnreadableImageError(new Error('vips: bad header at /srv/models/x.onnx'));
        },
      },
      async (base) => {
        const res = await post(base);
        assert.equal(res.status, 400);
        assert.equal(await res.text(), '', 'ни стека, ни путей в теле (FR-10)');
      },
    );
  });

  test('очередь занята — 503 с Retry-After', async () => {
    await withServer(
      {
        cutout: async () => {
          throw new GateBusyError();
        },
      },
      async (base) => {
        const res = await post(base);
        assert.equal(res.status, 503);
        assert.equal(res.headers.get('retry-after'), '30');
      },
    );
  });

  test('модель ещё не готова — 503 с Retry-After', async () => {
    await withServer({ isReady: () => false }, async (base) => {
      const res = await post(base);
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('retry-after'), '30');
    });
  });

  test('тело больше потолка — 413', async () => {
    await withServer({ maxBodyBytes: 64 }, async (base) => {
      const res = await post(base, {
        headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'image/png' },
        body: Buffer.alloc(4096, 7),
      });
      assert.equal(res.status, 413);
    });
  });

  test('внутренняя ошибка — 500 без подробностей', async () => {
    await withServer(
      {
        cutout: async () => {
          throw new Error('secret path /srv/weights.onnx');
        },
      },
      async (base) => {
        const res = await post(base);
        assert.equal(res.status, 500);
        assert.equal(await res.text(), '');
      },
    );
  });
});

describe('маршрутизация', () => {
  test('чужой путь — 404, чужой метод — 405', async () => {
    await withServer({}, async (base) => {
      assert.equal((await fetch(`${base}/`)).status, 404);
      assert.equal((await fetch(`${base}/models`)).status, 404);
      assert.equal((await fetch(`${base}/cutout`)).status, 405);
      assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405);
    });
  });

  test('строка запроса не ломает маршрут', async () => {
    await withServer({}, async (base) => {
      assert.equal((await fetch(`${base}/health?probe=1`)).status, 200);
    });
  });
});

function headersWithoutDate(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of res.headers) {
    if (name.toLowerCase() !== 'date') headers[name] = value;
  }
  return headers;
}
