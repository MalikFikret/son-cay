// Room fixtures shared by the emulator tests: raw client updates (as a client could send them,
// bypassing src/rooms/), seeding, and a room API bound to a signed-in test user.

import assert from 'node:assert/strict';
import { get, onDisconnect, onValue, ref, runTransaction, serverTimestamp, update } from 'firebase/database';
import { defaultConfig } from '../src/engine/index.js';
import { MATCH_PAUSED, SEAT_IDS, createRoomApi, toDbValue } from '../src/rooms/index.js';

// Server timestamp placeholder, as the SDK sends it.
export const NOW = { '.sv': 'timestamp' };
export const CODE = 'ABC234';
export const PIN = '4821';
export const ARABIC_20 = 'محمد'.repeat(5);

// Seat PINs used by seedRoom: the host's, then one per joiner (s02, s03, ...).
export const HOST_PIN = '1357';
export const seedPin = (seatIndex) => String(2000 + seatIndex);

export async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

// The names/ key a raw client would write for `name`: its lower case, or null when the name
// cannot be a database key at all (not a string, empty, or a character illegal in keys); raw
// updates then leave the names entry out (the rules refuse such a name anyway).
export function rawNameKey(name) {
  if (typeof name !== 'string' || name.length === 0 || /[.$#[\]/\u0000-\u001f\u007f]/.test(name)) return null;
  return name.toLowerCase();
}

// Default names for raw joins: unique per call, so two raw joins never collide on the name
// unless a test asks for it.
let rawNameCounter = 0;
const nextRawName = () => `Player ${(rawNameCounter += 1)}`;

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls `check` until it returns a truthy value (returned) or the timeout passes (throws).
export async function waitFor(check, { timeout = 5000, interval = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(interval);
  }
}

/** @param {ReturnType<import('./helpers.js').useRulesTestEnv>} rt */
export function roomFixtures(rt) {
  // Only the original five deps: presence and host functions are not available.
  function roomsApi(uid, extra = {}) {
    return createRoomApi({ db: rt.modularDb(uid), ref, get, update, serverTimestamp, ...extra });
  }

  // All deps, as the browser game will pass them. Returns the api and its database (for
  // goOffline in tests).
  // Round pauses (decision Q79): a move refused with MATCH_PAUSED is retried once after the pause
  // is fast-forwarded (match/clockAt moved back by the time left, rules disabled), as if the
  // time had passed: the tests of everything else need not wait 4-7 s per round. The pause
  // itself is tested with { keepPauses: true }, which leaves the api as the game uses it.
  function liveRoomsApi(uid, { keepPauses = false, ...extra } = {}) {
    const db = rt.modularDb(uid);
    const api = createRoomApi({ db, ref, get, update, serverTimestamp, onValue, onDisconnect, runTransaction, ...extra });
    if (!keepPauses) {
      for (const name of ['submitAction', 'removeAbsentPlayer']) {
        const original = api[name];
        api[name] = async (input) => {
          const result = await original(input);
          if (result?.ok !== false || result.error?.code !== MATCH_PAUSED) return result;
          await fastForwardPause(input?.code ?? CODE, result.error.leftMs);
          return original(input);
        };
      }
    }
    return { db, api };
  }

  // Moves the running match's countdown start back by `leftMs` (+ a margin): its round pause is over.
  async function fastForwardPause(code, leftMs) {
    await rt.withRulesDisabled(async (db) => {
      const at = db.ref(`rooms/${code}/match/clockAt`);
      const value = (await at.get()).val();
      if (typeof value === 'number') await at.set(value - (Number(leftMs) || 0) - 1000);
    });
  }

  // Everything stored under rooms/{code}, read with rules disabled.
  async function dumpRoom(code = CODE) {
    return rt.withRulesDisabled(async (db) => (await db.ref(`rooms/${code}`).get()).val());
  }

  // The names entry of a raw update: names/{key} = seatId (left out if the name is not a key).
  function nameEntry(code, name, seatId, nameKeyOverride) {
    const key = nameKeyOverride === undefined ? rawNameKey(name) : nameKeyOverride;
    return key === null ? {} : { [`rooms/${code}/names/${key}`]: seatId };
  }

  // The multi-path update that creates a room (with the names entry of the host's name).
  function creationUpdate(uid, { code = CODE, mode = 'classic', meta = {}, seat = {}, seatId = 's01', pin = HOST_PIN } = {}) {
    const seatValue = { uid, name: 'Host', joinedAt: NOW, ...seat };
    return {
      [`rooms/${code}/meta`]: {
        visibility: 'private',
        mode,
        status: 'lobby',
        hostSeat: 's01',
        createdAt: NOW,
        ...meta,
      },
      [`rooms/${code}/settings`]: toDbValue(defaultConfig(mode)),
      [`rooms/${code}/seats/${seatId}`]: seatValue,
      [`rooms/${code}/members/${uid}`]: seatId,
      [`rooms/${code}/secrets/${seatId}`]: pin,
      ...nameEntry(code, seatValue.name, seatId),
    };
  }

  // The multi-path update that takes a seat (with the names entry of the seat's name, unless
  // `nameKey` overrides it; `nameKey: null` leaves the entry out).
  function joinUpdate(uid, seatId, { code = CODE, seat = {}, memberSeat = seatId, pin = PIN, name = nextRawName(), nameKey } = {}) {
    const seatValue = { uid, name, joinedAt: NOW, ...seat };
    return {
      [`rooms/${code}/seats/${seatId}`]: seatValue,
      [`rooms/${code}/members/${uid}`]: memberSeat,
      [`rooms/${code}/secrets/${seatId}`]: pin,
      ...nameEntry(code, seatValue.name, seatId, nameKey),
    };
  }

  // Recovery write 1: the claim.
  function claimUpdate(uid, seatId, pin, { code = CODE, claim = {} } = {}) {
    return { [`rooms/${code}/claims/${seatId}`]: { uid, pin, at: NOW, ...claim } };
  }

  // Recovery write 2: the transfer.
  function transferUpdate(uid, seatId, { code = CODE, memberSeat = seatId, seatUid = uid } = {}) {
    return {
      [`rooms/${code}/seats/${seatId}/uid`]: seatUid,
      [`rooms/${code}/members/${uid}`]: memberSeat,
    };
  }

  function write(db, values) {
    return db.ref().update(values);
  }

  // Creates room CODE with "host" in s01 (PIN HOST_PIN) and the given uids in s02, s03, ...
  // (PIN seedPin(index), named after the uid), through the rules.
  async function seedRoom(joiners = []) {
    await write(rt.userDb('host'), creationUpdate('host'));
    for (const [i, uid] of joiners.entries()) {
      await write(rt.userDb(uid), joinUpdate(uid, SEAT_IDS[i + 1], { pin: seedPin(i + 1), name: uid }));
    }
  }

  // Writes presence entries with rules disabled, e.g. { s01: { lastSeenAt: Date.now() - 61000 } }
  // or { s02: { conns: { c1: true } } }. Replaces the whole presence branch.
  async function seedPresence(presence, code = CODE) {
    await rt.withRulesDisabled((db) => db.ref(`rooms/${code}/presence`).set(presence));
  }

  async function setJoinedAt(seatId, joinedAt, code = CODE) {
    await rt.withRulesDisabled((db) => db.ref(`rooms/${code}/seats/${seatId}/joinedAt`).set(joinedAt));
  }

  return { roomsApi, liveRoomsApi, fastForwardPause, seedPresence, setJoinedAt, dumpRoom, creationUpdate, joinUpdate, claimUpdate, transferUpdate, write, seedRoom };
}
