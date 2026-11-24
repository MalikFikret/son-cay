// Players who join during a match wait for the next one (task 3.5c, decision Q18), on the local
// emulator: joinRoom, watchMatch, submitAction, recoverSeat, startMatch and the waiting rules.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { viewFor, ROUND_INTRO_MS } from '../src/engine/index.js';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, PIN, rejectsWithCode, roomFixtures, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, fastForwardPause, dumpRoom, joinUpdate, write, seedRoom } = roomFixtures(rt);

const SEED = 12345;
const live = (uid) => liveRoomsApi(uid, { randomSeed: () => SEED }).api;
const UID = { s01: 'host', s02: 'bob', s03: 'carol' };
const stateOf = async () => JSON.parse((await dumpRoom()).match.stateJson);

async function startedRoom() {
  await seedRoom(['bob', 'carol']);
  await live('host').startMatch({ uid: 'host', code: CODE });
  // The first round's intro (decision Q79) is over at once: these tests are about waiting seats.
  await fastForwardPause(CODE, ROUND_INTRO_MS);
}

// Let every countdown run out until the match ends (the ending device writes the results).
async function playToTheEnd() {
  for (let i = 0; i < 200; i += 1) {
    const state = await stateOf();
    if (state.status === 'ended') return;
    const uid = UID[state.clock.playerId];
    const result = await live(uid).submitAction({ uid, code: CODE, action: { type: 'timeout', seq: state.clock.seq } });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  throw new Error('the match did not end');
}

describe('waiting seats', () => {
  test('joining during a match gives a waiting seat; joining in the lobby does not', async () => {
    await seedRoom(['bob']);
    assert.deepEqual(await roomsApi('carol').joinRoom({ uid: 'carol', code: CODE, name: 'Carol', pin: PIN }), { seatId: 's03' });
    await live('host').startMatch({ uid: 'host', code: CODE });
    assert.deepEqual(await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN }), { seatId: 's04', waiting: true });
    const room = await dumpRoom();
    assert.equal(room.seats.s04.waiting, true);
    assert.equal(room.seats.s03.waiting, undefined);
    assert.equal(room.members.eve, 's04');
    assert.equal(room.names.eve, 's04');
    // Names stay unique during a match too.
    await rejectsWithCode(roomsApi('zed').joinRoom({ uid: 'zed', code: CODE, name: 'EVE', pin: PIN }), ROOM_ERR.NAME_TAKEN);
    // Asking again gives the same (waiting) seat back.
    assert.deepEqual(await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN }), { seatId: 's04' });
  });

  test('the 15-seat limit counts waiting seats', async () => {
    await startedRoom();
    for (let i = 4; i <= 15; i += 1) {
      const uid = `w${i}`;
      const result = await roomsApi(uid).joinRoom({ uid, code: CODE, name: uid, pin: PIN });
      assert.deepEqual(result, { seatId: `s${String(i).padStart(2, '0')}`, waiting: true });
    }
    await rejectsWithCode(roomsApi('late').joinRoom({ uid: 'late', code: CODE, name: 'late', pin: PIN }), ROOM_ERR.ROOM_FULL);
    assert.equal(Object.keys((await dumpRoom()).seats).length, 15);
  });

  test('a waiting seat watches as a spectator and cannot act', async () => {
    await startedRoom();
    await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN });
    const deliveries = [];
    const stop = live('eve').watchMatch({ uid: 'eve', code: CODE, onUpdate: (u) => deliveries.push(u) });
    try {
      await waitFor(() => deliveries.length === 1, { what: 'delivery' });
      const state = await stateOf();
      assert.equal(deliveries[0].view.role, 'spectator');
      assert.deepEqual(deliveries[0].view, viewFor(state, null));
      assert.deepEqual(deliveries[0].legalActions, []);
      assert.ok(deliveries[0].events.every((e) => e.visibility === 'public'));
    } finally {
      stop();
    }
    const state = await stateOf();
    const before = (await dumpRoom()).match;
    for (const action of [
      { type: 'chooseTarget', target: 's01' },
      { type: 'setPreference', confirmShot: false },
      { type: 'useTool', tool: 'detector' },
    ]) {
      const result = await live('eve').submitAction({ uid: 'eve', code: CODE, action });
      assert.equal(result.ok, false, JSON.stringify(result));
    }
    // The engine refuses the waiting seat as a player; it cannot even send timeouts that count
    // as its own turn (a timeout is the clock's, and only the current one is accepted).
    assert.deepEqual((await dumpRoom()).match, before);
    assert.equal(state.players.some((p) => p.id === 's04'), false);
    await rejectsWithCode(live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's04' }), ROOM_ERR.PLAYER_NOT_ALIVE);
  });

  test('recovery during a match returns the player to their place, not to a waiting seat', async () => {
    await startedRoom();
    assert.deepEqual(await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: '2001' }), { seatId: 's02' });
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'bob2');
    assert.equal(room.seats.s02.waiting, undefined);
    const deliveries = [];
    const stop = live('bob2').watchMatch({ uid: 'bob2', code: CODE, onUpdate: (u) => deliveries.push(u) });
    try {
      await waitFor(() => deliveries.length === 1, { what: 'delivery' });
      assert.equal(deliveries[0].view.viewer, 's02');
      for (const action of deliveries[0].legalActions) assert.equal(action.playerId, 's02');
    } finally {
      stop();
    }
    // A waiting seat recovered during the match stays waiting.
    await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: '4444' });
    await roomsApi('eve2').recoverSeat({ uid: 'eve2', code: CODE, seatId: 's04', pin: '4444' });
    assert.equal((await dumpRoom()).seats.s04.waiting, true);
  });

  test('the next startMatch includes the waiting seat and clears its flag', async () => {
    await startedRoom();
    await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN });
    await playToTheEnd();
    const ended = await dumpRoom();
    assert.equal(ended.meta.status, 'lobby');
    assert.equal(ended.seats.s04.waiting, true, 'still waiting between matches');
    const second = await live('host').startMatch({ uid: 'host', code: CODE });
    assert.deepEqual(second, { n: 2, players: ['s01', 's02', 's03', 's04'] });
    const room = await dumpRoom();
    assert.equal(room.seats.s04.waiting, undefined);
    assert.ok(JSON.parse(room.match.stateJson).players.some((p) => p.id === 's04'));
    // Session points: the waiting player starts at 0 (no result recorded their seat).
    const scores = await live('eve').getSessionScores({ uid: 'eve', code: CODE });
    assert.equal(scores.s04, 0);
  });
});

describe('rules: the waiting flag', () => {
  test('a new seat during a match must have waiting: true; in the lobby it must not have it', async () => {
    await seedRoom(['bob']);
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's03', { seat: { waiting: true } })), 'waiting in the lobby');
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's03', { seat: { waiting: false } })), 'waiting false in the lobby');
    await assertSucceeds(write(rt.userDb('carol'), joinUpdate('carol', 's03', { name: 'Carol' })));
    await live('host').startMatch({ uid: 'host', code: CODE });
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's04', { name: 'Eve' })), 'no flag during a match');
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's04', { name: 'Eve', seat: { waiting: false } })), 'false');
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's04', { name: 'Eve', seat: { waiting: 'yes' } })), 'not true');
    await assertSucceeds(write(rt.userDb('eve'), joinUpdate('eve', 's04', { name: 'Eve', seat: { waiting: true } })));
  });

  test('a member cannot set or clear waiting by a direct write', async () => {
    await startedRoom();
    await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN });
    const flag = (seatId) => `rooms/${CODE}/seats/${seatId}/waiting`;
    await assertFails(rt.userDb('eve').ref(flag('s04')).remove(), 'the waiting player clears it');
    await assertFails(rt.userDb('host').ref(flag('s04')).remove(), 'the host clears it during the match');
    await assertFails(rt.userDb('bob').ref(flag('s02')).set(true), 'a player sets it on their own seat');
    await assertFails(rt.userDb('host').ref(flag('s02')).set(true), 'the host sets it on another seat');
    await assertFails(rt.userDb('dave').ref(flag('s04')).remove(), 'a stranger');
    await playToTheEnd();
    // Between matches the flag stays until startMatch: the host cannot clear it on its own.
    await assertFails(rt.userDb('host').ref(flag('s04')).remove(), 'the host clears it in the lobby without starting');
    await assertFails(rt.userDb('eve').ref(flag('s04')).remove(), 'the waiting player clears it in the lobby');
    assert.equal((await dumpRoom()).seats.s04.waiting, true);
  });
});
