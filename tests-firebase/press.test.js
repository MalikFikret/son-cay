// The press signal (step 4.4b): rooms/{CODE}/press/{seatId} = { n, seq, at }, on the local
// emulator. Rules: members read; only the valid member on that seat writes (while a match runs)
// or removes it; strict shape; at === server time; no target, no other field. Leaving and
// kicking remove it with the seat. The client functions setPress / clearPress / watchPress.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { goOffline } from 'firebase/database';
import { useRulesTestEnv } from './helpers.js';
import { CODE, NOW, roomFixtures, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, dumpRoom, write, seedRoom } = roomFixtures(rt);

const pressPath = (seatId) => `rooms/${CODE}/press/${seatId}`;
const signal = (extra = {}) => ({ n: 1, seq: 3, at: NOW, ...extra });
const setStatus = (status) => rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/meta/status`).set(status));
const pressOf = async (seatId) => (await dumpRoom())?.press?.[seatId] ?? null;

// host in s01, bob in s02, carol in s03; a match is running.
async function playingRoom() {
  await seedRoom(['bob', 'carol']);
  await setStatus('playing');
}

describe('rules: press signal', () => {
  test('a member writes and removes the signal for their own seat only', async () => {
    await playingRoom();
    const bob = rt.userDb('bob');
    await assertSucceeds(bob.ref(pressPath('s02')).set(signal()));
    assert.equal((await pressOf('s02')).seq, 3);
    await assertFails(bob.ref(pressPath('s03')).set(signal()));
    await assertFails(bob.ref(pressPath('s01')).set(signal()));
    await assertFails(rt.userDb('carol').ref(pressPath('s02')).remove());
    await assertFails(rt.userDb('host').ref(pressPath('s02')).remove());
    await assertSucceeds(bob.ref(pressPath('s02')).remove());
    assert.equal(await pressOf('s02'), null);
    // Also as part of a multi-path update, and an empty seat cannot be written for.
    await assertSucceeds(write(bob, { [pressPath('s02')]: signal() }));
    await assertFails(write(bob, { [pressPath('s05')]: signal() }));
  });

  test('non-members and guests can neither read nor write it', async () => {
    await playingRoom();
    await assertSucceeds(rt.userDb('bob').ref(pressPath('s02')).set(signal()));
    await assertFails(rt.userDb('dave').ref(`rooms/${CODE}/press`).get());
    await assertFails(rt.userDb('dave').ref(pressPath('s02')).get());
    await assertFails(rt.guestDb().ref(`rooms/${CODE}/press`).get());
    await assertFails(rt.userDb('dave').ref(pressPath('s04')).set(signal()));
    await assertFails(rt.userDb('dave').ref(pressPath('s02')).remove());
    await assertFails(rt.guestDb().ref(pressPath('s02')).remove());
    // Members read the whole branch.
    await assertSucceeds(rt.userDb('carol').ref(`rooms/${CODE}/press`).get());
    await assertSucceeds(rt.userDb('host').ref(pressPath('s02')).get());
  });

  test('strict shape: wrong types, missing or extra fields, a target, or a client time are refused', async () => {
    await playingRoom();
    const bob = rt.userDb('bob').ref(pressPath('s02'));
    await assertFails(bob.set(signal({ target: 's03' })));
    await assertFails(bob.set(signal({ extra: 1 })));
    await assertFails(bob.set({ n: 1, seq: 3 }));
    await assertFails(bob.set({ seq: 3, at: NOW }));
    await assertFails(bob.set({ n: 1, at: NOW }));
    await assertFails(bob.set(signal({ seq: '3' })));
    await assertFails(bob.set(signal({ n: -1 })));
    await assertFails(bob.set(signal({ seq: true })));
    await assertFails(bob.set(signal({ at: Date.now() })));
    await assertFails(bob.set(signal({ at: Date.now() + 60000 })));
    await assertFails(bob.set(true));
    await assertFails(bob.set('pressing'));
    await assertSucceeds(bob.set(signal()));
    await assertFails(rt.userDb('bob').ref(`${pressPath('s02')}/target`).set('s03'));
    await assertFails(rt.userDb('bob').ref(`${pressPath('s02')}/seq`).set(4));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/press/notASeat`).set(signal()));
  });

  test('written only while a match runs; the owner may still remove it in the lobby', async () => {
    await seedRoom(['bob']);
    const bob = rt.userDb('bob').ref(pressPath('s02'));
    await assertFails(bob.set(signal()));
    await setStatus('playing');
    await assertSucceeds(bob.set(signal()));
    await setStatus('lobby');
    await assertSucceeds(bob.remove());
  });

  test('a stale members entry (seat recovered elsewhere) grants nothing', async () => {
    await playingRoom();
    await rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/seats/s02/uid`).set('newbob'));
    await rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/members/newbob`).set('s02'));
    await assertFails(rt.userDb('bob').ref(pressPath('s02')).set(signal()));
    await assertSucceeds(rt.userDb('newbob').ref(pressPath('s02')).set(signal()));
    await assertFails(rt.userDb('bob').ref(pressPath('s02')).remove());
  });

  test('leaving and kicking remove the entry with the seat', async () => {
    await playingRoom();
    await assertSucceeds(rt.userDb('bob').ref(pressPath('s02')).set(signal()));
    await assertSucceeds(rt.userDb('carol').ref(pressPath('s03')).set(signal()));
    await setStatus('lobby');
    await roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE });
    await roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's03' });
    const room = await dumpRoom();
    assert.equal(room.press ?? null, null);
    assert.equal(room.seats.s02 ?? null, null);
    assert.equal(room.seats.s03 ?? null, null);
  });

  test('nothing can recreate a press entry in a deleted room', async () => {
    await playingRoom();
    await roomsApi('host').deleteRoom({ uid: 'host', code: CODE });
    await assertFails(rt.userDb('bob').ref(pressPath('s02')).set(signal()));
    assert.equal(await dumpRoom(), null);
  });
});

describe('client: setPress / clearPress / watchPress', () => {
  test('set, watch, clear; the target is never part of it', async () => {
    await playingRoom();
    const { api: bob } = liveRoomsApi('bob');
    const { api: carol } = liveRoomsApi('carol');
    const seen = [];
    const stop = carol.watchPress({ uid: 'carol', code: CODE, onUpdate: (press) => seen.push(press) });
    await bob.setPress({ uid: 'bob', code: CODE, seatId: 's02', n: 1, seq: 3 });
    await waitFor(() => seen.some((p) => p.s02?.seq === 3), { what: 'press seen' });
    const entry = seen.find((p) => p.s02).s02;
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'n', 'seq']);
    assert.ok(Math.abs(entry.at - Date.now()) < 60000);
    await bob.clearPress({ uid: 'bob', code: CODE, seatId: 's02' });
    await waitFor(() => seen.at(-1).s02 === undefined, { what: 'press cleared' });
    stop();
  });

  test('a presser who disconnects mid-press leaves nothing behind (onDisconnect)', async () => {
    await playingRoom();
    const { db, api: bob } = liveRoomsApi('bob');
    await bob.setPress({ uid: 'bob', code: CODE, seatId: 's02', n: 1, seq: 3 });
    assert.notEqual(await pressOf('s02'), null);
    goOffline(db);
    await waitFor(async () => (await pressOf('s02')) === null, { what: 'onDisconnect removal' });
  });

  test('another seat cannot be pressed for; bad numbers are refused before writing', async () => {
    await playingRoom();
    const { api: bob } = liveRoomsApi('bob');
    await assert.rejects(bob.setPress({ uid: 'bob', code: CODE, seatId: 's03', n: 1, seq: 3 }));
    await assert.rejects(bob.setPress({ uid: 'bob', code: CODE, seatId: 's02', n: 1, seq: -2 }), { code: 'INVALID_ACTION' });
    assert.equal(await pressOf('s03'), null);
  });

  test('a non-member cannot watch it', async () => {
    await playingRoom();
    const { api: dave } = liveRoomsApi('dave');
    const errors = [];
    dave.watchPress({ uid: 'dave', code: CODE, onUpdate: () => {}, onError: (error) => errors.push(error) });
    await waitFor(() => errors.length === 1, { what: 'refused listener' });
    assert.equal(errors[0].code, 'SEAT_LOST');
  });
});
