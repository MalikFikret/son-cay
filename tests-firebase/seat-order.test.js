// The host's manual seat order (rooms/{CODE}/seatOrder), the match start that follows it, and
// the waiting room's Tablo reads (watchLobby's seatOrder / session, getLastMatch), on the local
// emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, NOW, PIN, rejectsWithCode, roomFixtures, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, dumpRoom, seedRoom } = roomFixtures(rt);

const live = (uid) => liveRoomsApi(uid, { randomSeed: () => 12345 }).api;
const ORDER = `rooms/${CODE}/seatOrder`;
const UID = { s01: 'host', s02: 'bob', s03: 'carol', s04: 'dave' };
const stateOf = async () => JSON.parse((await dumpRoom()).match.stateJson);

describe('setSeatOrder / clearSeatOrder (module)', () => {
  test('the host saves, replaces and clears the order in the lobby', async () => {
    await seedRoom(['bob', 'carol']);
    assert.deepEqual(await roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order: ['s03', 's01', 's02'] }), { seats: ['s03', 's01', 's02'] });
    let stored = (await dumpRoom()).seatOrder;
    assert.deepEqual(stored.seats, ['s03', 's01', 's02']);
    assert.equal(typeof stored.savedAt, 'number');
    await roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order: ['s02'] });
    stored = (await dumpRoom()).seatOrder;
    assert.deepEqual(stored.seats, ['s02']);
    await roomsApi('host').clearSeatOrder({ uid: 'host', code: CODE });
    assert.equal((await dumpRoom()).seatOrder, undefined);
  });

  test('a bad order is refused before any write (INVALID_SEAT_ORDER)', async () => {
    await seedRoom(['bob']);
    const fifteen = Array.from({ length: 15 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);
    for (const order of [[], ['s01', 's01'], ['s16'], ['x'], 's01', null, [...fifteen, 's01'], [1, 2]]) {
      await rejectsWithCode(roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order }), ROOM_ERR.INVALID_SEAT_ORDER);
    }
    assert.equal((await dumpRoom()).seatOrder, undefined);
    // 15 distinct ids are fine (seats that are free are skipped at start).
    await roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order: fifteen });
  });

  test('a non-host member, a non-member, the old host after a handover, and anyone during a match are refused', async () => {
    await seedRoom(['bob', 'carol']);
    await rejectsWithCode(roomsApi('bob').setSeatOrder({ uid: 'bob', code: CODE, order: ['s02'] }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('zed').setSeatOrder({ uid: 'zed', code: CODE, order: ['s02'] }), ROOM_ERR.NOT_MEMBER);
    await live('host').handOverHost({ uid: 'host', code: CODE, seatId: 's02' });
    await rejectsWithCode(roomsApi('host').clearSeatOrder({ uid: 'host', code: CODE }), ROOM_ERR.WRITE_DENIED);
    await roomsApi('bob').setSeatOrder({ uid: 'bob', code: CODE, order: ['s03', 's02', 's01'] });
    await live('bob').startMatch({ uid: 'bob', code: CODE });
    await rejectsWithCode(roomsApi('bob').clearSeatOrder({ uid: 'bob', code: CODE }), ROOM_ERR.NOT_IN_LOBBY);
    await rejectsWithCode(roomsApi('bob').setSeatOrder({ uid: 'bob', code: CODE, order: ['s01'] }), ROOM_ERR.NOT_IN_LOBBY);
  });
});

describe('rules: seatOrder', () => {
  const value = (seats) => ({ seats, savedAt: NOW });

  test('the current host may write, replace and delete it in the lobby; members read it', async () => {
    await seedRoom(['bob']);
    const host = rt.userDb('host');
    await assertSucceeds(host.ref(ORDER).set(value(['s02', 's01'])));
    await assertSucceeds(host.ref(ORDER).set(value(['s01'])));
    await assertSucceeds(rt.userDb('bob').ref(ORDER).get());
    await assertFails(rt.userDb('zed').ref(ORDER).get());
    await assertSucceeds(host.ref(ORDER).remove());
  });

  test('a non-host member, a non-member and the old host after a handover cannot', async () => {
    await seedRoom(['bob', 'carol']);
    for (const uid of ['bob', 'zed']) await assertFails(rt.userDb(uid).ref(ORDER).set(value(['s01'])));
    await assertSucceeds(rt.userDb('host').ref(ORDER).set(value(['s01'])));
    await assertFails(rt.userDb('bob').ref(ORDER).remove());
    await live('host').handOverHost({ uid: 'host', code: CODE, seatId: 's02' });
    await assertFails(rt.userDb('host').ref(ORDER).set(value(['s02'])));
    await assertFails(rt.userDb('host').ref(ORDER).remove());
    await assertSucceeds(rt.userDb('bob').ref(ORDER).set(value(['s02'])));
  });

  test('nobody can change it during a match, nor in the write that starts one', async () => {
    await seedRoom(['bob', 'carol']);
    await assertFails(rt.userDb('host').ref().update({ [`rooms/${CODE}/meta/status`]: 'playing', [ORDER]: value(['s01']) }));
    await assertSucceeds(rt.userDb('host').ref(ORDER).set(value(['s01'])));
    await live('host').startMatch({ uid: 'host', code: CODE });
    await assertFails(rt.userDb('host').ref(ORDER).set(value(['s02'])));
    await assertFails(rt.userDb('host').ref(ORDER).remove());
  });

  test('bad values are refused', async () => {
    await seedRoom(['bob']);
    const host = rt.userDb('host');
    const fifteen = Array.from({ length: 15 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);
    for (const bad of [
      value(['s01', 's01']),
      value(['s01', 's02', 's01']),
      value(['s16']),
      value(['S01']),
      value([1]),
      value({ 15: 's01' }),
      value([...fifteen, 's01']),
      { seats: ['s01'] },
      { seats: ['s01'], savedAt: 5 },
      { savedAt: NOW },
      { ...value(['s01']), extra: true },
      's01',
    ]) {
      await assertFails(host.ref(ORDER).set(bad));
    }
    await assertSucceeds(host.ref(ORDER).set(value(fifteen)));
    await assertFails(host.ref(`${ORDER}/seats/1`).set('s01'));
  });
});

describe('startMatch with a seat order', () => {
  test('the players follow the saved order and the engine does not shuffle', async () => {
    await seedRoom(['bob', 'carol', 'dave']);
    await roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order: ['s03', 's01', 's04', 's02'] });
    await live('host').startMatch({ uid: 'host', code: CODE });
    const state = await stateOf();
    assert.deepEqual(state.players.map((p) => p.id), ['s03', 's01', 's04', 's02']);
    assert.equal(state.config.randomizeSeats, false);
    // The room's own settings are unchanged.
    assert.equal((await dumpRoom()).settings.randomizeSeats, true);
  });

  test('without an order the settings decide (random by default)', async () => {
    await seedRoom(['bob', 'carol']);
    await live('host').startMatch({ uid: 'host', code: CODE });
    const state = await stateOf();
    assert.equal(state.config.randomizeSeats, true);
    assert.deepEqual(state.players.map((p) => p.id).sort(), ['s01', 's02', 's03']);
  });

  test('seats that left are skipped; a player who sat down after the save plays last', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order: ['s03', 's02', 's01'] });
    await roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE });
    // A newcomer takes the freed s02 after the save, and another one takes s04.
    await roomsApi('erin').joinRoom({ uid: 'erin', code: CODE, name: 'Erin', pin: PIN });
    await roomsApi('dave').joinRoom({ uid: 'dave', code: CODE, name: 'Dave', pin: PIN });
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'erin');
    assert.ok(room.seats.s02.joinedAt > room.seatOrder.savedAt);
    await live('host').startMatch({ uid: 'host', code: CODE });
    assert.deepEqual((await stateOf()).players.map((p) => p.id), ['s03', 's01', 's02', 's04']);
  });
});

describe('waiting room reads for the Tablo', () => {
  // Let every countdown run out until the match ends (the ending device writes the results).
  async function playToTheEnd() {
    for (let i = 0; i < 300; i += 1) {
      const state = await stateOf();
      if (state.status === 'ended') return;
      const uid = UID[state.clock.playerId];
      const result = await live(uid).submitAction({ uid, code: CODE, action: { type: 'timeout', seq: state.clock.seq } });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    throw new Error('the match did not end');
  }

  test('watchLobby delivers the saved order and the session table', async () => {
    await seedRoom(['bob', 'carol']);
    const { api } = liveRoomsApi('bob');
    const updates = [];
    const stop = api.watchLobby({ uid: 'bob', code: CODE, onUpdate: (u) => updates.push(u) });
    await waitFor(() => updates.length > 0, { what: 'first snapshot' });
    assert.equal(updates.at(-1).seatOrder, null);
    assert.equal(updates.at(-1).session.matches, 0);
    await roomsApi('host').setSeatOrder({ uid: 'host', code: CODE, order: ['s02', 's01'] });
    await waitFor(() => updates.at(-1).seatOrder?.seats?.join() === 's02,s01', { what: 'the order' });
    stop();
  });

  test('getLastMatch: null before the first match, then the public summary with names', async () => {
    await seedRoom(['bob', 'carol']);
    assert.equal(await roomsApi('bob').getLastMatch({ uid: 'bob', code: CODE }), null);
    await live('host').startMatch({ uid: 'host', code: CODE });
    assert.equal(await roomsApi('bob').getLastMatch({ uid: 'bob', code: CODE }), null);
    await playToTheEnd();
    await waitFor(async () => (await dumpRoom()).meta.status === 'lobby', { what: 'the results' });
    const summary = await roomsApi('bob').getLastMatch({ uid: 'bob', code: CODE });
    assert.equal(summary.n, 1);
    assert.equal(summary.rows.length, 3);
    assert.deepEqual(summary.rows.map((r) => r.name).sort(), ['Host', 'bob', 'carol']);
    const scores = await roomsApi('bob').getSessionScores({ uid: 'bob', code: CODE });
    for (const row of summary.rows) assert.equal(row.points, scores[row.seatId]);

    // A player who left (and the newcomer on their seat) shows as "left": no name.
    await roomsApi('carol').leaveRoom({ uid: 'carol', code: CODE });
    await roomsApi('erin').joinRoom({ uid: 'erin', code: CODE, name: 'Erin', pin: PIN });
    const after = await roomsApi('bob').getLastMatch({ uid: 'bob', code: CODE });
    assert.equal(after.rows.find((r) => r.seatId === 's03').name, null);
    await rejectsWithCode(roomsApi('zed').getLastMatch({ uid: 'zed', code: CODE }), ROOM_ERR.NOT_MEMBER);
  });
});
