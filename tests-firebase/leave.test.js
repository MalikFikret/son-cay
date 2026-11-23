// Leaving a room between matches: the client module (leaveRoom) and the deletion rules, on the
// local emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { goOffline, update } from 'firebase/database';
import { ROOM_ERR, SEAT_IDS } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, HOST_PIN, PIN, rejectsWithCode, roomFixtures, seedPin, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, seedPresence, dumpRoom, joinUpdate, claimUpdate, write, seedRoom } = roomFixtures(rt);

const BOB_PIN = seedPin(1); // bob sits in s02, carol in s03, dave in s04
const present = () => ({ conns: { seeded: true }, lastSeenAt: Date.now() - 5000 });

// The deletions of a leave, as a raw client would send them. `nameKey` is the names entry of
// the seat's name: in seedRoom rooms the host is "Host" and every joiner is named after their
// uid, so it defaults to the uid in lower case.
function leaveUpdate(uid, seatId, extra = {}, nameKey = uid.toLowerCase()) {
  return {
    [`rooms/${CODE}/seats/${seatId}`]: null,
    [`rooms/${CODE}/secrets/${seatId}`]: null,
    [`rooms/${CODE}/claims/${seatId}`]: null,
    [`rooms/${CODE}/presence/${seatId}`]: null,
    [`rooms/${CODE}/members/${uid}`]: null,
    [`rooms/${CODE}/names/${nameKey}`]: null,
    ...extra,
  };
}

const deleteRoom = (uid) => rt.userDb(uid).ref(`rooms/${CODE}`).remove();
const setStatus = (status) => rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/meta/status`).set(status));

// The room is valid: hostSeat points to an existing seat, and every members entry / secret /
// claim / presence entry belongs to an existing seat (stale members entries may point to a seat
// that now has another uid, but never to a missing one).
function assertValidRoom(room) {
  assert.ok(room.seats?.[room.meta.hostSeat], `hostSeat ${room.meta.hostSeat} points to a missing seat`);
  // Names: one entry per seat, under the seat's name in lower case, and nothing else.
  const expectedNames = {};
  for (const [seatId, seat] of Object.entries(room.seats)) expectedNames[seat.name.toLowerCase()] = seatId;
  assert.deepEqual(room.names ?? {}, expectedNames, 'names index out of sync with the seats');
  for (const branch of ['secrets', 'claims', 'presence']) {
    for (const seatId of Object.keys(room[branch] ?? {})) assert.ok(room.seats[seatId], `orphan ${branch}/${seatId}`);
  }
  for (const [uid, seatId] of Object.entries(room.members ?? {})) assert.ok(room.seats[seatId], `orphan members/${uid}`);
  for (const seatId of Object.keys(room.seats)) assert.ok(room.secrets?.[seatId], `seat ${seatId} without a secret`);
}

describe('leaveRoom (module)', () => {
  test('an ordinary player leaves: all its nodes are gone (names entry included), the rest is untouched, hostSeat unchanged', async () => {
    await seedRoom(['bob', 'carol']);
    await write(rt.userDb('dave'), claimUpdate('dave', 's02', '0000'));
    await seedPresence({ s01: present(), s02: present(), s03: present() });
    const before = await dumpRoom();
    // Only the original deps: leaving does not need the presence functions.
    const result = await roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE });
    assert.deepEqual(result, { deletedRoom: false, hostSeat: null });

    const after = await dumpRoom();
    const expected = structuredClone(before);
    delete expected.seats.s02;
    delete expected.secrets.s02;
    delete expected.claims;
    delete expected.presence.s02;
    delete expected.members.bob;
    delete expected.names.bob;
    assert.deepEqual(after, expected);
    assertValidRoom(after);
  });

  test('the host leaves: hostSeat moves to a present seat when there is one', async () => {
    await seedRoom(['bob', 'carol', 'dave']);
    await seedPresence({ s03: present() });
    const result = await roomsApi('host').leaveRoom({ uid: 'host', code: CODE });
    assert.deepEqual(result, { deletedRoom: false, hostSeat: 's03' });
    const room = await dumpRoom();
    assert.equal(room.meta.hostSeat, 's03');
    assert.equal(room.seats.s01, undefined);
    assertValidRoom(room);
  });

  test('the host leaves with nobody present: hostSeat moves to another occupied seat, never the leaver', async () => {
    for (const r of [0, 0.5, 0.99]) {
      await rt.env.clearDatabase();
      await seedRoom(['bob', 'carol']);
      await seedPresence({ s01: present() }); // only the leaving host is present
      const result = await roomsApi('host', { random: () => r }).leaveRoom({ uid: 'host', code: CODE });
      assert.ok(['s02', 's03'].includes(result.hostSeat), `random ${r} chose ${result.hostSeat}`);
      const room = await dumpRoom();
      assert.equal(room.meta.hostSeat, result.hostSeat);
      assertValidRoom(room);
    }
  });

  test('the last seated player leaves: the whole room is gone', async () => {
    const { code } = await roomsApi('alice').createRoom({ uid: 'alice', name: 'Alice', pin: PIN, visibility: 'private', mode: 'custom' });
    assert.deepEqual(await roomsApi('alice').leaveRoom({ uid: 'alice', code }), { deletedRoom: true, hostSeat: null });
    assert.equal(await dumpRoom(code), null);
    await rejectsWithCode(roomsApi('bob').joinRoom({ uid: 'bob', code, name: 'Bob', pin: PIN }), ROOM_ERR.ROOM_NOT_FOUND);
  });

  test('the last player also deletes a room that still holds stale members entries', async () => {
    await seedRoom();
    await roomsApi('host2').recoverSeat({ uid: 'host2', code: CODE, seatId: 's01', pin: HOST_PIN });
    assert.deepEqual(await roomsApi('host2').leaveRoom({ uid: 'host2', code: CODE }), { deletedRoom: true, hostSeat: null });
    assert.equal(await dumpRoom(), null);
  });

  test('leaving also removes stale members entries that point to the seat', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await rejectsWithCode(roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE }), ROOM_ERR.NOT_MEMBER);
    await roomsApi('bob2').leaveRoom({ uid: 'bob2', code: CODE });
    const room = await dumpRoom();
    assert.deepEqual(room.members, { host: 's01', carol: 's03' });
    assertValidRoom(room);
  });

  test('after leaving, a new player takes the same slot with a fresh PIN', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE });
    assert.deepEqual(await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: '9090' }), { seatId: 's02' });
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'eve');
    assert.equal(room.seats.s02.name, 'Eve');
    assert.equal(room.secrets.s02, '9090');
    assertValidRoom(room);
    // The old PIN is gone with the old seat: it no longer recovers s02.
    await rejectsWithCode(
      roomsApi('bob').recoverSeat({ uid: 'bob', code: CODE, seatId: 's02', pin: BOB_PIN }),
      ROOM_ERR.WRONG_PIN,
    );
  });

  test('leaving fails clearly: not a member, missing room, a match in progress, bad input', async () => {
    await seedRoom(['bob']);
    await rejectsWithCode(roomsApi('dave').leaveRoom({ uid: 'dave', code: CODE }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(roomsApi('bob').leaveRoom({ uid: 'bob', code: 'ZZZ999' }), ROOM_ERR.ROOM_NOT_FOUND);
    await rejectsWithCode(roomsApi('bob').leaveRoom({ uid: 'b/b', code: CODE }), ROOM_ERR.INVALID_UID);
    await rejectsWithCode(roomsApi('bob').leaveRoom({ uid: 'bob', code: 'ABC' }), ROOM_ERR.INVALID_CODE);
    await setStatus('playing');
    const before = await dumpRoom();
    await rejectsWithCode(roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE }), ROOM_ERR.NOT_IN_LOBBY);
    await rejectsWithCode(roomsApi('host').leaveRoom({ uid: 'host', code: CODE }), ROOM_ERR.NOT_IN_LOBBY);
    assert.deepEqual(await dumpRoom(), before);
  });

  test('a refused write is retried at most 3 times in total; other errors are not retried', async () => {
    await seedRoom(['bob']);
    let calls = 0;
    const denied = () => {
      calls += 1;
      return Promise.reject(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));
    };
    await rejectsWithCode(roomsApi('bob', { update: denied }).leaveRoom({ uid: 'bob', code: CODE }), ROOM_ERR.WRITE_DENIED);
    assert.equal(calls, 3);
    calls = 0;
    const broken = () => {
      calls += 1;
      return Promise.reject(new Error('network down'));
    };
    await assert.rejects(roomsApi('bob', { update: broken }).leaveRoom({ uid: 'bob', code: CODE }), /network down/);
    assert.equal(calls, 1);
    assert.equal((await dumpRoom()).seats.s02.uid, 'bob');
  });
});

describe('rules: leaving', () => {
  test('a well-formed ordinary leave is allowed (baseline for the denials below)', async () => {
    await seedRoom(['bob']);
    await assertSucceeds(write(rt.userDb('bob'), leaveUpdate('bob', 's02')));
  });

  test("nobody can delete another player's seat or nodes", async () => {
    await seedRoom(['bob', 'carol']);
    await write(rt.userDb('dave'), claimUpdate('dave', 's02', '0000'));
    await seedPresence({ s02: present() });
    for (const uid of ['carol', 'host']) {
      const db = rt.userDb(uid);
      // For the host, deleting all of bob's nodes together is a kick (allowed since kickSeat,
      // tested in names-manage.test.js); every partial deletion below stays refused.
      if (uid !== 'host') await assertFails(write(db, leaveUpdate('bob', 's02')));
      for (const path of ['seats/s02', 'secrets/s02', 'claims/s02', 'presence/s02', 'members/bob', 'seats/s02/uid']) {
        await assertFails(db.ref(`rooms/${CODE}/${path}`).remove());
      }
      // Leaving your own seat does not cover someone else's nodes in the same write.
      await assertFails(write(db, { ...leaveUpdate(uid, uid === 'host' ? 's01' : 's03'), [`rooms/${CODE}/secrets/s02`]: null }));
    }
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'bob');
    assert.ok(room.secrets.s02 && room.claims.s02 && room.presence.s02 && room.members.bob);
  });

  test('a non-member or a stale member can delete nothing', async () => {
    await seedRoom(['bob']);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    for (const uid of ['dave', 'bob']) {
      const db = rt.userDb(uid);
      await assertFails(write(db, leaveUpdate(uid, 's02')));
      await assertFails(write(db, leaveUpdate('bob2', 's02')));
      await assertFails(db.ref(`rooms/${CODE}/seats/s02`).remove());
      await assertFails(db.ref(`rooms/${CODE}`).remove());
    }
    await assertFails(write(rt.guestDb(), leaveUpdate('bob', 's02')));
    await assertFails(rt.guestDb().ref(`rooms/${CODE}`).remove());
  });

  test('a leave must remove all of its own nodes together (no orphans, no half leave)', async () => {
    await seedRoom(['bob']);
    const bob = rt.userDb('bob');
    const full = leaveUpdate('bob', 's02');
    for (const keep of Object.keys(full)) {
      const partial = { ...full };
      delete partial[keep];
      // Keeping claims/presence that do not exist is the same as deleting them.
      if (keep.includes('/claims/') || keep.includes('/presence/')) continue;
      await assertFails(write(bob, partial), `leave without ${keep}`);
    }
    await write(rt.userDb('dave'), claimUpdate('dave', 's02', '0000'));
    const keepClaim = leaveUpdate('bob', 's02');
    delete keepClaim[`rooms/${CODE}/claims/s02`];
    await assertFails(write(bob, keepClaim), 'leave keeping an existing claim');
    await seedPresence({ s02: present() });
    const keepPresence = leaveUpdate('bob', 's02');
    delete keepPresence[`rooms/${CODE}/presence/s02`];
    await assertFails(write(bob, keepPresence), 'leave keeping presence');
    // A members entry, secret or claim cannot be deleted while the seat stays.
    await assertFails(bob.ref(`rooms/${CODE}/members/bob`).remove());
    await assertFails(bob.ref(`rooms/${CODE}/secrets/s02`).remove());
    await assertFails(bob.ref(`rooms/${CODE}/claims/s02`).remove());
    await assertFails(bob.ref(`rooms/${CODE}/presence/s02`).remove());
  });

  test('the host cannot delete its seat without moving hostSeat to another existing seat', async () => {
    await seedRoom(['bob']);
    const host = rt.userDb('host');
    await assertFails(write(host, leaveUpdate('host', 's01')));
    await assertFails(write(host, leaveUpdate('host', 's01', { [`rooms/${CODE}/meta/hostSeat`]: 's05' })));
    await assertFails(write(host, leaveUpdate('host', 's01', { [`rooms/${CODE}/meta/hostSeat`]: 's01' })));
    // An ordinary player cannot take the host role on the way out.
    await assertFails(write(rt.userDb('bob'), leaveUpdate('bob', 's02', { [`rooms/${CODE}/meta/hostSeat`]: 's02' })));
    await assertSucceeds(write(host, leaveUpdate('host', 's01', { [`rooms/${CODE}/meta/hostSeat`]: 's02' })));
    assertValidRoom(await dumpRoom());
  });

  test('a non-host cannot delete the room while another seat exists, nobody deletes it partly', async () => {
    // The host may close the room at any time (decision Q67, tests-firebase/close.test.js).
    await seedRoom(['bob']);
    await assertFails(deleteRoom('bob'));
    for (const child of ['meta', 'settings', 'seats', 'members', 'secrets']) {
      await assertFails(rt.userDb('host').ref(`rooms/${CODE}/${child}`).remove());
    }
    await roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE });
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}`).remove());
    await assertSucceeds(deleteRoom('host'));
    assert.equal(await dumpRoom(), null);
  });

  test('no leave while a match is running (status is not lobby); the host may still close the room (Q67)', async () => {
    await seedRoom(['bob']);
    await setStatus('playing');
    await assertFails(write(rt.userDb('bob'), leaveUpdate('bob', 's02')));
    await assertFails(write(rt.userDb('host'), leaveUpdate('host', 's01', { [`rooms/${CODE}/meta/hostSeat`]: 's02' })));
    await rt.env.clearDatabase();
    await seedRoom();
    await setStatus('playing');
    await assertSucceeds(deleteRoom('host'));
    assert.equal(await dumpRoom(), null);
  });
});

describe('leaving: concurrency', () => {
  test('the host and the chosen new host leave at the same time: the room ends valid or deleted', async () => {
    for (const others of [['bob'], ['bob', 'carol']]) {
      await rt.env.clearDatabase();
      await seedRoom(others);
      // random 0 makes the host pick s02 (bob), who is leaving at the same moment.
      const results = await Promise.allSettled([
        roomsApi('host', { random: () => 0 }).leaveRoom({ uid: 'host', code: CODE }),
        roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE }),
      ]);
      for (const r of results) assert.equal(r.status, 'fulfilled', String(r.reason));
      const room = await dumpRoom();
      if (others.length === 1) {
        assert.equal(room, null, 'both left: the room is deleted');
      } else {
        assert.equal(room.meta.hostSeat, 's03');
        assert.deepEqual(Object.keys(room.seats), ['s03']);
        assertValidRoom(room);
      }
    }
  });

  test('several players leaving at once end in a valid room, and the last ones delete it', async () => {
    await seedRoom(['bob', 'carol', 'dave', 'eve']);
    const uids = ['host', 'bob', 'carol', 'dave'];
    const results = await Promise.allSettled(uids.map((uid) => roomsApi(uid).leaveRoom({ uid, code: CODE })));
    for (const r of results) assert.equal(r.status, 'fulfilled', String(r.reason));
    const room = await dumpRoom();
    assert.equal(room.meta.hostSeat, 's05');
    assert.deepEqual(Object.keys(room.seats), ['s05']);
    assertValidRoom(room);
    await roomsApi('eve').leaveRoom({ uid: 'eve', code: CODE });
    assert.equal(await dumpRoom(), null);
  });

  test('a join racing the last leave: the room is deleted and the join fails cleanly, or the joiner is the host', async (t) => {
    const outcomes = new Set();
    for (let round = 0; round < 4; round += 1) {
      await rt.env.clearDatabase();
      await seedRoom();
      const [leave, join] = await Promise.allSettled([
        roomsApi('host').leaveRoom({ uid: 'host', code: CODE }),
        roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN }),
      ]);
      assert.equal(leave.status, 'fulfilled', String(leave.reason));
      const room = await dumpRoom();
      if (room === null) {
        // Since decision Q67 the host (the last player is always the host) may delete the room
        // even with another seat in it, so the join may also have landed just before the
        // deletion: its device then finds the room closed, like any other seat of a closed room.
        if (join.status === 'rejected') assert.equal(join.reason.code, ROOM_ERR.ROOM_NOT_FOUND);
        assert.deepEqual(leave.value, { deletedRoom: true, hostSeat: null });
        outcomes.add(join.status === 'rejected' ? 'deleted' : 'deleted after the join');
      } else {
        assert.equal(join.status, 'fulfilled', String(join.reason));
        assert.equal(room.meta.hostSeat, join.value.seatId);
        assert.equal(room.seats[join.value.seatId].uid, 'eve');
        assert.equal(room.seats.s01, undefined);
        assertValidRoom(room);
        outcomes.add('joined');
      }
    }
    t.diagnostic(`race outcomes seen: ${[...outcomes].join(", ")}`);
    assert.ok(outcomes.size >= 1);
  });

  test('the room is deleted while a join is trying seats: the join fails with ROOM_NOT_FOUND', async () => {
    await seedRoom();
    // Eve's first seat write is held back until the host has deleted the room.
    let first = true;
    const slowUpdate = async (reference, values) => {
      if (first) {
        first = false;
        assert.deepEqual(await roomsApi('host').leaveRoom({ uid: 'host', code: CODE }), { deletedRoom: true, hostSeat: null });
      }
      return update(reference, values);
    };
    await rejectsWithCode(
      roomsApi('eve', { update: slowUpdate }).joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN }),
      ROOM_ERR.ROOM_NOT_FOUND,
    );
    assert.equal(await dumpRoom(), null);
  });

  test('a join that starts after the room is gone gets ROOM_NOT_FOUND, never a half room', async () => {
    await seedRoom();
    await roomsApi('host').leaveRoom({ uid: 'host', code: CODE });
    // A raw join into the deleted room (seat + members + secret, no meta) is refused.
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's01')));
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's02')));
    assert.equal(await dumpRoom(), null);
  });
});

describe('leaving: presence', () => {
  test('leaveRoom stops this device\'s presence and watcher; no presence entry reappears for the seat', async () => {
    await seedRoom(['bob', 'carol']);
    const tab1 = liveRoomsApi('bob');
    const tab2 = liveRoomsApi('bob'); // a second tab of the same player
    const errors = [];
    tab1.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02', onError: (e) => errors.push(e) });
    tab1.api.watchHost({ uid: 'bob', code: CODE, onError: (e) => errors.push(e) });
    tab2.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' });
    const presenceOf = async () => (await dumpRoom()).presence?.s02 ?? null;
    await waitFor(async () => Object.keys((await presenceOf())?.conns ?? {}).length === 2, { what: 'two tabs present' });

    assert.deepEqual(await tab1.api.leaveRoom({ uid: 'bob', code: CODE }), { deletedRoom: false, hostSeat: null });
    assert.equal(await presenceOf(), null);
    // Tab 1's server-side cleanup was cancelled, tab 2's is refused by the rules (no longer a
    // member): neither recreates presence/s02 when the connections drop.
    goOffline(tab1.db);
    goOffline(tab2.db);
    await wait(1000);
    assert.equal(await presenceOf(), null);
    const room = await dumpRoom();
    assert.equal(room.seats.s02, undefined);
    assertValidRoom(room);
    assert.deepEqual(errors, [], 'tab 1 was stopped before the seat was deleted');
  });

  test('a seat freed by leaving shows no presence for the next player until they start it', async () => {
    await seedRoom(['bob']);
    const old = liveRoomsApi('bob');
    old.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' });
    await waitFor(async () => (await dumpRoom()).presence?.s02, { what: 'bob present' });
    await old.api.leaveRoom({ uid: 'bob', code: CODE });
    await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN });
    goOffline(old.db);
    await wait(800);
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'eve');
    assert.equal(room.presence?.s02, undefined);
    assert.ok(SEAT_IDS.includes(room.meta.hostSeat));
  });
});
