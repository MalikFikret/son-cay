// Edge cases the design document does not spell out. Each test pins down a
// decision recorded in docs/open-questions.md (the Q-numbers refer to it).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, viewFor } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, hpOf, edit } from './helpers.js';

test('Q11: a shield raised during the turn that uses the last chamber ends with that reload', () => {
  const s0 = setup({ chambers: 'B', hands: { p2: ['shotShield', 'toolShield'] } });
  const raised = play(s0, use('p2', 'shotShield'), use('p2', 'toolShield')).state;
  const { state } = act(raised, shoot('p1', 'p3'));
  assert.equal(state.round.index, 2);
  assert.deepEqual(player(state, 'p2').shields, { shot: [], tool: [] });
});

test('Q9: with a link between target and shooter, link damage is applied before a later reflection can claim the kill', () => {
  // p1 shoots p2. p2 is linked to p1 (created first) and to shielded p3.
  // Links are followed in creation order: p1 is hit through the link first,
  // so the bounce from p3's shield finds p1 already hit (safety rule) and
  // p1's death is their own doing.
  let s0 = setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 } });
  s0 = edit(s0, (d) => {
    d.links.push(['p2', 'p1'], ['p2', 'p3']);
    d.players[2].shields.shot.push(0);
  });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 0, p2: 4, p3: 5, p4: 5 });
  assert.equal(one(pubs(events, 'eliminated')).by, null);
  assert.equal(state.phase.type, 'turn');
  for (const p of state.players) assert.deepEqual(p.loots, [], 'nobody loots');
  assert.deepEqual(player(state, 'p3').shields.shot, [], 'the shield is still used up');
});

test('Q20: custom timeout blank still pays the self-blank coin and keeps the turn', () => {
  const s0 = setup({ mode: 'custom', chambers: 'BLB' });
  const { state, events } = act(s0, { type: 'timeout' });
  assert.equal(player(state, 'p1').coins, 5);
  assert.equal(one(privs(events, 'coinsChanged')).reason, 'selfBlank');
  assert.equal(state.turn.playerId, 'p1');
});

test('Q31: in custom, a flipped live on self acts as a blank in every respect - coin included', () => {
  const s0 = setup({ mode: 'custom', chambers: 'LBB', hands: { p1: ['flip'] } });
  const { state } = play(s0, use('p1', 'flip'), shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').coins, 5);
  assert.equal(player(state, 'p1').hp, 5);
  assert.equal(state.turn.playerId, 'p1');
});

test('Q30 (decision 63): loot never pauses the game; the turn of the looter is over, so their anytime tools are free', () => {
  const s0 = setup({
    n: 4,
    config: { toolsPerTurn: 1 },
    chambers: 'LBBB',
    hp: { p1: 3, p2: 1, p3: 3 },
    hands: { p1: ['heal', 'heal'], p3: ['heal', 'shotShield'] },
  });
  const pending = act(s0, shoot('p1', 'p2')).state;
  assert.equal(pending.phase.type, 'turn');
  assert.equal(pending.turn.playerId, 'p3', 'the turn passed at once');
  // The looter, outside their own turn: anytime tools are free of the limit.
  const looter = play(pending, use('p1', 'heal'), use('p1', 'heal')).state;
  assert.equal(player(looter, 'p1').hp, 5);
  // The turn player: the limit of 1 holds.
  const mine = act(looter, use('p3', 'heal')).state;
  fails(mine, use('p3', 'shotShield'), ERR.TOOL_LIMIT_REACHED);
  // The loot is still open and can be chosen any time.
  const done = act(mine, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'none' } }).state;
  assert.deepEqual(player(done, 'p1').loots, []);
});

test('Q13: the two-step hand swap counts once against the per-turn tool limit', () => {
  const s0 = setup({ config: { toolsPerTurn: 2 }, chambers: 'LBB', hands: { p1: ['handSwap', 'detector', 'probe'] } });
  const { state } = play(s0, use('p1', 'handSwap'), { type: 'handSwapTarget', playerId: 'p1', target: 'p2' });
  assert.equal(state.turn.toolsUsed, 1);
  assert.deepEqual(player(state, 'p2').hand, ['detector', 'probe']);
});

test('Q16: a ransom offer closes when the player it was made to is eliminated', () => {
  // p4 is jailed (not next in turn: the turn passes at once to p2, decision 63).
  let s0 = setup({ n: 4, chambers: 'LBBB', hp: { p3: 1 }, hands: { p4: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[3].jailed = true;
    d.players[3].ransomOffer = { to: 'p3', kind: 'tool', tool: 'heal' };
  });
  const { state, events } = act(s0, shoot('p1', 'p3'));
  assert.equal(player(state, 'p4').ransomOffer, null);
  assert.equal(player(state, 'p4').jailed, true, 'still jailed: nobody accepted');
  const closed = one(privs(events, 'ransomClosed'));
  assert.equal(closed.reason, 'eliminated');
  assert.deepEqual(closed.to, ['p4', 'p3']);
});

test('Q18: a match that ends on the last chamber does not reload or close the round', () => {
  let s0 = setup({ n: 3, chambers: 'L', hp: { p2: 1 } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.status, 'ended');
  assert.equal(pubs(events, 'roundEnded').length, 0);
  assert.equal(pubs(events, 'reloaded').length, 0);
  assert.equal(state.round.index, 1);
});

test('Q7: a double announced before a reload (skip on the last chamber) carries over to the next shot', () => {
  const s0 = setup({ chambers: 'B', hands: { p1: ['double', 'skip'] } });
  const { state } = play(s0, use('p1', 'double'), use('p1', 'skip'));
  assert.equal(state.round.index, 2);
  assert.equal(state.doublePending, true);
});

test('Q6: a flip mark moved by a shuffle stays on its chamber and still inverts it when fired', () => {
  let found = false;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const s0 = setup({ chambers: 'LBBB', hands: { p1: ['flip', 'shuffle'] }, seed });
    const shuffled = play(s0, use('p1', 'flip'), use('p1', 'shuffle')).state;
    const marked = shuffled.round.chambers.filter((c) => c.flipped);
    assert.equal(marked.length, 1);
    assert.equal(marked[0].type, 'live', 'the mark stayed on the live chamber');
    if (shuffled.round.chambers[0].flipped) continue; // want it away from the front
    found = true;
    // Fire chambers until the marked one: every blank before it stays blank, it shows blank too.
    let state = shuffled;
    const effects = [];
    while (state.round.index === 1 && state.status === 'active') {
      const res = act(state, shoot(state.turn.playerId, state.turn.playerId));
      effects.push(one(pubs(res.events, 'shot')).effect);
      state = res.state;
    }
    assert.deepEqual(effects, ['blank', 'blank', 'blank', 'blank'], 'the only live chamber was flipped to blank');
  }
  assert.ok(found);
});

test('Q25: a ghost may set a prediction while a loot is open; it applies to the next shot', () => {
  let s0 = setup({ mode: 'custom', n: 5, chambers: 'LLBBB', hp: { p2: 1 } });
  s0 = edit(s0, (d) => {
    Object.assign(d.players[4], { alive: false, hp: 0, coins: 0, privateInfo: null });
  });
  const pending = act(s0, shoot('p1', 'p2')).state;
  const predicted = act(pending, { type: 'predict', playerId: 'p5', prediction: 'live' }).state;
  // The newly eliminated player can predict as well.
  const both = act(predicted, { type: 'predict', playerId: 'p2', prediction: 'blank' }).state;
  const { events } = play(both, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'none' } }, shoot('p3', 'p4'));
  assert.deepEqual(
    pubs(events, 'predictionResolved').map((e) => [e.player, e.correct]),
    [
      ['p2', false],
      ['p5', true],
    ],
  );
});

test('Q28: the per-turn tool allowance is fresh when the only other player was jailed and the turn comes straight back', () => {
  let s0 = setup({ n: 3, config: { toolsPerTurn: 1 }, chambers: 'BBBB', hands: { p1: ['jail', 'detector'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const again = play(s0, use('p1', 'jail', { target: 'p2' }), shoot('p1', 'p2')).state;
  assert.equal(again.turn.playerId, 'p1');
  act(again, use('p1', 'detector'));
});
