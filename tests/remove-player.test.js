// System action `removePlayer` (design change 2 in docs/design-changes.md):
// the host removes a player from the current match.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, viewFor, listLegalActions, scoreMatch } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, hpOf, edit } from './helpers.js';

const remove = (target) => ({ type: 'removePlayer', target });

// Gives players already-active shields / links / jail without playing the turns.
function prepared(state, { shotShields = [], toolShields = [], links = [], jailed = [] } = {}) {
  return edit(state, (d) => {
    for (const id of shotShields) d.players.find((p) => p.id === id).shields.shot.push(0);
    for (const id of toolShields) d.players.find((p) => p.id === id).shields.tool.push(0);
    for (const link of links) d.links.push(link.slice());
    for (const id of jailed) d.players.find((p) => p.id === id).jailed = true;
  });
}

// A real log starts with matchStarted (it lists every player).
function withStart(state, events) {
  const started = {
    type: 'matchStarted',
    mode: state.config.mode,
    seats: state.players.map((p) => p.id),
    startingPlayers: state.startingPlayers,
    visibility: 'public',
  };
  return [started, ...events];
}

test('removePlayer: the removed player is out, announced publicly, with their tools and coins gone', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBBB', hands: { p3: ['heal', 'jail'] }, coins: { p3: 9 } });
  const { state, events } = act(s0, remove('p3'));
  const p3 = player(state, 'p3');
  assert.deepEqual(
    { alive: p3.alive, hp: p3.hp, hand: p3.hand, coins: p3.coins, privateInfo: p3.privateInfo },
    { alive: false, hp: 0, hand: [], coins: 0, privateInfo: null },
  );
  assert.deepEqual(pubs(events), [{ type: 'playerRemoved', player: 'p3', visibility: 'public' }]);
  assert.equal(state.turn.playerId, 'p1', 'not their turn: nothing else moves');
  assert.equal(state.clock.seq, s0.clock.seq, 'the shot timer of the turn player keeps running');
  // In Custom they become a ghost like any eliminated player.
  assert.equal(viewFor(state, 'p3').role, 'ghost');
  act(state, { type: 'predict', playerId: 'p3', prediction: 'live' });
  fails(state, shoot('p3', 'p1'), ERR.PLAYER_ELIMINATED);
  assert.deepEqual(listLegalActions(state, 'p3').map((a) => a.type), ['predict', 'predict', 'predict']);
});

test('removePlayer on the turn player: the turn passes to the next living player', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['double'] } });
  const doubled = act(s0, use('p1', 'double')).state;
  const { state, events } = act(doubled, remove('p1'));
  assert.equal(state.turn.playerId, 'p2');
  assert.equal(state.turn.number, s0.turn.number + 1);
  assert.equal(state.turn.toolsUsed, 0);
  assert.notEqual(state.clock.seq, doubled.clock.seq, 'the next player gets a fresh timer');
  assert.deepEqual(
    pubs(events).map((e) => e.type),
    ['playerRemoved', 'turnStarted'],
  );
  // An announced double stays for the next shot (closest to "the next shot is doubled").
  assert.equal(state.doublePending, true);
  assert.equal(player(act(state, shoot('p2', 'p3')).state, 'p3').hp, 3);
});

test('removePlayer on the turn player abandons their pending aim, hand swap or steal', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', confirm: true, hands: { p1: ['handSwap', 'steal', 'probe'], p2: ['heal'] } });
  const aimed = act(s0, shoot('p1', 'p2')).state;
  const fromAim = act(aimed, remove('p1')).state;
  assert.deepEqual(fromAim.phase, { type: 'turn' });
  assert.equal(fromAim.turn.playerId, 'p2');
  assert.deepEqual(hpOf(fromAim), { p1: 0, p2: 5, p3: 5, p4: 5 }, 'no shot is fired');

  const swapping = act(s0, use('p1', 'handSwap')).state;
  const fromSwap = act(swapping, remove('p1'));
  assert.deepEqual(fromSwap.state.phase, { type: 'turn' });
  assert.deepEqual(player(fromSwap.state, 'p2').hand, ['heal'], 'nothing was swapped');

  const peeking = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  const fromSteal = act(peeking, remove('p1')).state;
  assert.deepEqual(fromSteal.phase, { type: 'turn' });
  assert.deepEqual(player(fromSteal, 'p2').hand, ['heal']);
  assert.equal(fromSteal.turn.playerId, 'p2');
});

test('removePlayer on the target of a pending aim or steal: that step is dropped, the turn stays', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', confirm: true, hands: { p1: ['steal', 'probe'], p3: ['heal'] } });
  const aimed = act(s0, shoot('p1', 'p3')).state;
  const fromAim = act(aimed, remove('p3'));
  assert.deepEqual(fromAim.state.phase, { type: 'turn' });
  assert.equal(fromAim.state.turn.playerId, 'p1');
  assert.deepEqual(one(privs(fromAim.events, 'targetCancelled')).to, ['p1']);
  fails(fromAim.state, { type: 'confirmShot', playerId: 'p1' }, ERR.WRONG_PHASE);

  const peeking = act(s0, use('p1', 'steal', { target: 'p3' })).state;
  const fromSteal = act(peeking, remove('p3'));
  assert.deepEqual(fromSteal.state.phase, { type: 'turn' });
  assert.equal(one(privs(fromSteal.events, 'stealResult')).taken, null);
  assert.deepEqual(player(fromSteal.state, 'p1').hand, ['probe']);
});

test('removePlayer on a jailed player: jail cleared and ransom offers from them closed', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hands: { p2: ['heal'] } });
  s0 = prepared(s0, { jailed: ['p2'] });
  const offered = act(s0, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } }).state;
  const { state, events } = act(offered, remove('p2'));
  assert.equal(player(state, 'p2').jailed, false);
  assert.equal(player(state, 'p2').ransomOffer, null);
  const closed = one(privs(events, 'ransomClosed'));
  assert.equal(closed.reason, 'removed');
  assert.deepEqual(closed.to, ['p2', 'p3']);
  fails(state, { type: 'ransomAccept', playerId: 'p3', from: 'p2' }, ERR.NO_OFFER);
  // The dead seat is simply passed over: no "turn skipped" for a jail any more.
  const next = act(state, shoot('p1', 'p4'));
  assert.equal(next.state.turn.playerId, 'p3');
  assert.equal(pubs(next.events, 'turnSkipped').length, 0);
});

test('removePlayer: ransom offers made TO the removed player are closed', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hands: { p2: ['heal'] } });
  s0 = prepared(s0, { jailed: ['p2'] });
  const offered = act(s0, { type: 'ransomOffer', playerId: 'p2', to: 'p4', offer: { kind: 'tool', tool: 'heal' } }).state;
  const { state, events } = act(offered, remove('p4'));
  assert.equal(player(state, 'p2').ransomOffer, null);
  assert.equal(player(state, 'p2').jailed, true, 'still jailed: nobody accepted');
  assert.equal(one(privs(events, 'ransomClosed')).reason, 'removed');
});

test('removePlayer on a linked player: the link is dissolved and their shields are discarded', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB' });
  s0 = prepared(s0, { shotShields: ['p3'], toolShields: ['p3'], links: [['p2', 'p3'], ['p3', 'p4']] });
  const { state } = act(s0, remove('p3'));
  assert.deepEqual(state.links, []);
  assert.deepEqual(player(state, 'p3').shields, { shot: [], tool: [] });
  // A shot at the former partner now hurts only them.
  const shot = act(state, shoot('p1', 'p2')).state;
  assert.deepEqual(hpOf(shot), { p1: 5, p2: 4, p3: 0, p4: 5 });
});

test('removePlayer on a looter with an open loot: the loot is lost, the turn is untouched (decision 63)', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p1: ['probe'], p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  assert.deepEqual(player(pending, 'p1').loots.map((l) => l.victim), ['p2']);
  assert.equal(pending.turn.playerId, 'p3');
  const { state, events } = act(pending, remove('p1'));
  assert.deepEqual(state.phase, { type: 'turn' });
  assert.equal(state.turn.playerId, 'p3');
  assert.equal(state.clock.seq, pending.clock.seq, 'not the turn of p1: the clock does not move');
  for (const p of state.players) {
    if (p.alive) assert.deepEqual(p.hand, [], 'nobody received the tools of the victim or the looter');
  }
  assert.deepEqual(player(state, 'p2').hand, []);
  assert.deepEqual(player(state, 'p1').loots, []);
  assert.deepEqual(pubs(events).map((e) => e.type), ['playerRemoved']);
  assert.equal(one(privs(events, 'lootResult')).reason, 'looterOut');
});

test('removePlayer on a looter: only their loots are lost, other looters keep theirs', () => {
  let s0 = setup({ n: 6, chambers: 'LBBBBB', hands: { p4: ['heal'], p5: ['jail'], p6: ['link'] } });
  s0 = edit(s0, (d) => {
    for (const id of ['p4', 'p5', 'p6']) Object.assign(d.players.find((p) => p.id === id), { alive: false, hp: 0 });
    d.players.find((p) => p.id === 'p3').loots = [{ victim: 'p4', clockSeq: d.clock.seq }];
    d.players.find((p) => p.id === 'p1').loots = [{ victim: 'p5', clockSeq: d.clock.seq }, { victim: 'p6', clockSeq: d.clock.seq }];
  });
  const { state, events } = act(s0, remove('p1'));
  assert.deepEqual(player(state, 'p3').loots, [{ victim: 'p4', clockSeq: s0.clock.seq }], 'the other looter keeps theirs');
  assert.equal(privs(events, 'lootResult').length, 2);
  assert.deepEqual(player(state, 'p5').hand, []);
  assert.deepEqual(player(state, 'p6').hand, []);
  const done = act(state, { type: 'lootChoice', playerId: 'p3', victim: 'p4', choice: { kind: 'tool', tool: 'heal' } }).state;
  assert.deepEqual(player(done, 'p3').hand, ['heal']);
});

test('removePlayer on the second-to-last player: the match ends with a win and the normal win bonus', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hands: { p2: ['heal'] } });
  s0 = edit(s0, (d) => {
    Object.assign(d.players[2], { alive: false, hp: 0 });
  });
  const { state, events } = act(s0, remove('p2'));
  assert.equal(state.status, 'ended');
  assert.deepEqual(state.result, { type: 'win', winner: 'p1' });
  assert.deepEqual(
    pubs(events).map((e) => e.type),
    ['playerRemoved', 'matchEnded'],
  );
  const score = scoreMatch(withStart(state, events));
  assert.equal(score.players.p1.win, 9);
  assert.equal(score.winner, 'p1');
  fails(state, remove('p1'), ERR.MATCH_ENDED);
});

test('removePlayer is rejected for an eliminated or unknown player, or a missing target', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB' });
  s0 = edit(s0, (d) => {
    Object.assign(d.players[3], { alive: false, hp: 0 });
  });
  fails(s0, remove('p4'), ERR.PLAYER_ELIMINATED);
  fails(s0, remove('nobody'), ERR.UNKNOWN_PLAYER);
  fails(s0, remove('constructor'), ERR.UNKNOWN_PLAYER);
  fails(s0, { type: 'removePlayer' }, ERR.INVALID_TARGET);
  fails(s0, { type: 'removePlayer', target: 3 }, ERR.INVALID_TARGET);
  const removed = act(s0, remove('p2')).state;
  fails(removed, remove('p2'), ERR.PLAYER_ELIMINATED);
});

test('removed player gets no loot given to anyone and no elimination points for anyone', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['probe'], p2: ['heal', 'jail'], p3: ['link'] } });
  const { state, events } = act(s0, remove('p2'));
  assert.equal(state.phase.type, 'turn');
  for (const p of state.players) assert.deepEqual(p.loots, [], 'no loot for anyone');
  assert.equal(pubs(events, 'eliminated').length, 0, 'nobody is credited');
  assert.deepEqual(player(state, 'p1').hand, ['probe']);
  assert.deepEqual(player(state, 'p3').hand, ['link']);
  const score = scoreMatch(withStart(state, events));
  for (const id of ['p1', 'p2', 'p3', 'p4']) assert.equal(score.players[id].eliminations, 0);
});

test('removePlayer: the removed player keeps earlier session points but gets no round points for the round in progress', () => {
  const s0 = setup({ n: 4, chambers: 'BBLB' });
  // p1 blank on self (+2), then p1 is removed; the round is played out by the others.
  const { events } = play(s0, shoot('p1', 'p1'), remove('p1'), shoot('p2', 'p3'), shoot('p3', 'p4'), shoot('p4', 'p2'));
  const ended = one(pubs(events, 'roundEnded'));
  assert.deepEqual(ended.survivors, ['p2', 'p3', 'p4']);
  const score = scoreMatch(withStart(s0, events)).players;
  assert.deepEqual(score.p1, { total: 2, shots: 2, eliminations: 0, rounds: 0, win: 0, predictions: 0 });
  assert.equal(score.p2.rounds, 4);
});

test('removePlayer: the public event carries only the player id; nothing secret leaks', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBBB', hands: { p2: ['heal', 'jail'] }, coins: { p2: 7 } });
  const { events } = act(s0, remove('p2'));
  const publicJson = JSON.stringify(pubs(events));
  assert.equal(publicJson, JSON.stringify([{ type: 'playerRemoved', player: 'p2', visibility: 'public' }]));
});
