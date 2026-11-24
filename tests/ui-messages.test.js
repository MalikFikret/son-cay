// Game UI: error codes to messages (src/ui/messages.js over the locale in src/ui/i18n/), and the
// generated version module (src/ui/version.js).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOM_ERR, RoomError } from '../src/rooms/index.js';
import { RETRY_WAIT_CODES, RETRY_WAIT_SECONDS, errorMessage } from '../src/ui/messages.js';
import { t } from '../src/ui/i18n/i18n.js';
import tr from '../src/ui/i18n/tr.js';

const ROOM_MESSAGES = tr.errors.room;
const FORM_MESSAGES = tr.errors.form;
const GENERIC_MESSAGE = t('errors.generic');
const OFFLINE_MESSAGE = t('errors.offline');
import { COMMIT, VERSION } from '../src/ui/version.js';

describe('error messages', () => {
  test('every room-layer error code has a non-empty message that is not the raw code', () => {
    for (const code of Object.values(ROOM_ERR)) {
      const message = ROOM_MESSAGES[code];
      assert.equal(typeof message, 'string', code);
      assert.ok(message.length > 0, code);
      assert.ok(!message.includes(code), code);
      assert.equal(errorMessage(new RoomError(code)), message, code);
      assert.equal(errorMessage(code), message, code);
    }
    assert.deepEqual(Object.keys(ROOM_MESSAGES).sort(), Object.values(ROOM_ERR).sort());
  });

  test('the codes a player can hit on the entry screens have their own (not the generic) message', () => {
    const own = [
      'INVALID_CODE', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'INVALID_NAME', 'NAME_TAKEN', 'INVALID_PIN',
      'WRONG_PIN', 'RETRY_LATER', 'INVALID_SEAT', 'SEAT_EMPTY', 'ALREADY_MEMBER', 'NOT_MEMBER',
      'SEAT_LOST', 'CODE_GENERATION_FAILED', 'WRITE_DENIED',
    ];
    for (const code of own) assert.notEqual(errorMessage(code), GENERIC_MESSAGE, code);
    assert.equal(errorMessage('WRONG_PIN'), 'Şifre yanlış.');
  });

  test('form checks have messages too', () => {
    for (const key of Object.keys(FORM_MESSAGES)) assert.equal(errorMessage(key), FORM_MESSAGES[key]);
  });

  test('unknown errors get the generic message, network errors the offline one', () => {
    assert.equal(errorMessage(new Error('boom')), GENERIC_MESSAGE);
    assert.equal(errorMessage(undefined), GENERIC_MESSAGE);
    assert.equal(errorMessage(null), GENERIC_MESSAGE);
    assert.equal(errorMessage('toString'), GENERIC_MESSAGE); // no prototype lookups
    assert.equal(errorMessage({ code: '__proto__' }), GENERIC_MESSAGE);
    assert.equal(errorMessage('room.WRONG_PIN'), GENERIC_MESSAGE); // a code is never a key path
    assert.equal(errorMessage('generic'), GENERIC_MESSAGE);
    assert.equal(errorMessage(new Error('Client is offline.')), OFFLINE_MESSAGE);
    assert.equal(errorMessage({ code: 'auth/network-request-failed', message: 'x' }), OFFLINE_MESSAGE);
  });

  test('the recover screen waits 2 s after a wrong Şifre or a refused claim', () => {
    assert.deepEqual([...RETRY_WAIT_CODES].sort(), [ROOM_ERR.RETRY_LATER, ROOM_ERR.WRONG_PIN].sort());
    assert.equal(RETRY_WAIT_SECONDS, 2);
  });
});

describe('version module', () => {
  test('src/ui/version.js matches package.json (run `npm run version:write` after a change)', () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(VERSION, version);
    assert.ok(COMMIT === null || /^[0-9a-f]{4,40}$/.test(COMMIT));
  });
});
