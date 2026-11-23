// The engine contract: pure, deterministic, JSON state, never mutated,
// invalid actions rejected with a code and no change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERR, ACTION_TYPES, TOOL_IDS, createMatch, applyAction, listLegalActions, viewFor } from '../src/engine/index.js';
import { ids, setup, act, fails, shoot, use, deepFreeze } from './helpers.js';

const engineDir = fileURLToPath(new URL('../src/engine/', import.meta.url));
const engineFiles = readdirSync(engineDir).filter((f) => f.endsWith('.js'));

test('contract: the engine has no clock, no randomness of its own, no I/O and no dependencies', () => {
  assert.ok(engineFiles.length >= 10);
  const banned = [
    'Math.random',
    'Date.now',
    'new Date',
    'performance.',
    'setTimeout',
    'setInterval',
    'fetch(',
    'require(',
    'process.',
    'localStorage',
    'document.',
    'window.',
    'console.',
    'crypto.',
  ];
  for (const file of engineFiles) {
    const source = readFileSync(engineDir + file, 'utf8');
    // Comments may mention anything; only code is checked.
    const code = source
      .split('\n')
      .map((line) => {
        if (line.trimStart().startsWith('//')) return '';
        const at = line.indexOf(' // ');
        return at === -1 ? line : line.slice(0, at);
      })
      .join('\n');
    assert.ok(!source.includes('/*'), `${file}: use line comments so this check stays simple`);
    for (const word of banned) assert.ok(!code.includes(word), `${file} must not use ${word}`);
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      assert.ok(match[1].startsWith('./'), `${file} imports ${match[1]}: only relative engine modules are allowed`);
    }
  }
});

test('contract: the engine contains no display strings in Arabic (ASCII only)', () => {
  for (const file of engineFiles) {
    const source = readFileSync(engineDir + file, 'utf8');
    // eslint-disable-next-line no-control-regex
    assert.ok(/^[\x00-\x7F]*$/.test(source), `${file} contains non-ASCII characters`);
  }
});

test('contract: stable English identifiers for tools and actions', () => {
  for (const id of [...TOOL_IDS, ...ACTION_TYPES]) assert.match(id, /^[a-z][A-Za-z]*$/);
  assert.equal(TOOL_IDS.length, 16);
});

test('contract: applyAction never mutates the state it is given', () => {
  // Every state in this walk is deep-frozen: an in-place write would throw.
  let state = deepFreeze(createMatch({ mode: 'custom' }, ids(5).map((id) => ({ id })), 7).state);
  const snapshot = JSON.stringify(state);
  const first = state;
  for (let i = 0; i < 300 && state.status === 'active'; i++) {
    const actor = state.turn.playerId;
    const legal = listLegalActions(state, actor);
    const res = applyAction(state, legal[i % legal.length]);
    assert.equal(res.ok, true);
    assert.notEqual(res.state, state);
    state = deepFreeze(res.state);
  }
  assert.equal(JSON.stringify(first), snapshot);
});

test('contract: the returned state shares no objects with the input state', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['heal'] } });
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.notEqual(state.players, s0.players);
  assert.notEqual(state.players[2], s0.players[2]);
  assert.notEqual(state.config, s0.config);
  assert.notEqual(state.round.chambers, s0.round.chambers);
});

test('contract: the state is plain data - no classes, Maps, Sets or functions', () => {
  const check = (value, path) => {
    if (value === null) return;
    const t = typeof value;
    assert.ok(['string', 'number', 'boolean', 'object'].includes(t), `${path} is a ${t}`);
    if (t === 'number') assert.ok(Number.isFinite(value), `${path} is not finite`);
    if (t !== 'object') return;
    const proto = Object.getPrototypeOf(value);
    assert.ok(proto === Object.prototype || proto === Array.prototype, `${path} is not a plain object/array`);
    for (const key of Object.keys(value)) check(value[key], `${path}.${key}`);
  };
  for (const mode of ['classic', 'custom']) {
    let state = createMatch({ mode }, ids(4).map((id) => ({ id })), 3).state;
    check(state, 'state');
    for (let i = 0; i < 60 && state.status === 'active'; i++) {
      state = applyAction(state, { type: 'timeout' }).state;
      check(state, 'state');
    }
  }
});

test('contract: a state that went through JSON behaves exactly the same', () => {
  let a = createMatch({ mode: 'custom' }, ids(6).map((id) => ({ id })), 55).state;
  let b = JSON.parse(JSON.stringify(a));
  for (let i = 0; i < 200 && a.status === 'active'; i++) {
    const actor = a.turn.playerId;
    const legal = listLegalActions(a, actor);
    const action = legal[(i * 7) % legal.length];
    const ra = applyAction(a, action);
    const rb = applyAction(b, JSON.parse(JSON.stringify(action)));
    assert.deepEqual(rb, ra);
    a = ra.state;
    b = JSON.parse(JSON.stringify(rb.state));
  }
});

test('contract: the same state and action always give the same result (randomness lives in the state)', () => {
  const s0 = setup({ chambers: 'LBLBLB', hands: { p1: ['shuffle'] } });
  const a = applyAction(s0, use('p1', 'shuffle'));
  const b = applyAction(s0, use('p1', 'shuffle'));
  assert.deepEqual(a, b);
  assert.notEqual(a.state.rng.s, s0.rng.s, 'the generator state advances inside the state');
});

test('contract: a rejected action returns the very same state object, no events, and an error code + message', () => {
  const s0 = setup({ chambers: 'LBB' });
  const res = fails(s0, shoot('p2', 'p1'), ERR.NOT_YOUR_TURN);
  assert.equal(typeof res.error.message, 'string');
  assert.ok(res.error.message.length > 0);
});

test('contract: malformed actions are rejected, never thrown', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['link', 'jail'] } });
  const bad = [
    [undefined, ERR.INVALID_ACTION],
    [null, ERR.INVALID_ACTION],
    ['shoot', ERR.INVALID_ACTION],
    [42, ERR.INVALID_ACTION],
    [[], ERR.INVALID_ACTION],
    [{}, ERR.INVALID_ACTION],
    [{ type: 7 }, ERR.INVALID_ACTION],
    [{ type: 'fly' }, ERR.UNKNOWN_ACTION],
    [{ type: 'toString' }, ERR.UNKNOWN_ACTION],
    [{ type: 'constructor' }, ERR.UNKNOWN_ACTION],
    [{ type: 'chooseTarget' }, ERR.INVALID_ACTION],
    [{ type: 'chooseTarget', playerId: 5, target: 'p2' }, ERR.INVALID_ACTION],
    [{ type: 'chooseTarget', playerId: 'p1', target: { id: 'p2' } }, ERR.INVALID_TARGET],
    [{ type: 'useTool', playerId: 'p1', tool: 'link', targets: 'p2,p3' }, ERR.INVALID_TARGET],
    [{ type: 'useTool', playerId: 'p1', tool: 'link', targets: [null, 'p3'] }, ERR.INVALID_TARGET],
    [{ type: 'useTool', playerId: 'p1', tool: 'jail', target: 3 }, ERR.INVALID_TARGET],
    [{ type: 'useTool', playerId: 'p1', tool: '__proto__' }, ERR.UNKNOWN_TOOL],
    [{ type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: 'heal' }, ERR.NO_LOOT],
    [{ type: 'ransomAccept', playerId: 'p1', from: null }, ERR.INVALID_ACTION],
    [{ type: 'timeout', seq: 'now' }, ERR.STALE_TIMEOUT],
  ];
  for (const [action, code] of bad) fails(s0, action, code);
});

test('contract: names of built-in object properties are never mistaken for tools, players or settings', () => {
  const s0 = setup({ chambers: 'LBB' });
  for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    fails(s0, use('p1', word), ERR.UNKNOWN_TOOL);
    fails(s0, shoot('p1', word), ERR.INVALID_TARGET);
    fails(s0, shoot(word, 'p1'), ERR.UNKNOWN_PLAYER);
    const players = [{ id: word }, { id: 'a' }, { id: 'b' }];
    assert.equal(createMatch({}, players, 1).error.code, ERR.INVALID_PLAYERS);
    assert.equal(createMatch({ enabledTools: [word] }, ids(3).map((id) => ({ id })), 1).error.code, ERR.INVALID_CONFIG);
    assert.equal(
      createMatch({ mode: 'custom', custom: { prices: { [word]: 1 } } }, ids(3).map((id) => ({ id })), 1).error.code,
      ERR.INVALID_CONFIG,
    );
  }
  assert.equal(createMatch({}, [{ id: 'has space' }, { id: 'a' }, { id: 'b' }], 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, [{ id: 'x'.repeat(65) }, { id: 'a' }, { id: 'b' }], 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, [{ id: 'Aa_9-z' }, { id: 'a' }, { id: 'b' }], 1).ok, true);
});

test('contract: applyAction rejects something that is not a match state', () => {
  for (const notState of [null, undefined, {}, [], { version: 999, players: [] }, 'state']) {
    const res = applyAction(notState, { type: 'timeout' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, ERR.INVALID_STATE);
  }
});

test('contract: every action type is handled', () => {
  const s0 = setup({ chambers: 'LBB' });
  for (const type of ACTION_TYPES) {
    const res = applyAction(s0, { type, playerId: 'p1' });
    if (!res.ok) assert.notEqual(res.error.code, ERR.UNKNOWN_ACTION, `${type} has no handler`);
  }
});

test('legal actions: everything listed is accepted, for every player, at every step of a match', () => {
  for (const mode of ['classic', 'custom']) {
    let state = createMatch({ mode }, ids(5).map((id) => ({ id, confirmShot: true })), 404).state;
    let step = 0;
    while (state.status === 'active') {
      assert.ok(step++ < 5000);
      for (const p of state.players) {
        for (const action of listLegalActions(state, p.id)) {
          const res = applyAction(state, action);
          assert.equal(res.ok, true, `${JSON.stringify(action)} -> ${JSON.stringify(res.error)}`);
        }
      }
      const actor = state.turn.playerId;
      const legal = listLegalActions(state, actor);
      state = applyAction(state, legal[(step * 13) % legal.length]).state;
      if (step % 9 === 0 && state.status === 'active') state = applyAction(state, { type: 'timeout' }).state;
    }
  }
});

test('legal actions: the turn player can always shoot any living player; others cannot shoot', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['jail', 'link', 'heal'], p2: ['heal', 'detector'] }, hp: { p2: 2 } });
  const mine = listLegalActions(s0, 'p1');
  assert.deepEqual(
    mine.filter((a) => a.type === 'chooseTarget').map((a) => a.target),
    ['p1', 'p2', 'p3', 'p4'],
  );
  assert.equal(mine.filter((a) => a.tool === 'jail').length, 3);
  assert.equal(mine.filter((a) => a.tool === 'link').length, 6);
  assert.equal(mine.filter((a) => a.tool === 'heal').length, 0, 'full health: heal is not offered');
  const theirs = listLegalActions(s0, 'p2');
  assert.deepEqual(
    theirs.map((a) => a.tool || a.type),
    ['heal', 'setPreference'],
    'out of turn: only anytime tools and own settings',
  );
  assert.deepEqual(listLegalActions(s0, 'nobody'), []);
  assert.ok(viewFor);
});
