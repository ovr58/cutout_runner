import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { makeAuthorizer } from './auth';

const SECRET = 'correct-horse-battery-staple';

describe('makeAuthorizer', () => {
  const authorize = makeAuthorizer(SECRET);

  test('пропускает верный секрет', () => {
    assert.equal(authorize(`Bearer ${SECRET}`), true);
  });

  test('имя схемы регистронезависимо (RFC 7235)', () => {
    assert.equal(authorize(`bearer ${SECRET}`), true);
    assert.equal(authorize(`BEARER ${SECRET}`), true);
  });

  test('отбивает неверный секрет', () => {
    assert.equal(authorize(`Bearer ${SECRET}-wrong`), false);
    assert.equal(authorize('Bearer '), false);
  });

  test('отбивает отсутствующий и негодный заголовок — без исключения', () => {
    // crypto.timingSafeEqual бросает при разной длине буферов; здесь длины всегда равны,
    // потому что сравниваются хэши (docs/SPEC.md §9).
    assert.equal(authorize(undefined), false);
    assert.equal(authorize(''), false);
    assert.equal(authorize(SECRET), false); // без схемы
    assert.equal(authorize(`Basic ${SECRET}`), false);
  });

  test('секрет любой длины не роняет сравнение', () => {
    for (const candidate of ['', 'x', 'x'.repeat(1000), SECRET.slice(0, -1)]) {
      assert.equal(authorize(`Bearer ${candidate}`), false);
    }
  });
});
