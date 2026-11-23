// Closing a table (decision Q67): the room layer's pure othersAbsent (src/rooms/host.js) and
// the UI state of "Masayı kapat" (closeRoomState in src/ui/lobby-model.js). No browser, no
// emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { othersAbsent } from '../src/rooms/index.js';
import { closeRoomState } from '../src/ui/lobby-model.js';
import { TEXT } from '../src/ui/messages.js';

const seat = (uid) => ({ uid, name: uid, joinedAt: 1 });
const SEATS = { s01: seat('host'), s02: seat('bob'), s03: seat('carol') };
const on = { conns: { c1: true }, lastSeenAt: 5 };
const off = { lastSeenAt: 5 };

describe('othersAbsent', () => {
  test('true when every other seat has no connection (no entry, or an entry without conns)', () => {
    assert.equal(othersAbsent(SEATS, { s01: on, s02: off }, 's01'), true);
    assert.equal(othersAbsent(SEATS, {}, 's01'), true);
    assert.equal(othersAbsent(SEATS, null, 's01'), true);
    assert.equal(othersAbsent(SEATS, { s02: { conns: {} } }, 's01'), true);
  });

  test('false as soon as one other seat is present; my own presence does not count', () => {
    assert.equal(othersAbsent(SEATS, { s01: on, s03: on }, 's01'), false);
    assert.equal(othersAbsent(SEATS, { s01: off, s02: on }, 's01'), false);
    assert.equal(othersAbsent({ s01: seat('host') }, { s01: on }, 's01'), true);
  });

  test('presence of a seat that is not taken is ignored; missing seats count as nobody', () => {
    assert.equal(othersAbsent({ s01: seat('host') }, { s07: on }, 's01'), true);
    assert.equal(othersAbsent(null, { s02: on }, 's01'), true);
  });

  test('inherited keys are not read as presence', () => {
    const presence = Object.create({ s02: on });
    assert.equal(othersAbsent(SEATS, presence, 's01'), true);
  });
});

describe('closeRoomState ("Masayı kapat")', () => {
  const room = (over = {}) => ({ mySeat: 's01', hostSeat: 's01', status: 'lobby', seats: SEATS, presence: { s01: on, s02: on }, ...over });

  test('only the current host sees it', () => {
    assert.deepEqual(closeRoomState(room({ mySeat: 's02' })), { visible: false, enabled: false, hint: null });
    assert.deepEqual(closeRoomState(room({ hostSeat: null })), { visible: false, enabled: false, hint: null });
    assert.equal(closeRoomState(room({ mySeat: undefined, hostSeat: undefined })).visible, false);
  });

  test('between matches the host can always close the table, others present or not', () => {
    assert.deepEqual(closeRoomState(room()), { visible: true, enabled: true, hint: null });
  });

  test('during a match: disabled with the hint while another seat is present', () => {
    assert.deepEqual(closeRoomState(room({ status: 'playing' })), { visible: true, enabled: false, hint: TEXT.closeRoomLocked });
    assert.match(TEXT.closeRoomLocked, /Maç bitince/);
  });

  test('during a match: enabled once every other seat is absent', () => {
    const state = closeRoomState(room({ status: 'playing', presence: { s01: on, s02: off } }));
    assert.deepEqual(state, { visible: true, enabled: true, hint: TEXT.closeRoomAllAbsent });
  });
});
