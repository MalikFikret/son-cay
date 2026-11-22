// Matches on the local emulator: startMatch, submitAction (transaction), watchMatch, the
// traffic counters, and the match rules (start, moves, status, settings, joining during a match).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { applyAction, eventsFor, listLegalActions, viewFor } from '../src/engine/index.js';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, NOW, PIN, rejectsWithCode, roomFixtures, seedPin, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, dumpRoom, joinUpdate, write, seedRoom } = roomFixtures(rt);

const SEED = 12345;
const live = (uid, extra = {}) => liveRoomsApi(uid, { randomSeed: () => SEED, ...extra }).api;
const matchOf = async () => (await dumpRoom()).match;
const stateOf = async () => JSON.parse((await matchOf()).stateJson);
const logLength = (match) => Object.keys(match.log ?? {}).length;
const setSettings = (patch) => rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/settings`).update(patch));

// uid of each seat in seedRoom(['bob', 'carol', ...]).
const UID = { s01: 'host', s02: 'bob', s03: 'carol', s04: 'dave' };

async function startedRoom(joiners = ['bob', 'carol']) {
  await seedRoom(joiners);
  const result = await live('host').startMatch({ uid: 'host', code: CODE });
  return result;
}

// A legal action that moves the match on (not just a preference), for whoever may act now.
function nextMove(state) {
  for (const p of state.players) {
    const move = listLegalActions(state, p.id).find((a) => a.type !== 'setPreference' && a.type !== 'useTool');
    if (move) return move;
  }
  throw new Error('no legal move');
}

describe('startMatch', () => {
  test('the host starts a match with 3 seats: status playing, n 1, seq 0, log entry 0', async () => {
    const result = await startedRoom();
    assert.deepEqual(result, { n: 1, players: ['s01', 's02', 's03'] });
    const room = await dumpRoom();
    assert.equal(room.meta.status, 'playing');
    assert.equal(room.match.n, 1);
    assert.equal(room.match.seq, 0);
    assert.deepEqual(Object.keys(room.match.log), ['0']);
    const state = JSON.parse(room.match.stateJson);
    assert.deepEqual(state.players.map((p) => p.id).sort(), ['s01', 's02', 's03']);
    assert.equal(state.config.mode, 'classic');
    assert.ok(JSON.parse(room.match.log[0]).some((e) => e.type === 'matchStarted'));
  });

  test('a non-host is refused (API and direct write); a running match cannot be started again', async () => {
    await seedRoom(['bob', 'carol']);
    await rejectsWithCode(live('bob').startMatch({ uid: 'bob', code: CODE }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(live('dave').startMatch({ uid: 'dave', code: CODE }), ROOM_ERR.NOT_MEMBER);
    const raw = (n = 1) => ({
      [`rooms/${CODE}/meta/status`]: 'playing',
      [`rooms/${CODE}/match`]: { n, seq: 0, stateJson: '{}', log: { 0: '[]' }, clockAt: NOW },
    });
    await assertFails(write(rt.userDb('bob'), raw()), 'non-host');
    await assertFails(write(rt.userDb('dave'), raw()), 'stranger');
    assert.equal((await dumpRoom()).meta.status, 'lobby');
    await live('host').startMatch({ uid: 'host', code: CODE });
    await rejectsWithCode(live('host').startMatch({ uid: 'host', code: CODE }), ROOM_ERR.NOT_IN_LOBBY);
    await assertFails(write(rt.userDb('host'), raw(2)), 'second start while playing');
  });

  test('a raw start must set status and match together, with the right n, seq 0 and log entry 0 only', async () => {
    await seedRoom(['bob', 'carol']);
    const host = rt.userDb('host');
    const match = (m = {}) => ({ n: 1, seq: 0, stateJson: '{}', log: { 0: '[]' }, clockAt: NOW, ...m });
    await assertFails(host.ref(`rooms/${CODE}/meta/status`).set('playing'), 'status alone');
    await assertFails(host.ref(`rooms/${CODE}/match`).set(match()), 'match alone');
    const both = (m) => ({ [`rooms/${CODE}/meta/status`]: 'playing', [`rooms/${CODE}/match`]: match(m) });
    await assertFails(write(host, both({ n: 2 })), 'n must be 1');
    await assertFails(write(host, both({ seq: 1, log: { 1: '[]' } })), 'seq must be 0');
    await assertFails(write(host, both({ log: { 0: '[]', 1: '[]' } })), 'only entry 0');
    await assertFails(write(host, both({ extra: 1 })), 'no extra fields');
    await assertFails(write(host, { [`rooms/${CODE}/meta/status`]: 'over', [`rooms/${CODE}/match`]: match() }), 'unknown status');
    await assertSucceeds(write(host, both({})));
  });

  test('fewer than 3 seats is refused; invalid settings are refused without any write', async () => {
    await seedRoom(['bob']);
    await rejectsWithCode(live('host').startMatch({ uid: 'host', code: CODE }), ROOM_ERR.NOT_ENOUGH_PLAYERS);
    await roomsApi('carol').joinRoom({ uid: 'carol', code: CODE, name: 'carol', pin: PIN });
    await setSettings({ hp: 99 });
    const before = await dumpRoom();
    await assert.rejects(live('host').startMatch({ uid: 'host', code: CODE }), (error) => {
      assert.equal(error.code, ROOM_ERR.INVALID_SETTINGS);
      assert.ok(error.details.some((d) => d.field === 'hp'));
      return true;
    });
    assert.deepEqual(await dumpRoom(), before);
  });

  test('the seed comes from randomSeed, so the same seed gives the same match', async () => {
    await startedRoom();
    const first = (await matchOf()).stateJson;
    await rt.env.clearDatabase();
    await startedRoom();
    assert.equal((await matchOf()).stateJson, first);
  });
});

describe('submitAction', () => {
  test('players make several legal moves in turn; seq and log grow by one per move', async () => {
    await startedRoom();
    for (let i = 1; i <= 6; i += 1) {
      const state = await stateOf();
      if (state.status === 'ended') break;
      const move = nextMove(state);
      const result = await live(UID[move.playerId]).submitAction({ uid: UID[move.playerId], code: CODE, action: move });
      assert.equal(result.ok, true, JSON.stringify(result));
      const expected = applyAction(state, move);
      assert.deepEqual(result.events, eventsFor(expected.events, move.playerId));
      const match = await matchOf();
      assert.equal(match.seq, i);
      assert.equal(logLength(match), i + 1);
      assert.equal(match.stateJson, JSON.stringify(expected.state));
    }
  });

  test('a refused engine action writes nothing and returns the engine error', async () => {
    await startedRoom();
    const state = await stateOf();
    const other = state.players.find((p) => p.id !== state.turn.playerId).id;
    const before = await matchOf();
    const result = await live(UID[other]).submitAction({ uid: UID[other], code: CODE, action: { type: 'chooseTarget', target: 's01' } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NOT_YOUR_TURN');
    assert.deepEqual(await matchOf(), before);
  });

  test('a playerId for another seat is ignored: the action is made for the caller\'s seat', async () => {
    await startedRoom();
    const state = await stateOf();
    const turn = state.turn.playerId;
    const other = state.players.find((p) => p.id !== turn).id;
    const move = nextMove(state);
    // The non-turn player tries to act as the turn player: acting as themselves, it is refused.
    const refused = await live(UID[other]).submitAction({ uid: UID[other], code: CODE, action: { ...move, playerId: turn } });
    assert.equal(refused.error.code, 'NOT_YOUR_TURN');
    assert.equal((await matchOf()).seq, 0);
    // The turn player names another seat: the move is still made for the turn player.
    const ok = await live(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: { ...move, playerId: other } });
    assert.equal(ok.ok, true);
    assert.equal((await matchOf()).stateJson, JSON.stringify(applyAction(state, move).state));
  });

  test('simultaneous submissions settle in order: the final state is the accepted moves applied in order', async () => {
    await startedRoom();
    const initial = await stateOf();
    const turn = initial.turn.playerId;
    const other = initial.players.find((p) => p.id !== turn).id;
    const targets = listLegalActions(initial, turn).filter((a) => a.type === 'chooseTarget');
    assert.ok(targets.length >= 2);
    // Two devices of the turn player shoot at different targets (without the confirmation step
    // each one fires; the second is accepted only if the first left the turn with that player),
    // and another player sends a move that is never legal for them (a confirm without an aim: the
    // turn may reach them after the first shot, so a shot of theirs could be legal).
    const submissions = [
      { uid: UID[turn], action: targets[0] },
      { uid: UID[turn], action: targets[1] },
      { uid: UID[other], action: { type: 'confirmShot' } },
    ];
    const results = await Promise.all(submissions.map((s) => live(s.uid).submitAction({ uid: s.uid, code: CODE, action: s.action })));
    assert.equal(results[2].ok, false);
    assert.ok(['NOT_YOUR_TURN', 'WRONG_PHASE'].includes(results[2].error.code), results[2].error.code);
    const accepted = results.map((r, i) => (r.ok ? submissions[i].action : null)).filter(Boolean);
    assert.ok(accepted.length >= 1, JSON.stringify(results));

    // No write was lost or overwritten: one seq per accepted move, and the final state is those
    // moves applied one after the other in one of the possible commit orders.
    const match = await matchOf();
    assert.equal(match.seq, accepted.length);
    assert.equal(logLength(match), accepted.length + 1);
    const orders = accepted.length === 1 ? [accepted] : [accepted, [...accepted].reverse()];
    const finals = orders.map((order) => {
      let state = initial;
      for (const action of order) {
        const step = applyAction(state, action);
        if (!step.ok) return null;
        state = step.state;
      }
      return JSON.stringify(state);
    });
    assert.ok(finals.includes(match.stateJson), 'the final state is not the accepted moves applied in order');
  });

  test('simultaneous submissions where only one can be legal: exactly one is accepted', async () => {
    await startedRoom();
    let state = await stateOf();
    const turn = state.turn.playerId;
    // The confirmation step is off by default (decision 55): switch it on for the turn player,
    // aim, then confirm from two devices at once: after the first confirmation the shot is
    // fired, so the second one is refused by the engine.
    const on = { type: 'setPreference', confirmShot: true };
    assert.equal((await live(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: on })).ok, true);
    state = await stateOf();
    const target = listLegalActions(state, turn).find((a) => a.type === 'chooseTarget');
    assert.equal((await live(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: target })).ok, true);
    state = await stateOf();
    const confirm = listLegalActions(state, turn).find((a) => a.type === 'confirmShot');
    assert.ok(confirm, 'a confirmShot action is legal');
    const results = await Promise.all([1, 2].map(() => live(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: confirm })));
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true], JSON.stringify(results));
    const match = await matchOf();
    assert.equal(match.seq, 3);
    assert.equal(match.stateJson, JSON.stringify(applyAction(state, confirm).state));
  });

  test('removePlayer is not allowed through submitAction; no match, bad action and non-member are refused', async () => {
    await seedRoom(['bob', 'carol']);
    const host = live('host');
    await rejectsWithCode(host.submitAction({ uid: 'host', code: CODE, action: { type: 'chooseTarget', target: 's02' } }), ROOM_ERR.NO_MATCH);
    await host.startMatch({ uid: 'host', code: CODE });
    // (Timeouts are accepted since task 3.5b: see match-end.test.js.)
    await rejectsWithCode(host.submitAction({ uid: 'host', code: CODE, action: { type: 'removePlayer', target: 's02' } }), ROOM_ERR.ACTION_NOT_ALLOWED);
    await rejectsWithCode(host.submitAction({ uid: 'host', code: CODE, action: 'fire' }), ROOM_ERR.INVALID_ACTION);
    await rejectsWithCode(live('dave').submitAction({ uid: 'dave', code: CODE, action: { type: 'chooseTarget' } }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(
      roomsApi('host').submitAction({ uid: 'host', code: CODE, action: { type: 'chooseTarget', target: 's02' } }),
      ROOM_ERR.INVALID_DEPENDENCIES,
    );
    assert.equal((await matchOf()).seq, 0);
  });
});

describe('rules: moves', () => {
  async function rawMove(uid, change = (m) => m) {
    const match = await matchOf();
    const seq = match.seq + 1;
    const next = change({ n: match.n, seq, stateJson: match.stateJson, log: { ...match.log, [seq]: '[]' }, clockAt: match.clockAt }, match);
    return rt.userDb(uid).ref(`rooms/${CODE}/match`).set(next);
  }

  test('a well-formed raw move by a member is allowed (baseline for the denials below)', async () => {
    await startedRoom();
    await assertSucceeds(rawMove('bob'));
    await assertSucceeds(rawMove('carol'));
    assert.equal((await matchOf()).seq, 2);
  });

  test('a member\'s direct write is refused if it skips a seq, changes or drops old entries, or deletes match', async () => {
    await startedRoom();
    await assertSucceeds(rawMove('bob'));
    await assertFails(rawMove('bob', (m) => ({ ...m, seq: m.seq + 1, log: { ...m.log, [m.seq + 1]: '[]' } })), 'skips a seq');
    await assertFails(rawMove('bob', (m) => ({ ...m, seq: m.seq - 1 })), 'same seq again');
    await assertFails(rawMove('bob', (m) => ({ ...m, log: { ...m.log, 0: '["changed"]' } })), 'changes entry 0');
    await assertFails(rawMove('bob', (m) => ({ ...m, log: { ...m.log, 1: '["changed"]' } })), 'changes the latest entry');
    await assertFails(rawMove('bob', (m, old) => {
      const log = { ...m.log };
      delete log[old.seq];
      return { ...m, log };
    }), 'drops the latest entry');
    await assertFails(rawMove('bob', (m) => {
      const log = { ...m.log };
      delete log[m.seq];
      log[m.seq + 5] = '[]';
      return { ...m, log };
    }), 'new entry under another key');
    await assertFails(rawMove('bob', (m) => ({ ...m, n: m.n + 1 })), 'changes n');
    await assertFails(rawMove('bob', (m) => ({ ...m, extra: 1 })), 'extra field');
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/match`).remove(), 'deletes match');
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}/match`).remove(), 'host deletes match');
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/match/log/0`).remove(), 'deletes entry 0 alone');
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}/meta/status`).set('lobby'), 'back to lobby');
    await assertFails(rawMove('dave'), 'non-member');
    assert.equal((await matchOf()).seq, 1);
  });

  test('stateJson longer than 200000 characters is refused', async () => {
    await startedRoom();
    await assertFails(rawMove('bob', (m) => ({ ...m, stateJson: 'x'.repeat(200001) })));
    await assertSucceeds(rawMove('bob', (m) => ({ ...m, stateJson: 'x'.repeat(200000) })));
  });

  test('match is readable by members only', async () => {
    await startedRoom();
    await assertSucceeds(rt.userDb('bob').ref(`rooms/${CODE}/match`).get());
    await assertFails(rt.userDb('dave').ref(`rooms/${CODE}/match`).get());
    await assertFails(rt.userDb('dave').ref(`rooms/${CODE}/match/stateJson`).get());
    await assertFails(rt.guestDb().ref(`rooms/${CODE}/match`).get());
  });
});

describe('watchMatch', () => {
  test('a player sees only their own view and events; never another seat\'s private events', async () => {
    await startedRoom();
    const deliveries = [];
    const { api } = liveRoomsApi('bob');
    const stop = api.watchMatch({ uid: 'bob', code: CODE, onUpdate: (u) => deliveries.push(u) });
    try {
      await waitFor(() => deliveries.length === 1, { what: 'initial delivery' });
      const first = deliveries[0];
      const state = await stateOf();
      assert.equal(first.initial, true);
      assert.deepEqual(first.view, viewFor(state, 's02'));
      assert.deepEqual(first.events, eventsFor(JSON.parse((await matchOf()).log[0]), 's02'));
      // Private tool deals of the other seats are not there; bob's own is.
      const deals = first.events.filter((e) => e.type === 'toolsDealt');
      assert.equal(deals.length, 1);
      assert.deepEqual(deals[0].to, ['s02']);

      const move = nextMove(state);
      await live(UID[move.playerId]).submitAction({ uid: UID[move.playerId], code: CODE, action: move });
      await waitFor(() => deliveries.length === 2, { what: 'delivery after a move' });
      const second = deliveries[1];
      assert.equal(second.initial, false);
      assert.equal(second.seq, 1);
      assert.deepEqual(second.events, eventsFor(applyAction(state, move).events, 's02'));
      for (const d of deliveries) {
        for (const e of d.events) assert.ok(e.visibility === 'public' || e.to.includes('s02'), JSON.stringify(e));
        assert.equal(d.stateJson, undefined);
        assert.equal(d.state, undefined);
        assert.equal(d.log, undefined);
        assert.deepEqual(Object.keys(d).sort(), ['clockAt', 'events', 'initial', 'legalActions', 'n', 'seq', 'view']);
        for (const action of d.legalActions) assert.equal(action.playerId, 's02');
        // Another seat's hand is not in bob's view.
        for (const p of d.view.players) assert.equal(p.hand, undefined);
      }
    } finally {
      stop();
    }
  });

  test('a member outside the match gets the spectator view; a non-member gets NOT_MEMBER', async () => {
    await startedRoom();
    // A member whose seat is not a player of this match (as a waiting player will be, task 3.5c).
    await rt.withRulesDisabled((db) =>
      db.ref(`rooms/${CODE}`).update({
        'seats/s04': { uid: 'wait', name: 'wait', joinedAt: Date.now() },
        'members/wait': 's04',
        'names/wait': 's04',
        'secrets/s04': '1111',
      }),
    );
    const deliveries = [];
    const stopWaiting = live('wait').watchMatch({ uid: 'wait', code: CODE, onUpdate: (u) => deliveries.push(u) });
    const errors = [];
    const stopStranger = live('dave').watchMatch({ uid: 'dave', code: CODE, onUpdate: () => {}, onError: (e) => errors.push(e) });
    try {
      await waitFor(() => deliveries.length === 1, { what: 'spectator delivery' });
      const state = await stateOf();
      assert.equal(deliveries[0].view.role, 'spectator');
      assert.equal(deliveries[0].view.viewer, null);
      assert.deepEqual(deliveries[0].view, viewFor(state, null));
      assert.ok(deliveries[0].events.every((e) => e.visibility === 'public'));
      await waitFor(() => errors.length === 1, { what: 'NOT_MEMBER' });
      assert.equal(errors[0].code, ROOM_ERR.NOT_MEMBER);
    } finally {
      stopWaiting();
      stopStranger();
    }
  });

  test('traffic counters count writes and received snapshots, and reset', async () => {
    await seedRoom(['bob', 'carol']);
    const host = live('host');
    await host.startMatch({ uid: 'host', code: CODE });
    const afterStart = host.getTrafficStats();
    assert.equal(afterStart.writes, 1);
    assert.ok(afterStart.bytesWritten > (await matchOf()).stateJson.length);
    const deliveries = [];
    const stop = host.watchMatch({ uid: 'host', code: CODE, onUpdate: (u) => deliveries.push(u) });
    try {
      await waitFor(() => deliveries.length === 1, { what: 'delivery' });
      const stats = host.getTrafficStats();
      assert.equal(stats.snapshots, 1);
      assert.ok(stats.bytesReceived > 0);
      host.resetTrafficStats();
      assert.deepEqual(host.getTrafficStats(), { bytesWritten: 0, bytesReceived: 0, writes: 0, snapshots: 0 });
    } finally {
      stop();
    }
  });
});

describe('the room during a match', () => {
  test('joinRoom gives a waiting seat (a seat without the flag is refused); recoverSeat still works', async () => {
    await startedRoom();
    // Since task 3.5c a new seat during a match is a waiting seat (more in waiting.test.js).
    await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's04', { name: 'Eve' })));
    assert.deepEqual(await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN }), { seatId: 's04', waiting: true });
    // A member asking again still gets their seat back.
    assert.deepEqual(await roomsApi('bob').joinRoom({ uid: 'bob', code: CODE, name: 'bob', pin: PIN }), { seatId: 's02' });
    assert.deepEqual(await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: seedPin(1) }), { seatId: 's02' });
    // The recovered device plays the same seat.
    const deliveries = [];
    const stop = live('bob2').watchMatch({ uid: 'bob2', code: CODE, onUpdate: (u) => deliveries.push(u) });
    try {
      await waitFor(() => deliveries.length === 1, { what: 'delivery' });
      assert.equal(deliveries[0].view.viewer, 's02');
    } finally {
      stop();
    }
  });

  test('settings, leaving, kicking and renaming are refused during a match', async () => {
    await startedRoom(['bob', 'carol', 'dave']);
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}/settings/hp`).set(3));
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}/settings`).update({ hp: 3 }));
    await rejectsWithCode(roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE }), ROOM_ERR.NOT_IN_LOBBY);
    await rejectsWithCode(roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's03' }), ROOM_ERR.NOT_IN_LOBBY);
    await rejectsWithCode(roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name: 'Robert' }), ROOM_ERR.NOT_IN_LOBBY);
    await wait(0);
    const room = await dumpRoom();
    assert.equal(Object.keys(room.seats).length, 4);
    assert.equal(room.seats.s02.name, 'bob');
  });
});
