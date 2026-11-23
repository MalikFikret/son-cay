// Closing a room (decision Q67): deleteRoom (module) and the rules on the local emulator. The
// current host may delete rooms/{CODE} at any time (the "every other seat absent" condition
// during a match is the UI's alone); nobody else may. Once the room is gone, no late write
// (another device's onDisconnect presence write, a claim, a members entry) can recreate a
// partial room, and a new room can still be created.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { goOffline } from 'firebase/database';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, HOST_PIN, NOW, PIN, rejectsWithCode, roomFixtures, seedPin, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, dumpRoom, creationUpdate, joinUpdate, claimUpdate, transferUpdate, write, seedRoom } = roomFixtures(rt);

const BOB_PIN = seedPin(1); // bob sits in s02, carol in s03
const removeRoom = (db) => db.ref(`rooms/${CODE}`).remove();
const connCount = (entry) => Object.keys(entry?.conns ?? {}).length;
const presenceOf = async (seatId) => (await dumpRoom())?.presence?.[seatId] ?? null;

async function startMatch() {
  await liveRoomsApi('host').api.startMatch({ uid: 'host', code: CODE });
  assert.equal((await dumpRoom()).meta.status, 'playing');
}

describe('closing a room: who may delete rooms/{CODE}', () => {
  test('the host deletes the whole room between matches', async () => {
    await seedRoom(['bob', 'carol']);
    await assertSucceeds(removeRoom(rt.userDb('host')));
    assert.equal(await dumpRoom(), null);
  });

  test('the host deletes the room during a match, even with other players present (the UI limits that)', async () => {
    await seedRoom(['bob', 'carol']);
    await startMatch();
    await rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/presence`).set({ s02: { conns: { c1: true }, lastSeenAt: Date.now() } }));
    await assertSucceeds(removeRoom(rt.userDb('host')));
    assert.equal(await dumpRoom(), null);
  });

  test('a non-host member cannot delete the room, in the lobby or during a match', async () => {
    await seedRoom(['bob', 'carol']);
    await assertFails(removeRoom(rt.userDb('bob')));
    await startMatch();
    await assertFails(removeRoom(rt.userDb('carol')));
    assert.ok(await dumpRoom());
  });

  test('a stranger and an unauthenticated user cannot delete the room', async () => {
    await seedRoom(['bob', 'carol']);
    await assertFails(removeRoom(rt.userDb('mallory')));
    await assertFails(removeRoom(rt.guestDb()));
    assert.ok(await dumpRoom());
  });

  test('only the CURRENT host: after a hand-over the old host cannot, the new one can', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('host').handOverHost({ uid: 'host', code: CODE, seatId: 's02' });
    await assertFails(removeRoom(rt.userDb('host')));
    await assertSucceeds(removeRoom(rt.userDb('bob')));
  });

  test('a stale device of the host seat (recovered elsewhere) cannot delete the room', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('host2').recoverSeat({ uid: 'host2', code: CODE, seatId: 's01', pin: HOST_PIN });
    await assertFails(removeRoom(rt.userDb('host')));
    await assertSucceeds(removeRoom(rt.userDb('host2')));
  });

  test('the host cannot replace the room with something else through the room-level grant', async () => {
    await seedRoom(['bob']);
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}`).set({ meta: { status: 'lobby' } }));
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}/secrets`).remove());
    assert.equal((await dumpRoom()).secrets.s02, BOB_PIN);
  });
});

describe('closing a room: nothing can recreate a partial room afterwards', () => {
  test('presence writes of a former member (as its onDisconnect would send them) are refused', async () => {
    await seedRoom(['bob', 'carol']);
    await assertSucceeds(removeRoom(rt.userDb('host')));
    const bob = rt.userDb('bob');
    await assertFails(bob.ref(`rooms/${CODE}/presence/s02/lastSeenAt`).set(NOW));
    await assertFails(bob.ref(`rooms/${CODE}/presence/s02/conns/c1`).set(true));
    await assertFails(bob.ref().update({
      [`rooms/${CODE}/presence/s02/conns/c1`]: null,
      [`rooms/${CODE}/presence/s02/lastSeenAt`]: NOW,
    }));
    assert.equal(await dumpRoom(), null);
  });

  test('a real onDisconnect registered by another device fires after the deletion and writes nothing', async () => {
    await seedRoom(['bob', 'carol']);
    const bob = liveRoomsApi('bob');
    bob.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02', onError: () => {} });
    await waitFor(async () => connCount(await presenceOf('s02')) === 1, { what: 'bob present' });
    await roomsApi('host').deleteRoom({ uid: 'host', code: CODE });
    assert.equal(await dumpRoom(), null);
    goOffline(bob.db);
    await wait(1000);
    assert.equal(await dumpRoom(), null, 'the onDisconnect handler did not recreate the room');
  });

  test('a claim, a members entry or a recovery transfer into the deleted room is refused', async () => {
    await seedRoom(['bob', 'carol']);
    await assertSucceeds(removeRoom(rt.userDb('host')));
    await assertFails(write(rt.userDb('dave'), claimUpdate('dave', 's02', BOB_PIN)));
    await assertFails(rt.userDb('dave').ref(`rooms/${CODE}/members/dave`).set('s02'));
    await assertFails(write(rt.userDb('dave'), transferUpdate('dave', 's02')));
    await assertFails(write(rt.userDb('dave'), joinUpdate('dave', 's02')));
    assert.equal(await dumpRoom(), null);
  });

  test('a new room can still be created, also under the code of the deleted one', async () => {
    await seedRoom(['bob']);
    await assertSucceeds(removeRoom(rt.userDb('host')));
    await assertSucceeds(write(rt.userDb('alice'), creationUpdate('alice')));
    const room = await dumpRoom();
    assert.equal(room.seats.s01.uid, 'alice');
    assert.deepEqual(Object.keys(room.seats), ['s01']);
    // And through the module, with a fresh code.
    const created = await roomsApi('erin', { generateCode: () => 'XYZ789' }).createRoom({ uid: 'erin', name: 'Erin', pin: PIN, visibility: 'private', mode: 'classic' });
    assert.equal(created.code, 'XYZ789');
  });
});

describe('deleteRoom (module)', () => {
  test('the host closes the room: { deleted: true } and nothing is left', async () => {
    await seedRoom(['bob', 'carol']);
    assert.deepEqual(await roomsApi('host').deleteRoom({ uid: 'host', code: CODE }), { deleted: true });
    assert.equal(await dumpRoom(), null);
  });

  test('during a match too (the absent-players condition is checked by the UI, not here)', async () => {
    await seedRoom(['bob', 'carol']);
    await startMatch();
    assert.deepEqual(await roomsApi('host').deleteRoom({ uid: 'host', code: CODE }), { deleted: true });
    assert.equal(await dumpRoom(), null);
  });

  test('refusals: not the host, no seat, no room, bad input', async () => {
    await seedRoom(['bob']);
    await rejectsWithCode(roomsApi('bob').deleteRoom({ uid: 'bob', code: CODE }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('mallory').deleteRoom({ uid: 'mallory', code: CODE }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(roomsApi('host').deleteRoom({ uid: 'host', code: 'QQQQQQ' }), ROOM_ERR.ROOM_NOT_FOUND);
    await rejectsWithCode(roomsApi('host').deleteRoom({ uid: 'host', code: 'nope' }), ROOM_ERR.INVALID_CODE);
    await rejectsWithCode(roomsApi('host').deleteRoom({ uid: '', code: CODE }), ROOM_ERR.INVALID_UID);
    assert.ok(await dumpRoom());
  });

  test('stops this device\'s presence and host watcher first: its onDisconnect writes nothing later', async () => {
    await seedRoom(['bob']);
    const host = liveRoomsApi('host');
    const errors = [];
    host.api.startPresence({ uid: 'host', code: CODE, seatId: 's01', onError: (e) => errors.push(e) });
    host.api.watchHost({ uid: 'host', code: CODE, onError: (e) => errors.push(e) });
    await waitFor(async () => connCount(await presenceOf('s01')) === 1, { what: 'host present' });
    await host.api.deleteRoom({ uid: 'host', code: CODE });
    assert.equal(await dumpRoom(), null);
    goOffline(host.db);
    await wait(1000);
    assert.equal(await dumpRoom(), null);
    assert.deepEqual(errors, [], 'the stopped watchers report nothing');
  });

  test('the other devices\' waiting rooms end with a lost-seat or room-not-found error', async () => {
    await seedRoom(['bob']);
    const bob = liveRoomsApi('bob');
    const errors = [];
    const updates = [];
    bob.api.watchLobby({ uid: 'bob', code: CODE, onUpdate: (u) => updates.push(u), onError: (e) => errors.push(e) });
    await waitFor(() => updates.length > 0, { what: 'first lobby snapshot' });
    await roomsApi('host').deleteRoom({ uid: 'host', code: CODE });
    await waitFor(() => errors.length > 0, { what: 'watchLobby error' });
    assert.ok([ROOM_ERR.ROOM_NOT_FOUND, ROOM_ERR.SEAT_LOST, ROOM_ERR.NOT_MEMBER].includes(errors[0].code), errors[0].code);
    // What the UI then checks to tell "closed" from "kicked": the room is gone.
    await rejectsWithCode(roomsApi('bob').getRoomSummary({ uid: 'bob', code: CODE }), ROOM_ERR.ROOM_NOT_FOUND);
  });
});
