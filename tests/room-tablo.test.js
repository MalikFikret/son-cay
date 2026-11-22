// The waiting room's seat order and the Tablo data (src/rooms/match-helpers.js,
// src/rooms/match-summary.js). Plain unit tests, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCORING, applyAction, createMatch, listLegalActions, publicEvents, scoreMatch } from '../src/engine/index.js';
import {
  SHOT_KINDS,
  buildResult,
  computeSessionScores,
  computeSessionTable,
  normalizeSeatOrder,
  orderBySurvival,
  orderSeats,
  parseLog,
  summarizeMatch,
} from '../src/rooms/index.js';

const seat = (joinedAt, name = 'n') => ({ uid: 'u', name, joinedAt });

describe('seat order', () => {
  test('normalizeSeatOrder accepts arrays and index-keyed objects, drops bad and repeated ids', () => {
    assert.deepEqual(normalizeSeatOrder({ seats: ['s03', 's01'], savedAt: 5 }), { seats: ['s03', 's01'], savedAt: 5 });
    assert.deepEqual(normalizeSeatOrder({ seats: { 1: 's01', 0: 's03', 4: 's02' }, savedAt: 5 }), { seats: ['s03', 's01', 's02'], savedAt: 5 });
    assert.deepEqual(normalizeSeatOrder({ seats: ['s03', 'x', 's03', 's16', 's01'], savedAt: 5 }), { seats: ['s03', 's01'], savedAt: 5 });
    for (const raw of [null, undefined, 'x', {}, { seats: ['s01'] }, { seats: [], savedAt: 1 }, { seats: ['zz'], savedAt: 1 }]) {
      assert.equal(normalizeSeatOrder(raw), null, JSON.stringify(raw));
    }
  });

  test('without a saved order: seat-id order, not manual', () => {
    const seats = { s03: seat(3), s01: seat(1), s02: seat(2) };
    assert.deepEqual(orderSeats(seats, null), { seatIds: ['s01', 's02', 's03'], manual: false });
  });

  test('with a saved order: its order, then the seats missing from it in seat-id order', () => {
    const seats = { s01: seat(1), s02: seat(2), s03: seat(3), s04: seat(4) };
    const order = { seats: ['s03', 's01'], savedAt: 10 };
    assert.deepEqual(orderSeats(seats, order), { seatIds: ['s03', 's01', 's02', 's04'], manual: true });
  });

  test('ids no longer seated are skipped; a player who sat down after the save comes last', () => {
    // s02 left after the save; a newcomer took s02 later (joinedAt 20 > savedAt 10).
    const seats = { s01: seat(1), s02: seat(20), s03: seat(3), s05: seat(15) };
    const order = { seats: ['s02', 's04', 's03', 's01'], savedAt: 10 };
    assert.deepEqual(orderSeats(seats, order).seatIds, ['s03', 's01', 's02', 's05']);
  });
});

describe('session table (Oturum)', () => {
  function result(rows, joinedAt, winner = null) {
    const players = {};
    for (const [seatId, total] of Object.entries(rows)) players[seatId] = { total };
    return { scoreJson: JSON.stringify({ players, result: winner ? 'win' : 'draw', winner }), joinedAt };
  }

  test('ranking by points, with matches played, wins and what the last match added', () => {
    const seats = { s01: seat(1), s02: seat(2), s03: seat(3), s04: seat(40) };
    const results = {
      1: result({ s01: 10, s02: 4, s03: 7 }, { s01: 1, s02: 2, s03: 3 }, 's01'),
      2: result({ s01: 3, s02: 12, s03: 5, s04: 6 }, { s01: 1, s02: 2, s03: 3, s04: 40 }, 's02'),
    };
    const table = computeSessionTable(results, seats);
    assert.equal(table.matches, 2);
    assert.deepEqual(table.rows, [
      { seatId: 's02', points: 16, matches: 2, wins: 1, last: 12 },
      { seatId: 's01', points: 13, matches: 2, wins: 1, last: 3 },
      { seatId: 's03', points: 12, matches: 2, wins: 0, last: 5 },
      { seatId: 's04', points: 6, matches: 1, wins: 0, last: 6 },
    ]);
    // Agrees with the session points used everywhere else.
    const scores = computeSessionScores(results, seats);
    for (const row of table.rows) assert.equal(row.points, scores[row.seatId]);
  });

  test('a newcomer on a freed seat starts from zero; nothing before the first match', () => {
    const results = { 1: result({ s01: 9, s02: 4 }, { s01: 1, s02: 2 }, 's01') };
    const table = computeSessionTable(results, { s01: seat(1), s02: seat(50) });
    assert.deepEqual(table.rows.find((r) => r.seatId === 's02'), { seatId: 's02', points: 0, matches: 0, wins: 0, last: null });
    assert.deepEqual(computeSessionTable(null, { s01: seat(1) }), { matches: 0, rows: [{ seatId: 's01', points: 0, matches: 0, wins: 0, last: null }] });
  });
});

// A seeded random [0, 1).
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

// Plays a whole match: the player the clock waits for picks a random legal action (sometimes
// lets the clock run out). Returns { state, log } as stored in rooms/{CODE}/match.
function playMatch(seed, { players = 4, config = { mode: 'classic' }, remove = null } = {}) {
  const random = rng(seed);
  const ids = Array.from({ length: players }, (_, i) => `s0${i + 1}`);
  let { state, events } = createMatch(config, ids.map((id) => ({ id })), seed);
  const log = { 0: JSON.stringify(events) };
  let seq = 0;
  const step = (action) => {
    const result = applyAction(state, action);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    state = result.state;
    seq += 1;
    log[seq] = JSON.stringify(result.events);
  };
  if (remove) step({ type: 'removePlayer', target: remove });
  for (let i = 0; i < 5000 && state.status !== 'ended'; i += 1) {
    const pid = state.clock.playerId;
    const actions = pid ? listLegalActions(state, pid).filter((a) => a.type !== 'timeout') : [];
    if (actions.length === 0 || random() < 0.15) step({ type: 'timeout', seq: state.clock.seq });
    else step(actions[Math.floor(random() * actions.length)]);
  }
  assert.equal(state.status, 'ended');
  return { state, log };
}

describe('last match summary (Bu maç)', () => {
  test('totals are the engine\'s; the breakdown adds up to them; the shot lines add up to the shot points', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { state, log } = playMatch(seed, { players: 3 + (seed % 4) });
      const summary = summarizeMatch({ n: 1, state, log });
      const score = scoreMatch(parseLog(log).flatMap((e) => e.events), DEFAULT_SCORING);
      assert.equal(summary.rows.length, state.players.length);
      for (const row of summary.rows) {
        const engine = score.players[row.seatId];
        assert.equal(row.points, engine.total, `seed ${seed} ${row.seatId}`);
        const shots = SHOT_KINDS.reduce((sum, kind) => sum + row.breakdown[kind].points, 0);
        assert.equal(shots, engine.shots, `seed ${seed} ${row.seatId} shots`);
        assert.equal(row.breakdown.eliminations.points, engine.eliminations);
        assert.equal(row.breakdown.rounds.points, engine.rounds);
        assert.equal(row.breakdown.win.points, engine.win);
        const sum = shots + row.breakdown.eliminations.points + row.breakdown.rounds.points
          + row.breakdown.win.points + row.breakdown.predictions.points;
        assert.equal(sum, row.points);
        assert.equal(row.roundsSurvived, row.breakdown.rounds.count);
      }
    }
  });

  test('rows by survival: winner first, then the players who are out, the last one out first', () => {
    for (let seed = 50; seed <= 70; seed += 1) {
      const { state, log } = playMatch(seed, { players: 5 });
      const summary = summarizeMatch({ n: 3, state, log });
      const events = publicEvents(parseLog(log).flatMap((e) => e.events));
      const outOrder = events.filter((e) => e.type === 'eliminated').map((e) => e.player);
      const end = events.find((e) => e.type === 'matchEnded');
      if (end.result === 'win') {
        assert.equal(summary.rows[0].seatId, end.winner);
        assert.equal(summary.rows[0].status, 'won');
        assert.equal(summary.rows[0].outRound, null);
      }
      const outRows = summary.rows.filter((r) => r.status === 'eliminated');
      assert.deepEqual(outRows.map((r) => r.seatId), [...outOrder].reverse(), `seed ${seed}`);
      for (const row of outRows) assert.ok(row.outRound >= 1 && row.outRound <= summary.rounds);
      assert.equal(summary.n, 3);
      assert.equal(summary.mode, 'classic');
      assert.equal(summary.rounds, events.filter((e) => e.type === 'roundEnded').length + 1);
    }
  });

  test('a removed player is "removed", out in the round of the removal, credited to nobody', () => {
    const { state, log } = playMatch(7, { players: 4, remove: 's02' });
    const row = summarizeMatch({ n: 1, state, log }).rows.find((r) => r.seatId === 's02');
    assert.equal(row.status, 'removed');
    assert.equal(row.outRound, 1);
  });

  test('only public data: the summary is the same from the public events alone', () => {
    const { state, log } = playMatch(11, { players: 4 });
    const publicOnly = {};
    for (const { seq, events } of parseLog(log)) publicOnly[seq] = JSON.stringify(publicEvents(events));
    assert.deepEqual(summarizeMatch({ n: 1, state, log: publicOnly }), summarizeMatch({ n: 1, state, log }));
    const text = JSON.stringify(summarizeMatch({ n: 1, state, log }));
    for (const secret of ['hand', 'tools', 'coins', 'chamber', '"by"']) assert.ok(!text.includes(secret), secret);
  });

  test('agrees with the stored result (buildResult) of the same match', () => {
    const { state, log } = playMatch(23, { players: 4 });
    const stored = JSON.parse(buildResult(state, log, null).scoreJson);
    for (const row of summarizeMatch({ n: 1, state, log }).rows) assert.equal(row.points, stored.players[row.seatId].total);
  });

  test('orderBySurvival: winner, living by points, then out players last-out first', () => {
    const rows = [
      { seatId: 's01', status: 'eliminated', points: 9, outOrder: 1 },
      { seatId: 's02', status: 'alive', points: 3 },
      { seatId: 's03', status: 'removed', points: 0, outOrder: 5 },
      { seatId: 's04', status: 'won', points: 1 },
      { seatId: 's05', status: 'alive', points: 8 },
      { seatId: 's06', status: 'eliminated', points: 2, outOrder: 3 },
    ];
    assert.deepEqual(orderBySurvival(rows).map((r) => r.seatId), ['s04', 's05', 's02', 's03', 's06', 's01']);
  });
});
