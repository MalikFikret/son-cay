// The round pauses (decision Q79): the engine records on each new countdown how long the devices
// wait before it runs (state.clock.pauseMs): ROUND_INTRO_MS at the match start, the round-end pause
// + the intro when the same write refilled the roulette, 0 otherwise. The room layer (pauseWindow,
// planTimeout, lootDeadline) and the table (msLeft) shift every countdown by it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOT_SECONDS, REFILL_PAUSE_MS, ROUND_END_PAUSE_MS, ROUND_INTRO_MS, createMatch, viewFor,
} from '../src/engine/index.js';
import { lootDeadline, pausePhase, pauseWindow, planTimeout, rememberClockAt } from '../src/rooms/index.js';
import { msLeft } from '../src/ui/table-model.js';
import { act, edit, ids, pubs, setup, shoot, use, player } from './helpers.js';

const timeout = (state) => ({ type: 'timeout', seq: state.clock.seq });

test('round pause: the constants (fixed, not table settings)', () => {
  assert.equal(ROUND_END_PAUSE_MS, 5000);
  assert.equal(ROUND_INTRO_MS, 4000);
  assert.equal(REFILL_PAUSE_MS, 9000);
});

test('round pause: the match starts with the first round intro before the first turn', () => {
  const res = createMatch({ mode: 'classic' }, ids(4).map((id) => ({ id })), 3);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.clock, { seq: 1, kind: 'shot', playerId: res.state.turn.playerId, pauseMs: ROUND_INTRO_MS });
  // Public: every viewer reads the same pause.
  for (const viewer of [null, ...ids(4)]) assert.equal(viewFor(res.state, viewer).clock.pauseMs, ROUND_INTRO_MS);
});

test('round pause: an ordinary turn has none', () => {
  const s0 = setup({ n: 3, chambers: 'BBLB' });
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.turn.playerId, 'p2');
  assert.equal(state.clock.pauseMs, 0);
  const self = act(state, shoot('p2', 'p2')).state; // a self Boş keeps the turn
  assert.equal(self.clock.pauseMs, 0);
  assert.equal(self.clock.seq, state.clock.seq + 1);
});

test('round pause: the shot that ends a round refills and pauses the next countdown 5 s + 4 s', () => {
  const s0 = setup({ n: 3, chambers: 'B' });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(pubs(events, 'reloaded').length, 1);
  assert.equal(state.turn.playerId, 'p2');
  assert.deepEqual(state.clock, { seq: s0.clock.seq + 1, kind: 'shot', playerId: 'p2', pauseMs: REFILL_PAUSE_MS });
  // A self Boş on the last Mermi: the same player, after the pause.
  const self = act(setup({ n: 3, chambers: 'B' }), shoot('p1', 'p1')).state;
  assert.deepEqual(self.clock, { seq: s0.clock.seq + 1, kind: 'shot', playerId: 'p1', pauseMs: REFILL_PAUSE_MS });
  // A Dolu on the last Mermi too.
  const live = act(setup({ n: 3, chambers: 'L' }), shoot('p1', 'p2')).state;
  assert.equal(live.clock.pauseMs, REFILL_PAUSE_MS);
});

test('round pause: a timeout on the last Mermi pauses too; the next ordinary countdown does not', () => {
  const s0 = setup({ n: 3, chambers: 'B' });
  const { state } = act(s0, timeout(s0));
  assert.equal(state.clock.pauseMs, REFILL_PAUSE_MS);
  const next = act(state, shoot(state.turn.playerId, state.turn.playerId === 'p2' ? 'p3' : 'p2')).state;
  assert.equal(next.clock.pauseMs, 0);
});

test('round pause: Kaydır discarding the last Mermi refills mid-turn: the turn stays, a fresh countdown after the pause', () => {
  const s0 = setup({ n: 3, chambers: 'B', hands: { p1: ['skip'] } });
  const { state, events } = act(s0, use('p1', 'skip'));
  assert.equal(pubs(events, 'reloaded').length, 1);
  assert.deepEqual(state.clock, { seq: s0.clock.seq + 1, kind: 'shot', playerId: 'p1', pauseMs: REFILL_PAUSE_MS });
  // Kaydır that leaves Mermi in the cylinder changes nothing.
  const mid = act(setup({ n: 3, chambers: 'BB', hands: { p1: ['skip'] } }), use('p1', 'skip')).state;
  assert.equal(mid.clock.seq, s0.clock.seq);
});

test('round pause: the end of the match has none; a kill that ends the round opens its loot on the paused countdown', () => {
  const ended = act(setup({ n: 3, chambers: 'LB', hp: { p2: 1 } }), shoot('p1', 'p2')).state;
  assert.equal(ended.status, 'active');
  const lastTwo = edit(setup({ n: 3, chambers: 'L', hp: { p2: 1 } }), (d) => {
    const p3 = d.players.find((p) => p.id === 'p3');
    p3.alive = false;
    p3.hp = 0;
  });
  const over = act(lastTwo, shoot('p1', 'p2')).state;
  assert.equal(over.status, 'ended');
  assert.equal(over.clock.pauseMs, 0);
  const kill = act(setup({ n: 4, chambers: 'L', hp: { p2: 1 }, hands: { p2: ['heal'] } }), shoot('p1', 'p2')).state;
  assert.equal(kill.clock.pauseMs, REFILL_PAUSE_MS);
  assert.deepEqual(player(kill, 'p1').loots, [{ victim: 'p2', clockSeq: kill.clock.seq }]);
});

test('round pause: the room layer judges the window from clockAt and pauseMs only', () => {
  const clock = { seq: 9, kind: 'shot', playerId: 's01', pauseMs: REFILL_PAUSE_MS };
  const win = pauseWindow(clock, 100_000);
  assert.deepEqual(win, { seq: 9, start: 100_000, introAt: 105_000, end: 109_000 });
  assert.deepEqual(pausePhase(win, 101_000), { phase: 'roundEnd', leftMs: 8_000 });
  assert.deepEqual(pausePhase(win, 106_000), { phase: 'intro', leftMs: 3_000 });
  assert.deepEqual(pausePhase(win, 109_000), { phase: null, leftMs: 0 });
  // The match start: the intro only.
  assert.deepEqual(pauseWindow({ ...clock, pauseMs: ROUND_INTRO_MS }, 50_000), { seq: 9, start: 50_000, introAt: 50_000, end: 54_000 });
  // No pause: an ordinary countdown, a state stored before Q79, no countdown, no clockAt.
  assert.equal(pauseWindow({ ...clock, pauseMs: 0 }, 1), null);
  assert.equal(pauseWindow({ seq: 1, kind: 'shot', playerId: 's01' }, 1), null);
  assert.equal(pauseWindow({ ...clock, kind: 'none' }, 1), null);
  assert.equal(pauseWindow(clock, undefined), null);
});

test('round pause: the shot clock runs after the pause (timeout and the ring)', () => {
  const info = (pauseMs) => ({ ended: false, clock: { seq: 4, kind: 'shot', playerId: 's01', pauseMs }, clockAt: 10_000, shotTimeSeconds: 30, mySeat: 's01' });
  assert.equal(planTimeout(info(0), 0).fireAtServerMs, 10_000 + 30_000);
  assert.equal(planTimeout(info(REFILL_PAUSE_MS), 0).fireAtServerMs, 10_000 + 9_000 + 30_000, 'never sent during the pause');
  assert.equal(planTimeout({ ...info(ROUND_INTRO_MS), mySeat: 's02' }, 0).fireAtServerMs, 10_000 + 4_000 + 30_000 + 3_000);
  // The ring stands at the full time during the pause, then counts down.
  const ring = (serverNow) => msLeft({ clockAt: 10_000, pauseMs: REFILL_PAUSE_MS, seconds: 30, kind: 'shot', serverNow });
  assert.equal(ring(10_000), 30_000);
  assert.equal(ring(18_999), 30_000);
  assert.equal(ring(19_000), 30_000);
  assert.equal(ring(29_000), 20_000);
  assert.equal(ring(60_000), 0);
  assert.equal(msLeft({ clockAt: 10_000, seconds: 30, kind: 'shot', serverNow: 20_000 }), 20_000, 'no pause: as before');
});

test('round pause: a loot keeps its full time - the pause of its own countdown first, every later pause moves it', () => {
  assert.equal(LOOT_SECONDS, 15);
  // The kill ended the round: the loot's 15 s start after the 9 s pause.
  let memory = rememberClockAt({}, 5, 100_000, REFILL_PAUSE_MS);
  assert.equal(lootDeadline({ clockSeq: 5 }, memory), 100_000 + 9_000 + 15_000);
  // An ordinary kill at 100 s, then a round-ending write at 110 s while the loot is open:
  // frozen for that pause (5 s of choice time had passed; 10 s are left after it).
  memory = rememberClockAt({}, 5, 100_000, 0);
  memory = rememberClockAt(memory, 6, 110_000, REFILL_PAUSE_MS);
  assert.equal(lootDeadline({ clockSeq: 5 }, memory), 115_000 + 9_000);
  // A pause that starts after the loot has run out changes nothing.
  memory = rememberClockAt(memory, 7, 200_000, REFILL_PAUSE_MS);
  assert.equal(lootDeadline({ clockSeq: 5 }, memory), 124_000);
  // A pause beginning exactly in the extended window (two pauses in a row) moves it again.
  let chain = rememberClockAt({}, 5, 100_000, 0);
  chain = rememberClockAt(chain, 6, 110_000, REFILL_PAUSE_MS);
  chain = rememberClockAt(chain, 7, 121_000, REFILL_PAUSE_MS);
  assert.equal(lootDeadline({ clockSeq: 5 }, chain), 115_000 + 9_000 + 9_000);
});
