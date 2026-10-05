import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test, { after, describe } from 'node:test';

import sharp from 'sharp';

import { createLayoutRunner, type LayoutOutcome } from './scene';

/**
 * Тесты живого Chromium: нужен браузер Playwright (`npx playwright install chromium`), сеть — нет.
 * Фикстура — та же, что у офлайн-инструмента родительского продукта (шаг B2 его плана).
 */
const ROOT = join(__dirname, '..', '..');
const FIXTURE = readFileSync(join(ROOT, 'src', 'layout', 'fixtures', 'home-chair.html'), 'utf8');
const CANVAS = { width: 896, height: 1200 };

const runner = createLayoutRunner({ assetsDir: join(ROOT, 'assets'), timeoutMs: 10_000 });
after(() => runner.close());

async function frameUri(): Promise<string> {
  const png = await sharp({
    create: { ...CANVAS, channels: 3, background: { r: 200, g: 180, b: 160 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function layout(html: string, canvas = CANVAS): Promise<LayoutOutcome> {
  return runner.run(Buffer.from(JSON.stringify({ html, canvas, frame: await frameUri() })));
}

function card(inner: string, bodyAttrs = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0" ${bodyAttrs}>
<div id="card" style="position:relative;width:400px;height:400px;background:#fff">${inner}</div></body></html>`;
}

type Rect = { x: number; y: number; w: number; h: number };
type Scene = {
  elements: { kind: string; lines?: { text: string; rect: Rect }[]; selector: string; rect: Rect }[];
  rejected: unknown[];
};

describe('POST /layout — снятие сцены', () => {
  test('page.evaluate работает при javaScriptEnabled: false, а скрипты страницы — нет', async () => {
    // Обработчик onload спрятал бы #probe, если бы JS страницы исполнялся. <script> отбивается
    // раньше браузера (422), поэтому JS проверяется атрибутом-обработчиком.
    const outcome = await layout(
      card(
        '<div id="probe" style="position:absolute;left:10px;top:10px;font:20px Montserrat">Слово</div>',
        `onload="document.getElementById('probe').style.display='none'"`,
      ),
      { width: 400, height: 400 },
    );

    assert.equal(outcome.kind, 'scene');
    const scene = (outcome as { scene: Scene }).scene;
    assert.deepEqual(
      scene.elements.map((element) => element.selector),
      ['div#probe'],
    );
  });

  test('фикстура B2: один кадр, не меньше трёх текстов со строками, отказов нет', async () => {
    const outcome = await layout(FIXTURE);

    assert.equal(outcome.kind, 'scene');
    const scene = (outcome as { scene: Scene }).scene;
    assert.deepEqual(scene.rejected, []);
    assert.equal(scene.elements.filter((element) => element.kind === 'frame').length, 1);
    const texts = scene.elements.filter((element) => element.kind === 'text');
    assert.ok(texts.length >= 3, `текстов ${texts.length}`);
    for (const text of texts) assert.ok((text.lines?.length ?? 0) >= 1);
  });

  test('сцена фикстуры совпадает со сценой офлайн-инструмента (свои шрифты, тот же обход)', async () => {
    // Эталон снят офлайн-инструментом родительского продукта на Windows. Те же шрифты и та же
    // версия Chromium дают те же строки; боксы — с допуском в пиксель на растеризацию другой ОС.
    // Без своих шрифтов ширины строк расходятся на десятки пикселей.
    const golden = JSON.parse(
      readFileSync(join(ROOT, 'src', 'layout', 'fixtures', 'home-chair.scene.json'), 'utf8'),
    ) as Scene;
    const outcome = await layout(FIXTURE);
    assert.equal(outcome.kind, 'scene');
    const scene = (outcome as { scene: Scene }).scene;

    const shape = (s: Scene) =>
      s.elements.map((element) => [element.kind, element.selector, element.lines?.map((line) => line.text)]);
    assert.deepEqual(shape(scene), shape(golden));
    const rects = (s: Scene) =>
      s.elements.flatMap((element) => [element.rect, ...(element.lines ?? []).map((line) => line.rect)]);
    const expected = rects(golden);
    rects(scene).forEach((rect, at) => {
      for (const side of ['x', 'y', 'w', 'h'] as const) {
        assert.ok(Math.abs(rect[side] - (expected[at]?.[side] ?? NaN)) <= 1, `бокс ${at}.${side}`);
      }
    });
  });

  test('<script> и url(https://…) — отказ до браузера', async () => {
    assert.deepEqual(await layout(card('<script>1</script>')), { kind: 'refused', reason: 'script' });
    assert.deepEqual(
      await layout(card('<div style="background:url(https://example.com/a.png)">x</div>')),
      { kind: 'refused', reason: 'url' },
    );
  });

  test('страница не выходит в сеть: внешняя таблица стилей не запрашивается', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end('#card{background:red}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const outcome = await layout(
        card(`<link rel="stylesheet" href="http://127.0.0.1:${port}/x.css"><img src="http://127.0.0.1:${port}/y.png">`),
      );
      assert.equal(outcome.kind, 'scene');
      assert.equal(hits, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('потолок времени — отказ timeout', async () => {
    const slow = createLayoutRunner({ assetsDir: join(ROOT, 'assets'), timeoutMs: 1 });
    try {
      const frame = await frameUri();
      const outcome = await slow.run(Buffer.from(JSON.stringify({ html: FIXTURE, canvas: CANVAS, frame })));
      assert.deepEqual(outcome, { kind: 'refused', reason: 'timeout' });
    } finally {
      await slow.close();
    }
  });

  test('неразборчивое тело — invalid', async () => {
    assert.deepEqual(await runner.run(Buffer.from('not json')), { kind: 'invalid' });
    assert.deepEqual(
      await runner.run(Buffer.from(JSON.stringify({ html: FIXTURE, canvas: CANVAS, frame: 'https://x/frame.png' }))),
      { kind: 'invalid' },
    );
  });
});
