// Seeded fuzz test: plays thousands of random full matches in both modes with
// random configs and 3-15 players, checking invariants after every action.
//
// FUZZ_MATCHES=<n> overrides the number of matches per mode (default 1500).
// FUZZ_SEED=<n> changes the base seed.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_IDS,
  ERR,
  createMatch,
  applyAction,
  viewFor,
  eventsFor,
  listLegalActions,
  scoreMatch,
  toolsForMode,
  DEFAULT_PRICES,
} from '../src/engine/index.js';
import { deepFreeze } from './helpers.js';
import { checkEvents, checkState, checkSerializable, checkNoLeak, checkNoLeakForAll } from './invariants.js';

const MATCHES_PER_MODE = Number(process.env.FUZZ_MATCHES || 1500);
const BASE_SEED = Number(process.env.FUZZ_SEED || 20261116);
const MAX_STEPS = 30000;

// Independent test-side PRNG (never the engine's own generator).
function makeRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  const chance = (p) => next() < p;
  return { next, int, pick, chance };
}

function randomConfig(rnd, mode) {
  const config = { mode };
  if (rnd.chance(0.7)) config.hp = rnd.int(1, 6);
  if (rnd.chance(0.5)) config.toolsPerTurn = rnd.int(0, 5);
  if (rnd.chance(0.3)) config.randomizeSeats = rnd.chance(0.5);
  if (rnd.chance(0.3)) config.enabledTools = toolsForMode(mode).filter(() => rnd.chance(0.6));
  if (mode === 'classic') {
    if (rnd.chance(0.6)) config.toolsPerReload = rnd.int(0, 4);
  } else {
    const custom = {};
    if (rnd.chance(0.4)) custom.limitedStock = rnd.chance(0.5);
    if (rnd.chance(0.5)) custom.startCoins = rnd.int(0, 12);
    if (rnd.chance(0.5)) custom.coinsPerReload = rnd.int(0, 6);
    if (rnd.chance(0.3)) custom.selfBlankCoin = rnd.int(0, 3);
    if (rnd.chance(0.3)) custom.lootCoinCap = rnd.int(0, 5);
    if (rnd.chance(0.3)) {
      custom.prices = {};
      for (const tool of Object.keys(DEFAULT_PRICES)) if (rnd.chance(0.3)) custom.prices[tool] = rnd.int(0, 6);
    }
    if (rnd.chance(0.3)) {
      custom.stock = {};
      for (const tool of Object.keys(DEFAULT_PRICES)) {
        if (rnd.chance(0.3)) custom.stock[tool] = rnd.chance(0.5) ? rnd.int(0, 4) : { aliveDivisor: rnd.int(1, 6) };
      }
    }
    config.custom = custom;
  }
  return config;
}

// Actions that must always be rejected, whatever the state.
function invalidAction(rnd, state) {
  const anyId = rnd.pick(state.players).id;
  const dead = state.players.find((p) => !p.alive);
  const notCurrent = state.players.find((p) => p.alive && p.id !== state.turn.playerId);
  const options = [
    [{ type: 'nope', playerId: anyId }, ERR.UNKNOWN_ACTION],
    [null, ERR.INVALID_ACTION],
    [{ playerId: anyId }, ERR.INVALID_ACTION],
    [{ type: 'chooseTarget', playerId: 'ghost-of-nobody', target: anyId }, ERR.UNKNOWN_PLAYER],
    [{ type: 'useTool', playerId: anyId, tool: 'banana' }, null],
    [{ type: 'timeout', seq: state.clock.seq + 5 }, ERR.STALE_TIMEOUT],
    [{ type: 'transfer', playerId: anyId, to: anyId, amount: 1 }, null],
    [{ type: 'transfer', playerId: anyId, to: 'nobody', amount: -3 }, null],
    [{ type: 'buy', playerId: anyId, tool: 'banana' }, null],
    [{ type: 'lootChoice', playerId: anyId, choice: { kind: 'tool', tool: 'banana' } }, null],
    [{ type: 'stealChoice', playerId: anyId, take: 'banana', give: 'banana' }, null],
    [{ type: 'predict', playerId: anyId, prediction: 'maybe' }, null],
    [{ type: 'ransomAccept', playerId: anyId, from: anyId }, null],
  ];
  if (dead) options.push([{ type: 'chooseTarget', playerId: dead.id, target: anyId }, ERR.PLAYER_ELIMINATED]);
  if (dead) options.push([{ type: 'removePlayer', target: dead.id }, ERR.PLAYER_ELIMINATED]);
  options.push([{ type: 'removePlayer', target: 'nobody' }, ERR.UNKNOWN_PLAYER]);
  if (dead) options.push([{ type: 'chooseTarget', playerId: state.turn.playerId, target: dead.id }, null]);
  if (notCurrent) {
    options.push([{ type: 'chooseTarget', playerId: notCurrent.id, target: anyId }, ERR.NOT_YOUR_TURN]);
    options.push([{ type: 'confirmShot', playerId: notCurrent.id }, ERR.NOT_YOUR_TURN]);
  }
  return rnd.pick(options);
}

const PROGRESS = ['chooseTarget', 'confirmShot', 'lootChoice', 'stealChoice', 'handSwapTarget'];

function playMatch(seed, mode, stats) {
  const rnd = makeRandom(seed);
  const n = rnd.int(3, 15);
  const players = [];
  for (let i = 1; i <= n; i++) players.push({ id: `p${i}`, confirmShot: rnd.chance(0.5) });
  const config = randomConfig(rnd, mode);
  const created = createMatch(config, players, seed);
  assert.equal(created.ok, true, JSON.stringify(created.error));

  let state = deepFreeze(created.state);
  const log = created.events.slice();
  const history = [];
  checkEvents(state, created.events);
  checkState(state);
  checkSerializable(state);
  checkNoLeakForAll(state);

  let steps = 0;
  while (state.status === 'active') {
    steps += 1;
    assert.ok(steps < MAX_STEPS, `match did not terminate (seed ${seed}, mode ${mode})`);

    const roll = rnd.next();
    if (roll < 0.04) {
      const [action, code] = invalidAction(rnd, state);
      const res = applyAction(state, action);
      assert.equal(res.ok, false, `invalid action accepted: ${JSON.stringify(action)}`);
      if (code) assert.equal(res.error.code, code);
      assert.equal(res.state, state);
      assert.deepEqual(res.events, []);
      continue;
    }

    let action;
    if (roll < 0.1) {
      action = rnd.chance(0.5) ? { type: 'timeout' } : { type: 'timeout', seq: state.clock.seq };
    } else if (roll < 0.104) {
      // The host removes a (disconnected) living player from the match.
      action = { type: 'removePlayer', target: rnd.pick(state.players.filter((p) => p.alive)).id };
      stats.removals += 1;
    } else {
      // Loot never blocks (decision 63): looters choose (or let it expire) at random moments.
      const looters = state.players.filter((p) => (p.loots ?? []).length > 0);
      if (looters.length > 0 && rnd.chance(0.25)) {
        const looter = rnd.pick(looters);
        const loot = rnd.pick(looter.loots);
        const choices = listLegalActions(state, looter.id).filter((a) => a.type === 'lootChoice' && a.victim === loot.victim);
        action = rnd.chance(0.3) ? { type: 'lootChoice', playerId: looter.id, victim: loot.victim, choice: { kind: 'none' }, expired: true } : rnd.pick(choices);
      } else {
        const actor = rnd.chance(0.7) ? state.turn.playerId : rnd.pick(state.players).id;
        const legal = listLegalActions(state, actor);
        if (legal.length === 0) continue;
        const progress = legal.filter((a) => PROGRESS.includes(a.type));
        action = progress.length > 0 && rnd.chance(0.4) ? rnd.pick(progress) : rnd.pick(legal);
      }
    }

    const res = applyAction(state, action);
    assert.equal(res.ok, true, `legal action rejected: ${JSON.stringify(action)} -> ${JSON.stringify(res.error)}`);
    assert.notEqual(res.state, state);
    history.push(action);
    state = deepFreeze(res.state); // any later in-place mutation would throw
    log.push(...res.events);
    stats.loots += res.events.filter((e) => e.type === 'lootOffer').length;

    checkEvents(state, res.events);
    checkState(state);
    if (steps % 7 === 0) {
      checkSerializable(state);
      checkNoLeak(state, rnd.pick(state.players).id);
      checkNoLeak(state, null);
    }
    // A hidden action must not change what anybody else can see.
    stats.actions += 1;
  }

  // The match is over: exactly one winner or a draw, and nothing more happens.
  checkSerializable(state);
  checkNoLeakForAll(state);
  const ended = log.filter((e) => e.type === 'matchEnded');
  assert.equal(ended.length, 1);
  const after = applyAction(state, { type: 'timeout' });
  assert.equal(after.ok, false);
  assert.equal(after.error.code, ERR.MATCH_ENDED);
  for (const p of state.players) assert.deepEqual(listLegalActions(state, p.id), []);

  // Scoring works on the full log and gives the same result on the public log.
  const score = scoreMatch(log);
  assert.equal(score.complete, true);
  assert.deepEqual(scoreMatch(eventsFor(log, null)), score);
  for (const p of state.players) {
    assert.ok(Number.isInteger(score.players[p.id].total));
    assert.equal(score.players[p.id].win, state.result.winner === p.id ? 3 * n : 0);
    if (mode === 'classic') assert.equal(score.players[p.id].predictions, 0);
  }

  // Determinism: replaying the same actions reproduces the same final state.
  if (seed % 10 === 0) {
    let replay = createMatch(config, players, seed).state;
    for (const a of history) replay = applyAction(replay, a).state;
    assert.deepEqual(replay, state);
  }

  stats.matches += 1;
  stats[state.result.type] += 1;
  return state;
}

for (const mode of ['classic', 'custom']) {
  test(`fuzz: ${MATCHES_PER_MODE} random ${mode} matches keep every invariant`, () => {
    const stats = { matches: 0, actions: 0, win: 0, draw: 0, removals: 0, loots: 0 };
    const offset = mode === 'classic' ? 0 : 1000000;
    for (let i = 0; i < MATCHES_PER_MODE; i++) playMatch(BASE_SEED + offset + i, mode, stats);
    assert.equal(stats.matches, MATCHES_PER_MODE);
    assert.equal(stats.win + stats.draw, MATCHES_PER_MODE);
    assert.ok(stats.win > 0, 'at least some matches end with a winner');
    assert.ok(stats.removals > 0, 'the host removal action is exercised');
    assert.ok(stats.loots > 0, 'loot offers are exercised');
  });
}

test('fuzz: every tool id is exercised by the random matches', () => {
  // Guards the fuzz itself: with default configs each tool must get used.
  const used = {};
  for (const mode of ['classic', 'custom']) {
    for (let i = 0; i < 40; i++) {
      const rnd = makeRandom(900 + i);
      const players = [];
      for (let k = 1; k <= 6; k++) players.push({ id: `p${k}`, confirmShot: false });
      let state = createMatch({ mode }, players, 900 + i).state;
      let steps = 0;
      while (state.status === 'active' && steps++ < MAX_STEPS) {
        const actor = rnd.chance(0.8) ? state.turn.playerId : rnd.pick(state.players).id;
        const legal = listLegalActions(state, actor);
        if (legal.length === 0) continue;
        const action = rnd.pick(legal);
        const res = applyAction(state, action);
        assert.equal(res.ok, true);
        if (action.type === 'useTool') used[action.tool] = true;
        state = res.state;
      }
      assert.equal(state.status, 'ended');
    }
  }
  for (const tool of TOOL_IDS) assert.ok(used[tool], `fuzz never used ${tool}`);
  assert.ok(viewFor);
});
