import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { parseLayoutRequest } from './request';

const FRAME = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
const body = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const valid = { html: '<div id="card"></div>', canvas: { width: 896, height: 1200 }, frame: FRAME };

describe('разбор тела /layout', () => {
  test('кадр из data-URI становится байтами, тип запоминается', () => {
    const parsed = parseLayoutRequest(body({ ...valid, frame: FRAME.replace('png', 'jpeg') }));
    assert.equal(parsed.kind, 'request');
    if (parsed.kind !== 'request') return;
    assert.equal(parsed.request.frame.toString(), 'png-bytes');
    assert.equal(parsed.request.frameType, 'image/jpeg');
  });

  test('url(frame.png) — разрешён, любой другой url(…) — отказ', () => {
    const own = '<div id="card" style="background:url(\'frame.png\')"></div>';
    assert.equal(parseLayoutRequest(body({ ...valid, html: own })).kind, 'request');
    for (const target of ['https://x.ru/a.png', 'data:image/png;base64,AA', '"//x.ru/f.woff"', '']) {
      assert.deepEqual(
        parseLayoutRequest(body({ ...valid, html: `<style>#card{background:URL( ${target} )}</style>` })),
        { kind: 'refused', reason: 'url' },
        target,
      );
    }
  });

  test('<script> в любом регистре — отказ', () => {
    assert.deepEqual(parseLayoutRequest(body({ ...valid, html: '<SCRIPT src=x></SCRIPT>' })), {
      kind: 'refused',
      reason: 'script',
    });
  });

  test('холст — целые стороны от 1 до 4096; кадр — только png/jpeg data-URI', () => {
    for (const canvas of [{ width: 0, height: 10 }, { width: 10.5, height: 10 }, { width: 4097, height: 10 }, {}]) {
      assert.deepEqual(parseLayoutRequest(body({ ...valid, canvas })), { kind: 'invalid' });
    }
    for (const frame of ['frame.png', 'data:image/gif;base64,AA', `${FRAME} `, 1]) {
      assert.deepEqual(parseLayoutRequest(body({ ...valid, frame })), { kind: 'invalid' });
    }
    assert.deepEqual(parseLayoutRequest(Buffer.from('[1]')), { kind: 'invalid' });
    assert.deepEqual(parseLayoutRequest(body({ ...valid, html: '' })), { kind: 'invalid' });
  });
});
