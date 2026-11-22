// The turn, the confirmation step, time-outs and leaving
// (document: "The turn", "Confirmation before firing", "Time and leaving").

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, applyAction, createMatch, viewFor } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, hpOf, edit } from './helpers.js';

// --- The four rows of the turn table ---------------------------------------

test('turn table: blank on yourself -> nothing happens, the turn stays, you play the next chamber', () => {
  const s0 = setup({ chambers: 'BLB' });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 5, p3: 5 });
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.round.cursor, 1);
  const shot = one(pubs(events, 'shot'));
  assert.equal(shot.effect, 'blank');
  assert.deepEqual(shot.hits, []);
});

test('turn table: live on yourself -> you lose one life point, the turn passes', () => {
  const s0 = setup({ chambers: 'LBB' });
  const { state } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 5, p3: 5 });
  assert.equal(state.turn.playerId, 'p2');
});

test('turn table: blank on another player -> nothing happens, the turn passes', () => {
  const s0 = setup({ chambers: 'BLB' });
  const { state } = act(s0, shoot('p1', 'p3'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 5, p3: 5 });
  assert.equal(state.turn.playerId, 'p2');
});

test('turn table: live on another player -> the target loses one life point, the turn passes', () => {
  const s0 = setup({ chambers: 'LBB' });
  const { state, events } = act(s0, shoot('p1', 'p3'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 5, p3: 4 });
  assert.equal(state.turn.playerId, 'p2');
  const shot = one(pubs(events, 'shot'));
  assert.deepEqual(shot.hits, [{ player: 'p3', result: 'damage', amount: 1, hp: 4, via: 'direct' }]);
});

// --- Turn order --------------------------------------------------------------

test('turn: play goes around the table and never jumps to the target', () => {
  const s0 = setup({ n: 4, chambers: 'BBBBBB' });
  const { state, events } = play(s0, shoot('p1', 'p3'), shoot('p2', 'p4'), shoot('p3', 'p1'), shoot('p4', 'p2'));
  assert.deepEqual(
    pubs(events, 'turnStarted').map((e) => e.player),
    ['p2', 'p3', 'p4', 'p1'],
  );
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.turn.number, 5);
});

test('turn: several blanks on yourself keep the turn each time', () => {
  const s0 = setup({ chambers: 'BBBL' });
  const { state } = play(s0, shoot('p1', 'p1'), shoot('p1', 'p1'), shoot('p1', 'p1'));
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.turn.number, 1);
  assert.equal(act(state, shoot('p1', 'p1')).state.turn.playerId, 'p2');
});

test('turn: eliminated players are passed over', () => {
  let s = setup({ n: 4, chambers: 'BBBB' });
  s = edit(s, (d) => {
    d.players[1].alive = false;
    d.players[1].hp = 0;
  });
  const { state } = act(s, shoot('p1', 'p3'));
  assert.equal(state.turn.playerId, 'p3');
});

test('turn: only the turn player may shoot, and only at a living player', () => {
  const s0 = setup({ n: 4, chambers: 'BBBB' });
  fails(s0, shoot('p2', 'p1'), ERR.NOT_YOUR_TURN);
  fails(s0, shoot('p1', 'nobody'), ERR.INVALID_TARGET);
  fails(s0, shoot('p1', undefined), ERR.INVALID_TARGET);
  fails(s0, shoot('zzz', 'p1'), ERR.UNKNOWN_PLAYER);
  const dead = edit(s0, (d) => {
    d.players[3].alive = false;
    d.players[3].hp = 0;
  });
  fails(dead, shoot('p1', 'p4'), ERR.INVALID_TARGET);
  fails(dead, shoot('p4', 'p1'), ERR.PLAYER_ELIMINATED);
});

// --- Confirmation ------------------------------------------------------------

test('confirmation: choosing a target only aims; the shot needs a confirm step', () => {
  const s0 = setup({ chambers: 'LBB', confirm: true });
  const aimed = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(aimed.state.phase, { type: 'confirm', target: 'p2' });
  assert.equal(pubs(aimed.events, 'shot').length, 0);
  // The aim is the shooter's own business: nobody can react between aim and shot.
  assert.deepEqual(aimed.events, [
    { type: 'targetChosen', player: 'p1', target: 'p2', visibility: 'private', to: ['p1'] },
  ]);
  assert.deepEqual(viewFor(aimed.state, 'p1').self.pending, { type: 'confirm', target: 'p2' });
  for (const other of ['p2', 'p3', null]) {
    assert.deepEqual(viewFor(aimed.state, other), viewFor(s0, other), 'an aim changes nothing for the others');
  }
  assert.deepEqual(hpOf(aimed.state), { p1: 5, p2: 5, p3: 5 });
  const fired = act(aimed.state, { type: 'confirmShot', playerId: 'p1' });
  assert.equal(one(pubs(fired.events, 'shot')).target, 'p2');
  assert.equal(player(fired.state, 'p2').hp, 4);
});

test('confirmation: the aim can be cancelled or changed before confirming', () => {
  const s0 = setup({ chambers: 'LBB', confirm: true });
  const aimed = act(s0, shoot('p1', 'p2'));
  const cancelled = act(aimed.state, { type: 'cancelTarget', playerId: 'p1' });
  assert.deepEqual(cancelled.state.phase, { type: 'turn' });
  assert.deepEqual(one(cancelled.events).to, ['p1']);
  const reaimed = act(aimed.state, shoot('p1', 'p3'));
  assert.deepEqual(reaimed.state.phase, { type: 'confirm', target: 'p3' });
  const fired = act(reaimed.state, { type: 'confirmShot', playerId: 'p1' });
  assert.deepEqual(hpOf(fired.state), { p1: 5, p2: 5, p3: 4 });
});

test('confirmation: confirm/cancel are rejected without an aim or from another player', () => {
  const s0 = setup({ chambers: 'LBB', confirm: true });
  fails(s0, { type: 'confirmShot', playerId: 'p1' }, ERR.WRONG_PHASE);
  fails(s0, { type: 'cancelTarget', playerId: 'p1' }, ERR.WRONG_PHASE);
  const aimed = act(s0, shoot('p1', 'p2')).state;
  fails(aimed, { type: 'confirmShot', playerId: 'p2' }, ERR.NOT_YOUR_TURN);
  fails(aimed, { type: 'cancelTarget', playerId: 'p3' }, ERR.NOT_YOUR_TURN);
});

test('confirmation: is off by default (decision 55) and is not a host setting', () => {
  const { state } = createMatch({ mode: 'classic', randomizeSeats: false }, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], 1);
  for (const p of state.players) assert.equal(p.confirmShot, false);
  assert.equal('confirmShot' in state.config, false);
  // Without a preference, choosing a target fires at once.
  const fired = act(state, shoot(state.turn.playerId, state.players.find((p) => p.id !== state.turn.playerId).id));
  assert.equal(pubs(fired.events, 'shot').length, 1);
  // A player who asks for it (createMatch option or setPreference) still gets the step.
  const on = createMatch({ mode: 'classic' }, [{ id: 'p1', confirmShot: true }, { id: 'p2' }, { id: 'p3' }], 1).state;
  assert.deepEqual(on.players.map((p) => [p.id, p.confirmShot]).sort(), [['p1', true], ['p2', false], ['p3', false]]);
});

test('confirmation: a player can turn it off for themself; their shot is then immediate', () => {
  const s0 = setup({ chambers: 'LBB', confirm: true });
  const pref = act(s0, { type: 'setPreference', playerId: 'p1', confirmShot: false });
  assert.equal(pubs(pref.events).length, 0);
  assert.deepEqual(one(privs(pref.events, 'preferenceSet')).to, ['p1']);
  const fired = act(pref.state, shoot('p1', 'p2'));
  assert.equal(one(pubs(fired.events, 'shot')).target, 'p2');
  // The preference is per player: p2 still has to confirm.
  const p2 = act(fired.state, shoot('p2', 'p3'));
  assert.equal(p2.state.phase.type, 'confirm');
  fails(s0, { type: 'setPreference', playerId: 'p1', confirmShot: 'off' }, ERR.INVALID_ACTION);
});

test('confirmation: turn tools cannot be used while an aim is pending', () => {
  const s0 = setup({ chambers: 'LBB', confirm: true, hands: { p1: ['detector'] } });
  const aimed = act(s0, shoot('p1', 'p2')).state;
  fails(aimed, use('p1', 'detector'), ERR.WRONG_PHASE);
  const back = act(aimed, { type: 'cancelTarget', playerId: 'p1' }).state;
  act(back, use('p1', 'detector'));
});

// --- Time and leaving --------------------------------------------------------

test('timeout: the chamber is fired at the turn player automatically', () => {
  const s0 = setup({ chambers: 'LBB' });
  const { state, events } = act(s0, { type: 'timeout' });
  assert.equal(one(pubs(events, 'timedOut')).player, 'p1');
  const shot = one(pubs(events, 'shot'));
  assert.equal(shot.shooter, 'p1');
  assert.equal(shot.target, 'p1');
  assert.equal(shot.auto, true);
  assert.equal(player(state, 'p1').hp, 4);
  assert.equal(state.turn.playerId, 'p2');
});

test('timeout blank keeps the turn and restarts the clock (design change)', () => {
  const s0 = setup({ chambers: 'BLB' });
  const { state, events } = act(s0, { type: 'timeout' });
  const shot = one(pubs(events, 'shot'));
  assert.equal(shot.effect, 'blank');
  assert.equal(shot.auto, true);
  assert.equal(player(state, 'p1').hp, 5);
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.turn.number, s0.turn.number, 'the same turn goes on');
  assert.equal(pubs(events, 'turnStarted').length, 0);
  assert.equal(state.clock.seq, s0.clock.seq + 1, 'a fresh full shot timer');
  assert.deepEqual({ kind: state.clock.kind, playerId: state.clock.playerId }, { kind: 'shot', playerId: 'p1' });
  // The old timer id is now stale; the next timeout fires the next chamber.
  fails(state, { type: 'timeout', seq: s0.clock.seq }, ERR.STALE_TIMEOUT);
  const next = act(state, { type: 'timeout', seq: state.clock.seq });
  assert.equal(one(pubs(next.events, 'shot')).effect, 'live');
  assert.equal(next.state.turn.playerId, 'p2');
});

test('timeout live passes the turn', () => {
  const s0 = setup({ chambers: 'LBB' });
  const { state } = act(s0, { type: 'timeout' });
  assert.equal(player(state, 'p1').hp, 4);
  assert.equal(state.turn.playerId, 'p2');
  assert.equal(state.turn.number, s0.turn.number + 1);
});

test('timeout in a pending step: the step is abandoned and a blank still keeps the turn', () => {
  const s0 = setup({ chambers: 'BLB', confirm: true, hands: { p1: ['steal', 'probe'], p2: ['heal'] } });
  const aimed = act(s0, shoot('p1', 'p2')).state;
  const fromAim = act(aimed, { type: 'timeout' }).state;
  assert.deepEqual(fromAim.phase, { type: 'turn' });
  assert.equal(fromAim.turn.playerId, 'p1');
  assert.deepEqual(hpOf(fromAim), { p1: 5, p2: 5, p3: 5 });
  const peek = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  const fromSteal = act(peek, { type: 'timeout' }).state;
  assert.deepEqual(fromSteal.phase, { type: 'turn' });
  assert.equal(fromSteal.turn.playerId, 'p1');
  assert.deepEqual(player(fromSteal, 'p2').hand, ['heal']);
});

test('timeout: an aimed but unconfirmed shot still goes at the shooter', () => {
  const s0 = setup({ chambers: 'LBB', confirm: true });
  const aimed = act(s0, shoot('p1', 'p2')).state;
  const { state, events } = act(aimed, { type: 'timeout' });
  assert.equal(one(pubs(events, 'shot')).target, 'p1');
  assert.deepEqual(hpOf(state), { p1: 4, p2: 5, p3: 5 });
});

test('timer: every shot gets its full time; the clock restarts after each blank on self', () => {
  const s0 = setup({ chambers: 'BBLB', hands: { p1: ['detector'] } });
  assert.deepEqual({ kind: s0.clock.kind, playerId: s0.clock.playerId }, { kind: 'shot', playerId: 'p1' });
  const tool = act(s0, use('p1', 'detector')).state;
  assert.equal(tool.clock.seq, s0.clock.seq, 'using a tool does not restart the timer');
  const blank1 = act(tool, shoot('p1', 'p1')).state;
  assert.equal(blank1.clock.seq, s0.clock.seq + 1);
  assert.equal(blank1.clock.playerId, 'p1');
  const blank2 = act(blank1, shoot('p1', 'p1')).state;
  assert.equal(blank2.clock.seq, s0.clock.seq + 2);
  const live = act(blank2, shoot('p1', 'p1')).state;
  assert.equal(live.clock.seq, s0.clock.seq + 3);
  assert.equal(live.clock.playerId, 'p2');
  assert.deepEqual(viewFor(live, 'p3').clock, live.clock);
});

test('timeout: a timeout carrying an old timer id is rejected; the current id is accepted', () => {
  const s0 = setup({ chambers: 'BBLB' });
  const next = act(s0, shoot('p1', 'p1')).state;
  fails(next, { type: 'timeout', seq: s0.clock.seq }, ERR.STALE_TIMEOUT);
  act(next, { type: 'timeout', seq: next.clock.seq });
});

test('leaving: an absent player stays in the order and times out every turn until dead', () => {
  // p2 never acts. The others always fire a blank at someone else, so only
  // p2's automatic self shots can hurt anybody.
  let state = setup({ n: 3, config: { hp: 2, enabledTools: [] }, chambers: 'BLBBLB' });
  let guard = 0;
  while (player(state, 'p2').alive) {
    assert.ok(guard++ < 500);
    const current = state.turn.playerId;
    if (current === 'p2') {
      state = act(state, { type: 'timeout' }).state;
    } else {
      // Make the current chamber blank so the present players stay unharmed.
      state = edit(state, (d) => {
        d.round.chambers[d.round.cursor] = { type: 'blank', flipped: false };
        const live = d.round.chambers.filter((c) => c.type === 'live').length;
        d.round.announced = { total: d.round.chambers.length, live, blank: d.round.chambers.length - live };
      });
      state = act(state, shoot(current, current === 'p1' ? 'p3' : 'p1')).state;
    }
  }
  assert.equal(player(state, 'p2').hp, 0);
  assert.equal(player(state, 'p1').hp, 2);
  assert.equal(player(state, 'p3').hp, 2);
});

test('timeout: only timeouts still finish the match (nobody present at all)', () => {
  let state = setup({ n: 5, chambers: 'LBLB' });
  let guard = 0;
  while (state.status === 'active') {
    assert.ok(guard++ < 2000);
    const res = applyAction(state, { type: 'timeout' });
    assert.equal(res.ok, true);
    state = res.state;
  }
  assert.equal(state.result.type, 'win');
});
