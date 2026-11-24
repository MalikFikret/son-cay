// The match clock (clockAt, timeouts, runMatchClock), removing an absent player, the end of a
// match with its results, and session scores for the host takeover, on the local emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { applyAction, createMatch, DEFAULT_SCORING, REFILL_PAUSE_MS, ROUND_INTRO_MS, scoreMatch } from '../src/engine/index.js';
import { MATCH_PAUSED, ROOM_ERR, parseLog } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, NOW, rejectsWithCode, roomFixtures, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, fastForwardPause, seedPresence, dumpRoom, write, seedRoom } = roomFixtures(rt);

const SEED = 12345;
const UID = { s01: 'host', s02: 'bob', s03: 'carol' };
const live = (uid, extra = {}) => liveRoomsApi(uid, { randomSeed: () => SEED, ...extra }).api;
const matchOf = async () => (await dumpRoom()).match;
const stateOf = async () => JSON.parse((await matchOf()).stateJson);
const present = () => ({ conns: { seeded: true }, lastSeenAt: Date.now() - 5000 });

async function startedRoom() {
  await seedRoom(['bob', 'carol']);
  await live('host').startMatch({ uid: 'host', code: CODE });
}

// The timeout for the current countdown, sent from the device of the seat the clock waits for.
async function timeoutNow() {
  const state = await stateOf();
  const uid = UID[state.clock.playerId];
  return live(uid).submitAction({ uid, code: CODE, action: { type: 'timeout', seq: state.clock.seq } });
}

async function rawMove(uid, change = (m) => m) {
  const match = await matchOf();
  const seq = match.seq + 1;
  const next = change({ n: match.n, seq, stateJson: match.stateJson, log: { ...match.log, [seq]: '[]' }, clockAt: match.clockAt });
  return rt.userDb(uid).ref(`rooms/${CODE}/match`).set(next);
}

describe('clockAt', () => {
  test('clockAt is written at the start and stamped again on every new countdown', async () => {
    const before = Date.now();
    await startedRoom();
    let match = await matchOf();
    assert.equal(typeof match.clockAt, 'number');
    assert.ok(match.clockAt >= before - 2000 && match.clockAt <= Date.now() + 2000);
    for (let i = 0; i < 4; i += 1) {
      const old = match;
      const oldState = JSON.parse(old.stateJson);
      await wait(20);
      assert.equal((await timeoutNow()).ok, true);
      match = await matchOf();
      const state = JSON.parse(match.stateJson);
      if (state.clock.seq !== oldState.clock.seq) assert.ok(match.clockAt > old.clockAt, 'new countdown, new clockAt');
      else assert.equal(match.clockAt, old.clockAt);
    }
  });

  test('a move keeps clockAt when the countdown does not change', async () => {
    await startedRoom();
    const state = await stateOf();
    const before = await matchOf();
    // Choosing a target does not start a new countdown.
    const turn = state.turn.playerId;
    const target = state.players.find((p) => p.id !== turn).id;
    const result = await live(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: { type: 'chooseTarget', target } });
    assert.equal(result.ok, true);
    const after = await matchOf();
    if (JSON.parse(after.stateJson).clock.seq === state.clock.seq) assert.equal(after.clockAt, before.clockAt);
  });

  test('a write with a clockAt in the future (or missing) is refused', async () => {
    await startedRoom();
    await assertFails(rawMove('bob', (m) => ({ ...m, clockAt: Date.now() + 60000 })));
    await assertFails(rawMove('bob', (m) => ({ ...m, clockAt: 'soon' })));
    await assertFails(rawMove('bob', (m) => {
      const { clockAt, ...rest } = m;
      return rest;
    }));
    await assertSucceeds(rawMove('bob', (m) => ({ ...m, clockAt: NOW })));
  });
});

describe('round pauses (decision Q79)', () => {
  // The api exactly as the game uses it (no fast-forward of the pause).
  const paused = (uid) => liveRoomsApi(uid, { randomSeed: () => SEED, keepPauses: true }).api;

  test('during the first round intro every move, timeout and kick is refused with MATCH_PAUSED and nothing is written', async () => {
    await startedRoom();
    const state = await stateOf();
    assert.equal(state.clock.pauseMs, ROUND_INTRO_MS);
    const turn = state.turn.playerId;
    const other = state.players.find((p) => p.id !== turn).id;
    const before = await matchOf();
    const shot = await paused(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: { type: 'chooseTarget', target: other } });
    assert.equal(shot.ok, false);
    assert.equal(shot.error.code, MATCH_PAUSED);
    assert.ok(shot.error.leftMs > 0 && shot.error.leftMs <= ROUND_INTRO_MS, `leftMs ${shot.error.leftMs}`);
    const timeout = await paused(UID[other]).submitAction({ uid: UID[other], code: CODE, action: { type: 'timeout', seq: state.clock.seq } });
    assert.equal(timeout.error.code, MATCH_PAUSED, 'a timeout sent early is refused');
    // Another player's "any time" tool or a ransom action is refused alike.
    const anyTime = await paused(UID[other]).submitAction({ uid: UID[other], code: CODE, action: { type: 'useTool', tool: 'heal' } });
    assert.equal(anyTime.error.code, MATCH_PAUSED);
    const kick = await paused('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's02' });
    assert.equal(kick.error.code, MATCH_PAUSED, 'the host cannot change play either');
    assert.deepEqual(await matchOf(), before, 'nothing written');
    // Once the intro is over (real time), the same shot is accepted.
    await wait(shot.error.leftMs + 400);
    const later = await paused(UID[turn]).submitAction({ uid: UID[turn], code: CODE, action: { type: 'chooseTarget', target: other } });
    assert.equal(later.ok, true, JSON.stringify(later));
  });

  test('the shot that ends a round pauses the next countdown 9 s; moves are refused, then allowed again', async () => {
    await startedRoom();
    await fastForwardPause(CODE, ROUND_INTRO_MS);
    // Fire until a write refills (the round's last Mermi), each at the turn player's next seat.
    let refill = null;
    for (let i = 0; i < 40 && refill === null; i += 1) {
      const state = await stateOf();
      if (state.status !== 'active') break;
      const shooter = state.turn.playerId;
      const target = state.players.find((p) => p.alive && p.id !== shooter).id;
      const result = await paused(UID[shooter]).submitAction({ uid: UID[shooter], code: CODE, action: { type: 'chooseTarget', target } });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.events.some((e) => e.type === 'reloaded')) refill = await stateOf();
    }
    assert.ok(refill, 'a round ended');
    assert.equal(refill.clock.pauseMs, REFILL_PAUSE_MS);
    const match = await matchOf();
    const shooter = refill.turn.playerId;
    const target = refill.players.find((p) => p.alive && p.id !== shooter).id;
    const early = await paused(UID[shooter]).submitAction({ uid: UID[shooter], code: CODE, action: { type: 'chooseTarget', target } });
    assert.equal(early.error.code, MATCH_PAUSED);
    assert.ok(early.error.leftMs > ROUND_INTRO_MS && early.error.leftMs <= REFILL_PAUSE_MS, `leftMs ${early.error.leftMs}`);
    assert.deepEqual(await matchOf(), match);
    await fastForwardPause(CODE, early.error.leftMs);
    const after = await paused(UID[shooter]).submitAction({ uid: UID[shooter], code: CODE, action: { type: 'chooseTarget', target } });
    assert.equal(after.ok, true, JSON.stringify(after));
  });

  test('watchMatch: the loot of a kill that ends the round gets its 15 s after the pause', async () => {
    // Covered as pure scheduling in tests/round-pause.test.js (lootDeadline); here the delivered
    // deadline follows the stored pause for an open loot of mine.
    await startedRoom();
    const match = await matchOf();
    const state = JSON.parse(match.stateJson);
    const looter = state.players[0].id;
    const victim = state.players[1].id;
    // Seed an open loot on the paused countdown of the match start (as a round-ending kill would).
    state.players[0].loots = [{ victim, clockSeq: state.clock.seq }];
    await rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/match/stateJson`).set(JSON.stringify(state)));
    const updates = [];
    const stop = paused(UID[looter]).watchMatch({ uid: UID[looter], code: CODE, onUpdate: (u) => updates.push(u) });
    try {
      await waitFor(() => updates.length > 0, { what: 'a delivery' });
      const last = updates.at(-1);
      assert.equal(last.lootDeadlines[victim], last.clockAt + ROUND_INTRO_MS + 15000);
    } finally {
      stop();
    }
  });
});

describe('timeouts', () => {
  test('a timeout from the turn player\'s device makes the automatic shot', async () => {
    await startedRoom();
    const state = await stateOf();
    const result = await timeoutNow();
    assert.equal(result.ok, true);
    const match = await matchOf();
    assert.equal(match.seq, 1);
    const events = JSON.parse(match.log[1]);
    assert.ok(events.some((e) => e.type === 'timedOut'));
    const shot = events.find((e) => e.type === 'shot');
    assert.equal(shot.auto, true);
    assert.equal(shot.shooter, state.clock.playerId);
    assert.equal(match.stateJson, JSON.stringify(applyAction(state, { type: 'timeout', seq: state.clock.seq }).state));
  });

  test('two timeouts for the same seq give one shot and one STALE_TIMEOUT', async () => {
    await startedRoom();
    const state = await stateOf();
    const action = { type: 'timeout', seq: state.clock.seq };
    const results = await Promise.all(['host', 'bob', 'carol'].map((uid) => live(uid).submitAction({ uid, code: CODE, action })));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.error.code), ['STALE_TIMEOUT', 'STALE_TIMEOUT']);
    const match = await matchOf();
    assert.equal(match.seq, 1);
    const shots = parseLog(match.log).flatMap((e) => e.events).filter((e) => e.type === 'shot');
    assert.equal(shots.length, 1);
  });

  test('runMatchClock sends the timeout when the countdown has run out, and STALE_TIMEOUT is not an error', async () => {
    await startedRoom();
    const state = await stateOf();
    // Clocks far ahead: every device sees the deadline as passed and sends at once.
    const errors = [];
    const stops = ['host', 'bob', 'carol'].map((uid) =>
      live(uid, { now: () => Date.now() + 120000, random: () => 0 }).runMatchClock({ uid, code: CODE, onError: (e) => errors.push(e) }),
    );
    try {
      await waitFor(async () => (await matchOf()).seq >= 1, { what: 'an automatic shot' });
    } finally {
      for (const stop of stops) stop();
    }
    await wait(500);
    const events = parseLog((await matchOf()).log).flatMap((e) => e.events);
    const first = events.find((e) => e.type === 'shot');
    assert.equal(first.auto, true);
    assert.equal(first.shooter, state.clock.playerId);
    assert.deepEqual(errors, []);
  });

  test('runMatchClock with real time does nothing before the deadline', async () => {
    await startedRoom();
    const stop = live('bob').runMatchClock({ uid: 'bob', code: CODE });
    await wait(1500);
    stop();
    assert.equal((await matchOf()).seq, 0);
  });
});

// Decision 63: loot is a private offer of the looter; only the looter's device sends its expiry.
describe('loot expiry', () => {
  // The turn player kills the next player (1 life, a live Mermi); returns the ids involved.
  async function killNext() {
    await startedRoom();
    const before = await stateOf();
    const shooter = before.turn.playerId;
    const order = before.players.map((p) => p.id);
    const victim = order[(order.indexOf(shooter) + 1) % order.length];
    await rawMove(UID[shooter], (m) => {
      const s = JSON.parse(m.stateJson);
      s.round.chambers[s.round.cursor] = { type: 'live', flipped: false };
      s.round.announced = { total: s.round.chambers.length, live: s.round.chambers.filter((c) => c.type === 'live').length, blank: s.round.chambers.filter((c) => c.type === 'blank').length };
      s.players.find((p) => p.id === victim).hp = 1;
      s.players.find((p) => p.id === victim).hand = ['heal', 'jail'];
      return { ...m, stateJson: JSON.stringify(s) };
    });
    const res = await live(UID[shooter]).submitAction({ uid: UID[shooter], code: CODE, action: { type: 'chooseTarget', target: victim } });
    assert.equal(res.ok, true);
    const third = order.find((id) => id !== shooter && id !== victim);
    return { shooter, victim, third };
  }

  test('the kill opens a loot that only the looter sees; the turn passes at once', async () => {
    const { shooter, victim, third } = await killNext();
    const state = await stateOf();
    assert.equal(state.turn.playerId, third);
    assert.deepEqual(state.players.find((p) => p.id === shooter).loots, [{ victim, clockSeq: state.clock.seq }]);
    const updates = {};
    const stops = [shooter, third].map((seat) => live(UID[seat]).watchMatch({ uid: UID[seat], code: CODE, onUpdate: (u) => { updates[seat] = u; } }));
    try {
      await waitFor(async () => updates[shooter] && updates[third], { what: 'both views' });
    } finally {
      for (const stop of stops) stop();
    }
    const match = await matchOf();
    assert.deepEqual(updates[shooter].view.self.loots.map((l) => [l.victim, l.tools]), [[victim, ['heal', 'jail']]]);
    assert.equal(updates[shooter].lootDeadlines[victim], match.clockAt + 15000, 'the kill\'s countdown + 15 s');
    assert.deepEqual(updates[third].view.self.loots, []);
    assert.deepEqual(updates[third].lootDeadlines, {});
    assert.ok(!JSON.stringify(updates[third].events).includes('loot'), 'no loot event for a third player');
  });

  test('only the looter\'s runMatchClock sends the expiry, once, at the deadline; nobody else writes', async () => {
    const { shooter, victim } = await killNext();
    const seqAfterKill = (await matchOf()).seq;
    const errors = [];
    // 20 s ahead: the loot (15 s) has expired, the shot clock (30 s, backup 33 s) has not.
    const ahead = { now: () => Date.now() + 20000, random: () => 0 };
    const stopOthers = Object.keys(UID).filter((seat) => seat !== shooter)
      .map((seat) => live(UID[seat], ahead).runMatchClock({ uid: UID[seat], code: CODE, onError: (e) => errors.push(e) }));
    await wait(1500);
    assert.equal((await matchOf()).seq, seqAfterKill, 'other devices send nothing for a loot');
    const stopLooter = live(UID[shooter], ahead).runMatchClock({ uid: UID[shooter], code: CODE, onError: (e) => errors.push(e) });
    try {
      await waitFor(async () => (await stateOf()).players.find((p) => p.id === shooter).loots.length === 0, { what: 'the loot expiry' });
      await wait(800);
    } finally {
      stopLooter();
      for (const stop of stopOthers) stop();
    }
    const match = await matchOf();
    assert.equal(match.seq, seqAfterKill + 1, 'exactly one write: the expiry');
    const entry = parseLog(match.log).find((e) => e.seq === match.seq).events;
    assert.deepEqual(entry.map((e) => [e.type, e.visibility, e.to, e.reason]), [['lootResult', 'private', [shooter], 'expired']]);
    const state = await stateOf();
    assert.deepEqual(state.players.find((p) => p.id === victim).hand, [], 'the victim\'s tools left the game');
    assert.deepEqual(state.players.find((p) => p.id === shooter).hand.filter((t) => t === 'jail'), []);
    assert.deepEqual(errors, []);
  });

  test('a choice before the deadline closes the loot; the expiry then has nothing to do', async () => {
    const { shooter, victim } = await killNext();
    const res = await live(UID[shooter]).submitAction({ uid: UID[shooter], code: CODE, action: { type: 'lootChoice', victim, choice: { kind: 'tool', tool: 'jail' } } });
    assert.equal(res.ok, true);
    const late = await live(UID[shooter]).submitAction({ uid: UID[shooter], code: CODE, action: { type: 'lootChoice', victim, choice: { kind: 'none' }, expired: true } });
    assert.equal(late.ok, false);
    assert.equal(late.error.code, 'NO_LOOT');
    const state = await stateOf();
    assert.ok(state.players.find((p) => p.id === shooter).hand.includes('jail'));
  });
});

describe('removeAbsentPlayer', () => {
  test('the host removes a seat whose presence is off', async () => {
    await startedRoom();
    await seedPresence({ s01: present(), s02: present() }); // s03 has no connection
    const result = await live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's03' });
    assert.equal(result.ok, true);
    const state = await stateOf();
    assert.equal(state.players.find((p) => p.id === 's03').alive, false);
    assert.ok(JSON.parse((await matchOf()).log[1]).some((e) => e.type === 'playerRemoved'));
    // Already out: not again.
    await rejectsWithCode(live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's03' }), ROOM_ERR.PLAYER_NOT_ALIVE);
  });

  test('removing a present seat, by a non-host, the own seat, a non-player, or without a match is refused', async () => {
    await seedRoom(['bob', 'carol']);
    await rejectsWithCode(live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's03' }), ROOM_ERR.NO_MATCH);
    await live('host').startMatch({ uid: 'host', code: CODE });
    await seedPresence({ s02: present() });
    await rejectsWithCode(live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's02' }), ROOM_ERR.SEAT_PRESENT);
    await rejectsWithCode(live('bob').removeAbsentPlayer({ uid: 'bob', code: CODE, seatId: 's03' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's01' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(live('host').removeAbsentPlayer({ uid: 'host', code: CODE, seatId: 's09' }), ROOM_ERR.PLAYER_NOT_ALIVE);
    await rejectsWithCode(live('dave').removeAbsentPlayer({ uid: 'dave', code: CODE, seatId: 's03' }), ROOM_ERR.NOT_MEMBER);
    // A caller cannot send removePlayer through submitAction.
    await rejectsWithCode(
      live('host').submitAction({ uid: 'host', code: CODE, action: { type: 'removePlayer', target: 's03' } }),
      ROOM_ERR.ACTION_NOT_ALLOWED,
    );
    assert.equal((await matchOf()).seq, 0);
  });
});

describe('the end of a match', () => {
  test('playing to the end writes results/{n} once and sets the status back to lobby', async () => {
    await startedRoom();
    let last = null;
    for (let i = 0; i < 200; i += 1) {
      if ((await stateOf()).status === 'ended') break;
      last = await timeoutNow();
      assert.equal(last.ok, true);
    }
    assert.equal(last.ended, true);
    assert.equal(last.finished, true);
    const room = await dumpRoom();
    assert.equal(room.meta.status, 'lobby');
    assert.equal(JSON.parse(room.match.stateJson).status, 'ended', 'the match node stays');
    assert.deepEqual(Object.keys(room.results), ['1']);
    const events = parseLog(room.match.log).flatMap((e) => e.events);
    assert.deepEqual(JSON.parse(room.results[1].scoreJson), scoreMatch(events, DEFAULT_SCORING));
    assert.deepEqual(room.results[1].joinedAt, { s01: room.seats.s01.joinedAt, s02: room.seats.s02.joinedAt, s03: room.seats.s03.joinedAt });

    // A second results write is refused.
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/results/1`).set({ scoreJson: '{}', joinedAt: { s01: 1 } }));
    await assertFails(write(rt.userDb('bob'), {
      [`rooms/${CODE}/results/1`]: { scoreJson: '{}', joinedAt: { s01: 1 } },
      [`rooms/${CODE}/meta/status`]: 'lobby',
    }));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/results/1`).remove());
    // The next match is number 2.
    assert.equal((await live('host').startMatch({ uid: 'host', code: CODE })).n, 2);
    assert.equal((await dumpRoom()).meta.status, 'playing');
  });

  test('status cannot go back to lobby without the results of the current match', async () => {
    await startedRoom();
    const entry = { scoreJson: '{"players":{}}', joinedAt: { s01: 1 } };
    const host = rt.userDb('host');
    await assertFails(host.ref(`rooms/${CODE}/meta/status`).set('lobby'), 'status alone');
    await assertFails(write(host, { [`rooms/${CODE}/results/2`]: entry, [`rooms/${CODE}/meta/status`]: 'lobby' }), 'results of another n');
    await assertFails(host.ref(`rooms/${CODE}/results/1`).set(entry), 'results without the status change');
    await assertFails(write(rt.userDb('dave'), { [`rooms/${CODE}/results/1`]: entry, [`rooms/${CODE}/meta/status`]: 'lobby' }), 'non-member');
    await assertFails(write(host, { [`rooms/${CODE}/results/1`]: { ...entry, extra: 1 }, [`rooms/${CODE}/meta/status`]: 'lobby' }), 'extra field');
    await assertFails(write(host, { [`rooms/${CODE}/results/1`]: { scoreJson: '{}', joinedAt: { x01: 1 } }, [`rooms/${CODE}/meta/status`]: 'lobby' }), 'bad seat');
    // The rules cannot see that the match has ended (it is inside stateJson): a member could end
    // it early by writing results. This is a known limit; the layer only does it for an ended match.
    await assertSucceeds(write(rt.userDb('bob'), { [`rooms/${CODE}/results/1`]: entry, [`rooms/${CODE}/meta/status`]: 'lobby' }));
    assert.equal((await dumpRoom()).meta.status, 'lobby');
  });

  test('another device finishes an ended match that has no results yet; two devices write it once', async () => {
    await seedRoom(['bob', 'carol']);
    // An ended match whose ending device never wrote the results.
    let { state, events } = createMatch({ mode: 'classic' }, [{ id: 's01' }, { id: 's02' }, { id: 's03' }], SEED);
    const log = { 0: JSON.stringify(events) };
    let seq = 0;
    while (state.status !== 'ended') {
      const step = applyAction(state, { type: 'timeout', seq: state.clock.seq });
      state = step.state;
      seq += 1;
      log[seq] = JSON.stringify(step.events);
    }
    await rt.withRulesDisabled((db) =>
      db.ref(`rooms/${CODE}`).update({ 'meta/status': 'playing', match: { n: 1, seq, stateJson: JSON.stringify(state), log, clockAt: Date.now() } }),
    );
    const errors = [];
    const stops = ['bob', 'carol'].map((uid) => live(uid, { random: () => 0 }).runMatchClock({ uid, code: CODE, onError: (e) => errors.push(e) }));
    try {
      await waitFor(async () => (await dumpRoom()).results?.[1], { timeout: 8000, what: 'results written by a backup device' });
      await wait(1500);
    } finally {
      for (const stop of stops) stop();
    }
    const room = await dumpRoom();
    assert.equal(room.meta.status, 'lobby');
    assert.deepEqual(Object.keys(room.results), ['1']);
    assert.deepEqual(errors, [], 'the second writer counts the refusal as success');
  });
});

describe('session scores and the host takeover', () => {
  async function seedResult(totals, joinedAtOverride = {}) {
    const room = await dumpRoom();
    const players = {};
    const joinedAt = {};
    for (const [seatId, total] of Object.entries(totals)) {
      players[seatId] = { total };
      joinedAt[seatId] = joinedAtOverride[seatId] ?? room.seats[seatId].joinedAt;
    }
    await rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/results/1`).set({ scoreJson: JSON.stringify({ players }), joinedAt }));
  }

  test('getSessionScores sums the results for the people on the seats', async () => {
    await seedRoom(['bob', 'carol']);
    assert.deepEqual(await live('bob').getSessionScores({ uid: 'bob', code: CODE }), { s01: 0, s02: 0, s03: 0 });
    await seedResult({ s01: 4, s02: 7, s03: 1 }, { s03: 1 }); // s03 recorded another person
    assert.deepEqual(await live('bob').getSessionScores({ uid: 'bob', code: CODE }), { s01: 4, s02: 7, s03: 0 });
    await rejectsWithCode(live('dave').getSessionScores({ uid: 'dave', code: CODE }), ROOM_ERR.NOT_MEMBER);
  });

  test('after a match, the host takeover picks the present seat with the most session points', async () => {
    await seedRoom(['bob', 'carol', 'dave']);
    await seedResult({ s01: 9, s02: 2, s03: 6, s04: 8 });
    // The host has been gone for 61 s; s02 and s03 are present, s04 (more points) is absent.
    await seedPresence({ s01: { lastSeenAt: Date.now() - 61000 }, s02: present(), s03: present() });
    for (const r of [0, 0.5, 0.99]) {
      await rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/meta/hostSeat`).set('s01'));
      const result = await live('bob', { random: () => r }).tryTakeOverHost({ uid: 'bob', code: CODE });
      assert.deepEqual(result, { moved: true, hostSeat: 's03' });
    }
  });

  test('a newcomer on a freed seat does not inherit the points in the takeover', async () => {
    await seedRoom(['bob', 'carol']);
    // s03's recorded joinedAt belongs to an earlier player of that seat.
    await seedResult({ s02: 2, s03: 50 }, { s03: 1 });
    await seedPresence({ s01: { lastSeenAt: Date.now() - 61000 }, s02: present(), s03: present() });
    const result = await live('carol', { random: () => 0.99 }).tryTakeOverHost({ uid: 'carol', code: CODE });
    assert.deepEqual(result, { moved: true, hostSeat: 's02' });
  });

  test('explicit scores still win over the session points', async () => {
    await seedRoom(['bob', 'carol']);
    await seedResult({ s02: 9, s03: 1 });
    await seedPresence({ s01: { lastSeenAt: Date.now() - 61000 }, s02: present(), s03: present() });
    const result = await live('bob').tryTakeOverHost({ uid: 'bob', code: CODE, scores: { s02: 0, s03: 5 } });
    assert.deepEqual(result, { moved: true, hostSeat: 's03' });
    assert.ok(roomsApi);
  });
});
