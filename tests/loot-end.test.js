// Elimination, loot (decision 63: a private standing offer) and ownership, and the end of the match
// (document: "Elimination and loot", "End of the match").

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, LOOT_SECONDS, eventsFor, viewFor, listLegalActions } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, edit } from './helpers.js';

const loot = (playerId, victim, choice) => ({ type: 'lootChoice', playerId, victim, choice });
const takeTool = (playerId, victim, tool) => loot(playerId, victim, { kind: 'tool', tool });
// What the looter's device sends when the loot time is up (decision 63).
const expire = (playerId, victim) => ({ ...loot(playerId, victim, { kind: 'none' }), expired: true });

function prepared(state, { shields = {}, links = [] } = {}) {
  return edit(state, (d) => {
    for (const id of Object.keys(shields)) d.players.find((p) => p.id === id).shields.shot.push(0);
    for (const link of links) d.links.push(link.slice());
  });
}

// --- Elimination -----------------------------------------------------------------

test('elimination: a player whose life points run out leaves the match and becomes a spectator', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').alive, false);
  assert.deepEqual(one(pubs(events, 'eliminated')), { type: 'eliminated', player: 'p2', by: 'p1', round: 1, visibility: 'public' });
  assert.equal(viewFor(state, 'p2').role, 'eliminated');
  assert.equal(viewFor(state, 'p2').self, null);
  assert.deepEqual(listLegalActions(state, 'p2'), []);
  fails(state, shoot('p2', 'p1'), ERR.PLAYER_ELIMINATED);
});

test('elimination: the spectator sees only what everyone sees - no chambers, hands or shields', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p1: ['flip'], p3: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[2].shields.shot.push(0);
  });
  const dead = play(s0, shoot('p1', 'p2'), loot('p1', 'p2', { kind: 'none' })).state;
  const ghostView = viewFor(dead, 'p2');
  const outsider = viewFor(dead, null);
  assert.deepEqual({ ...ghostView, viewer: null, role: 'spectator' }, outsider);
});

// --- Loot (decision 63: a private standing offer, never a phase) -----------------

const loots = (state, id) => player(state, id).loots;
const lootView = (state, id) => viewFor(state, id).self.loots;

test('loot: the shooter takes one tool from the player they eliminated; the rest leaves the game', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p1: ['probe'], p2: ['heal', 'jail', 'link'] } });
  const shot = act(s0, shoot('p1', 'p2'));
  assert.equal(shot.state.phase.type, 'turn');
  assert.equal(shot.state.turn.playerId, 'p3', 'the turn passes at once (dead p2 is skipped)');
  assert.deepEqual(shot.state.clock, { seq: s0.clock.seq + 1, kind: 'shot', playerId: 'p3', pauseMs: 0 });
  assert.deepEqual(loots(shot.state, 'p1'), [{ victim: 'p2', clockSeq: shot.state.clock.seq }]);
  assert.deepEqual(lootView(shot.state, 'p1'), [{ victim: 'p2', tools: ['heal', 'jail', 'link'], coinsOption: false, clockSeq: shot.state.clock.seq }]);
  const offer = one(privs(shot.events, 'lootOffer'));
  assert.deepEqual(offer, { type: 'lootOffer', looter: 'p1', victim: 'p2', tools: ['heal', 'jail', 'link'], coinsOption: false, clockSeq: shot.state.clock.seq, visibility: 'private', to: ['p1'] });
  const { state, events } = act(shot.state, takeTool('p1', 'p2', 'jail'));
  assert.deepEqual(player(state, 'p1').hand, ['probe', 'jail']);
  assert.deepEqual(player(state, 'p2').hand, [], 'the other tools are gone');
  assert.deepEqual(loots(state, 'p1'), []);
  assert.deepEqual(lootView(state, 'p1'), []);
  assert.deepEqual(one(privs(events, 'lootResult')), { type: 'lootResult', looter: 'p1', victim: 'p2', taken: 'tool', tool: 'jail', forfeited: false, reason: 'chosen', visibility: 'private', to: ['p1'] });
  assert.equal(state.turn.playerId, 'p3', 'choosing does not touch the turn');
  assert.deepEqual(state.clock, shot.state.clock, 'nor the shot clock');
});

test('loot: the fixed loot time is 15 seconds (a constant, not a setting)', () => {
  assert.equal(LOOT_SECONDS, 15);
});

test('loot: it is secret - no public event, nothing in anybody else\'s view', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail', 'link'] } });
  const shot = act(s0, shoot('p1', 'p2'));
  const done = act(shot.state, takeTool('p1', 'p2', 'link'));
  assert.deepEqual(pubs(shot.events).map((e) => e.type), ['shot', 'eliminated', 'turnStarted']);
  assert.deepEqual(pubs(done.events), [], 'choosing produces no public event');
  const publicJson = JSON.stringify(pubs([...shot.events, ...done.events]));
  for (const secret of ['heal', 'jail', 'link', 'loot']) assert.ok(!publicJson.toLowerCase().includes(secret));
  assert.deepEqual(one(privs(shot.events, 'lootOffer')).to, ['p1']);
  assert.deepEqual(one(privs(done.events, 'lootResult')).to, ['p1']);
  for (const other of ['p2', 'p3', 'p4', null]) {
    const view = viewFor(shot.state, other);
    assert.deepEqual(view.phase, { type: 'turn' });
    if (view.self) assert.deepEqual(view.self.loots, []);
    assert.ok(!JSON.stringify(view).includes('"loots":[{'));
  }
});

// What a third player can know: their view, their events and their legal actions.
function thirdParty(state, events, id) {
  return JSON.stringify({ view: viewFor(state, id), events: eventsFor(events, id), legal: listLegalActions(state, id) });
}

test('loot secrecy: a third player cannot tell whether a loot is open, what it holds, or how it ended', () => {
  const base = { n: 4, chambers: 'LBBB', hp: { p2: 1 } };
  const rich = setup({ ...base, hands: { p2: ['heal', 'jail', 'link'] } });
  const poor = setup({ ...base, hands: {} });
  const a = act(rich, shoot('p1', 'p2'));
  const b = act(poor, shoot('p1', 'p2'));
  // The same kill, whatever the victim held.
  for (const id of ['p3', 'p4', 'p2', null]) assert.equal(thirdParty(a.state, a.events, id), thirdParty(b.state, b.events, id));

  // With the loot open, or with no loot at all (as if never opened), the same.
  const noLoot = edit(a.state, (d) => {
    d.players[0].loots = [];
    d.players[1].hand = [];
  });
  for (const id of ['p3', 'p4', 'p2', null]) assert.equal(thirdParty(a.state, [], id), thirdParty(noLoot, [], id));

  // Choosing, taking nothing, or letting it expire: nothing for a third player.
  for (const action of [takeTool('p1', 'p2', 'heal'), loot('p1', 'p2', { kind: 'none' }), expire('p1', 'p2')]) {
    const res = act(a.state, action);
    for (const id of ['p3', 'p4', 'p2', null]) {
      assert.deepEqual(eventsFor(res.events, id), []);
      assert.equal(thirdParty(res.state, [], id), thirdParty(a.state, [], id));
    }
  }

  // The looter's own death or removal and the end of the match close it silently too.
  const removed = act(a.state, { type: 'removePlayer', target: 'p1' });
  assert.deepEqual(pubs(removed.events).map((e) => e.type), ['playerRemoved']);
  assert.ok(!JSON.stringify(pubs(removed.events)).includes('loot'));
});

test('loot: an empty-handed victim still opens a loot ("Eli boştu"), so hand sizes are not revealed', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 } });
  const shot = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(lootView(shot.state, 'p1')[0].tools, []);
  assert.deepEqual(one(privs(shot.events, 'lootOffer')).tools, []);
  const { state } = act(shot.state, loot('p1', 'p2', { kind: 'none' }));
  assert.deepEqual(loots(state, 'p1'), []);
});

test('loot: only the looter may choose, only an open loot, only among the victim\'s tools, only one', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  fails(pending, takeTool('p3', 'p2', 'heal'), ERR.NO_LOOT);
  fails(pending, takeTool('p1', 'p4', 'heal'), ERR.NO_LOOT);
  fails(pending, { type: 'lootChoice', playerId: 'p1', choice: { kind: 'none' } }, ERR.NO_LOOT);
  fails(pending, takeTool('p1', 'p2', 'link'), ERR.INVALID_CHOICE);
  fails(pending, loot('p1', 'p2', { kind: 'coins' }), ERR.INVALID_CHOICE);
  fails(pending, loot('p1', 'p2', { kind: 'everything' }), ERR.INVALID_CHOICE);
  fails(pending, loot('p1', 'p2'), ERR.INVALID_ACTION);
  fails(pending, takeTool('p2', 'p2', 'heal'), ERR.PLAYER_ELIMINATED);
  fails(s0, takeTool('p1', 'p2', 'heal'), ERR.NO_LOOT);
  const done = act(pending, takeTool('p1', 'p2', 'heal')).state;
  // A late choice after the loot was closed is rejected cleanly.
  fails(done, takeTool('p1', 'p2', 'jail'), ERR.NO_LOOT);
  fails(done, expire('p1', 'p2'), ERR.NO_LOOT);
});

test('loot: it never blocks - the next player plays while the loot is open', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal'], p3: ['detector'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  const legal = listLegalActions(pending, 'p3');
  assert.ok(legal.some((a) => a.type === 'chooseTarget'));
  const after = play(pending, use('p3', 'detector'), shoot('p3', 'p4')).state;
  assert.equal(after.turn.playerId, 'p4');
  assert.deepEqual(loots(after, 'p1'), [{ victim: 'p2', clockSeq: pending.clock.seq }], 'the loot stays open, unchanged');
  const { state } = act(after, takeTool('p1', 'p2', 'heal'));
  assert.deepEqual(player(state, 'p1').hand, ['heal']);
});

test('loot: the looter plays their own turn normally and can still choose afterwards', () => {
  const s0 = setup({ n: 3, chambers: 'LBBBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  // p1 kills p2; with p2 gone the turn goes to p3, who passes it back to p1 with a blank on p1.
  const mine = play(s0, shoot('p1', 'p2'), shoot('p3', 'p1')).state;
  assert.equal(mine.turn.playerId, 'p1');
  const legal = listLegalActions(mine, 'p1');
  assert.ok(legal.some((a) => a.type === 'chooseTarget'));
  assert.ok(legal.some((a) => a.type === 'lootChoice' && a.victim === 'p2' && a.choice.kind === 'tool' && a.choice.tool === 'jail'));
  // A blank on self keeps the turn; then the loot is chosen during the turn.
  const { state } = play(mine, shoot('p1', 'p1'), takeTool('p1', 'p2', 'jail'));
  assert.equal(state.turn.playerId, 'p1');
  assert.deepEqual(player(state, 'p1').hand, ['jail']);
});

test('loot expiry: the looter\'s device sends it; nothing is taken and the tools leave the game', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  const { state, events } = act(pending, expire('p1', 'p2'));
  assert.deepEqual(player(state, 'p1').hand, []);
  assert.deepEqual(player(state, 'p2').hand, []);
  assert.deepEqual(one(privs(events, 'lootResult')), { type: 'lootResult', looter: 'p1', victim: 'p2', taken: 'none', forfeited: true, reason: 'expired', visibility: 'private', to: ['p1'] });
  assert.deepEqual(pubs(events), [], 'an expiry fires nothing and tells nobody');
  assert.equal(state.turn.playerId, 'p3');
  // The shot clock never runs for a loot.
  const timeout = act(pending, { type: 'timeout' });
  assert.equal(one(pubs(timeout.events, 'timedOut')).kind, 'shot');
  assert.deepEqual(loots(timeout.state, 'p1'), [{ victim: 'p2', clockSeq: pending.clock.seq }]);
});

test('loot: the looter dies before choosing - the loot is lost, the victim\'s tools leave the game', () => {
  const s0 = setup({ n: 4, chambers: 'LLBB', hp: { p1: 1, p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  const { state, events } = act(pending, shoot('p3', 'p1'));
  assert.equal(player(state, 'p1').alive, false);
  assert.deepEqual(loots(state, 'p1'), []);
  assert.deepEqual(player(state, 'p2').hand, []);
  const result = one(privs(events, 'lootResult'));
  assert.deepEqual({ taken: result.taken, forfeited: result.forfeited, reason: result.reason, to: result.to }, { taken: 'none', forfeited: true, reason: 'looterOut', to: ['p1'] });
  assert.ok(!JSON.stringify(pubs(events)).includes('loot'));
  // p3 now loots p1 (p1's own hand), a separate loot.
  assert.deepEqual(loots(state, 'p3'), [{ victim: 'p1', clockSeq: state.clock.seq }]);
  fails(state, takeTool('p1', 'p2', 'heal'), ERR.PLAYER_ELIMINATED);
});

test('loot: the looter removed from the match loses their open loots', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  const { state, events } = act(pending, { type: 'removePlayer', target: 'p1' });
  assert.deepEqual(loots(state, 'p1'), []);
  assert.deepEqual(player(state, 'p2').hand, []);
  assert.equal(one(privs(events, 'lootResult')).reason, 'looterOut');
  assert.equal(state.turn.playerId, 'p3', 'the turn is untouched (it was p3\'s)');
});

test('loot: the end of the match closes every open loot', () => {
  const s0 = setup({ n: 3, chambers: 'LLBB', hp: { p2: 1, p3: 1 }, hands: { p2: ['heal'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  assert.equal(pending.turn.playerId, 'p3');
  // p3 kills p1: one player left, the match ends; p1's open loot closes.
  const shot = edit(pending, (d) => { d.players[0].hp = 1; });
  const { state, events } = act(shot, shoot('p3', 'p1'));
  assert.equal(state.status, 'ended');
  for (const p of state.players) assert.deepEqual(p.loots, []);
  const reasons = privs(events, 'lootResult').map((e) => e.reason);
  assert.deepEqual(reasons, ['looterOut']);
  // Closing by the match end itself: a loot of the winner.
  const s1 = setup({ n: 3, chambers: 'LLBB', hp: { p2: 1, p3: 1 }, hands: { p2: ['heal'] } });
  const open = act(s1, shoot('p1', 'p2')).state;
  const end = act(open, { type: 'removePlayer', target: 'p3' });
  assert.equal(end.state.status, 'ended');
  assert.deepEqual(loots(end.state, 'p1'), []);
  assert.equal(one(privs(end.events, 'lootResult')).reason, 'matchEnded');
  assert.deepEqual(player(end.state, 'p2').hand, []);
  fails(end.state, takeTool('p1', 'p2', 'heal'), ERR.MATCH_ENDED);
});

test('loot: several loots can be open at once, for one looter and for several looters', () => {
  const s0 = setup({ n: 5, chambers: 'LLBBB', hp: { p2: 1, p4: 1 }, hands: { p2: ['heal'], p4: ['jail'] }, turn: 'p1' });
  const first = act(s0, shoot('p1', 'p2')).state; // p1 loots p2; turn -> p3
  const second = act(first, shoot('p3', 'p4')).state; // p3 loots p4
  assert.deepEqual(loots(second, 'p1').map((l) => l.victim), ['p2']);
  assert.deepEqual(loots(second, 'p3').map((l) => l.victim), ['p4']);
  assert.deepEqual(lootView(second, 'p3'), [{ victim: 'p4', tools: ['jail'], coinsOption: false, clockSeq: second.clock.seq }]);
  assert.deepEqual(lootView(second, 'p1')[0].tools, ['heal'], 'each sees only their own');
  const { state } = play(second, takeTool('p3', 'p4', 'jail'), takeTool('p1', 'p2', 'heal'));
  assert.deepEqual(player(state, 'p3').hand, ['jail']);
  assert.deepEqual(player(state, 'p1').hand, ['heal']);
});

test('loot ownership: a death through a link belongs to the shooter, not to whoever made the link', () => {
  // p3 made the link (p2-p4); p1 fires at p2 and p4 dies through the link.
  const s0 = setup({ n: 5, chambers: 'LBBBB', hp: { p4: 1 }, hands: { p3: ['link'], p4: ['heal'] }, turn: 'p3' });
  const linked = play(s0, use('p3', 'link', { targets: ['p2', 'p4'] }), shoot('p3', 'p3')).state; // live on self, turn passes
  const s1 = edit(linked, (d) => {
    d.round.chambers[d.round.cursor] = { type: 'live', flipped: false };
    d.round.announced = { total: 5, live: 2, blank: 3 };
    d.turn.playerId = 'p1';
    d.clock.playerId = 'p1';
  });
  const { state, events } = act(s1, shoot('p1', 'p2'));
  assert.equal(one(pubs(events, 'eliminated')).by, 'p1');
  assert.deepEqual(loots(state, 'p1').map((l) => l.victim), ['p4']);
  assert.deepEqual(loots(state, 'p3'), []);
});

test('loot ownership: firing at yourself and killing your linked partner - you loot if you survive', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p3: 1 }, hands: { p3: ['heal'] } }), {
    links: [['p1', 'p3']],
  });
  const shot = act(s0, shoot('p1', 'p1'));
  assert.equal(player(shot.state, 'p1').hp, 4);
  assert.deepEqual(one(pubs(shot.events, 'eliminated')), { type: 'eliminated', player: 'p3', by: 'p1', round: 1, visibility: 'public' });
  assert.deepEqual(loots(shot.state, 'p1').map((l) => l.victim), ['p3']);
  assert.equal(shot.state.turn.playerId, 'p2');
  const { state } = act(shot.state, takeTool('p1', 'p3', 'heal'));
  assert.deepEqual(player(state, 'p1').hand, ['heal']);
});

test('loot ownership: firing at yourself and dying together with your partner - nobody loots', () => {
  const s0 = prepared(
    setup({ n: 4, chambers: 'LBBB', hp: { p1: 1, p3: 1 }, hands: { p1: ['probe'], p3: ['heal'] } }),
    { links: [['p1', 'p3']] },
  );
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(
    pubs(events, 'eliminated').map((e) => [e.player, e.by]),
    [
      ['p1', null],
      ['p3', 'p1'],
    ],
  );
  for (const p of state.players) assert.deepEqual(p.loots, []);
  assert.equal(privs(events, 'lootOffer').length, 0);
  assert.deepEqual(player(state, 'p1').hand, []);
  assert.deepEqual(player(state, 'p3').hand, []);
  assert.equal(state.turn.playerId, 'p2');
});

test('loot ownership: a reflected shot counts for the shield owner, who loots the shooter it killed', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 }, hands: { p1: ['jail', 'heal'] } }), {
    shields: { p3: true },
  });
  const shot = act(s0, shoot('p1', 'p3'));
  assert.deepEqual(one(pubs(shot.events, 'eliminated')), { type: 'eliminated', player: 'p1', by: 'p3', round: 1, visibility: 'public' });
  assert.deepEqual(loots(shot.state, 'p3').map((l) => l.victim), ['p1']);
  assert.equal(shot.state.turn.playerId, 'p2', 'the turn passes from the dead shooter\'s seat');
  assert.deepEqual(lootView(shot.state, 'p3')[0].tools, ['jail', 'heal']);
  const { state } = act(shot.state, takeTool('p3', 'p1', 'jail'));
  assert.deepEqual(player(state, 'p3').hand, ['jail']);
});

test('loot ownership: a reflected shot that also kills the shooter\'s linked partner credits the shield owner for both', () => {
  const s0 = prepared(setup({ n: 5, chambers: 'LBBBB', hp: { p1: 1, p4: 1 }, hands: { p1: ['jail'], p4: ['heal'] } }), {
    shields: { p3: true },
    links: [['p1', 'p4']],
  });
  const shot = act(s0, shoot('p1', 'p3'));
  assert.deepEqual(loots(shot.state, 'p3').map((l) => l.victim), ['p1', 'p4']);
  const { state } = play(shot.state, takeTool('p3', 'p4', 'heal'), takeTool('p3', 'p1', 'jail'));
  assert.deepEqual(player(state, 'p3').hand, ['heal', 'jail'], 'in any order');
});

test('loot ownership: a player who eliminates themself with their own shot - all their tools leave the game', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 }, hands: { p1: ['heal', 'jail'] } });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(one(pubs(events, 'eliminated')), { type: 'eliminated', player: 'p1', by: null, round: 1, visibility: 'public' });
  assert.deepEqual(player(state, 'p1').hand, []);
  for (const p of state.players) assert.deepEqual(p.loots, []);
  assert.equal(privs(events, 'lootOffer').length, 0);
});

test('loot: one loot for EACH player killed by the shot (double + link kills two), each with its own choice', () => {
  const s0 = prepared(
    setup({
      n: 5,
      chambers: 'LBBBB',
      hp: { p2: 2, p3: 1 },
      hands: { p1: ['double'], p2: ['heal', 'probe'], p3: ['jail'] },
    }),
    { links: [['p2', 'p3']] },
  );
  const shot = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.equal(pubs(shot.events, 'eliminated').length, 2);
  assert.deepEqual(lootView(shot.state, 'p1').map((l) => [l.victim, l.tools]), [['p2', ['heal', 'probe']], ['p3', ['jail']]]);
  assert.equal(privs(shot.events, 'lootOffer').length, 2);
  assert.equal(shot.state.turn.playerId, 'p4');
  const first = act(shot.state, takeTool('p1', 'p3', 'jail'));
  assert.deepEqual(lootView(first.state, 'p1').map((l) => l.victim), ['p2'], 'the other row stays open');
  const { state } = act(first.state, expire('p1', 'p2'));
  assert.deepEqual(player(state, 'p1').hand, ['jail']);
  assert.deepEqual(player(state, 'p2').hand, []);
});

test('loot: a timeout shot can loot too (shooter survives, linked partner dies)', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p3: 1 }, hands: { p3: ['heal'] } }), {
    links: [['p1', 'p3']],
  });
  const { state } = act(s0, { type: 'timeout' });
  assert.deepEqual(loots(state, 'p1').map((l) => l.victim), ['p3']);
});

test('loot: when the kill uses the last chamber, the reload happens first and the loot follows', () => {
  const s0 = setup({ n: 4, chambers: 'L', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.round.index, 2);
  assert.deepEqual(one(pubs(events, 'roundEnded')).survivors, ['p1', 'p3', 'p4']);
  assert.deepEqual(lootView(state, 'p1')[0].tools, ['heal'], 'the dead get no tools from the reload');
  const after = act(state, takeTool('p1', 'p2', 'heal')).state;
  assert.equal(after.turn.playerId, 'p3');
  assert.equal(player(after, 'p2').hand.length, 0);
});

test('elimination: links, jail and offers of the dead are cleared', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.links.push(['p2', 'p3']);
    d.players[1].jailed = true;
    d.players[1].ransomOffer = { to: 'p3', kind: 'tool', tool: 'heal' };
  });
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(state.links, []);
  assert.equal(player(state, 'p2').jailed, false);
  assert.equal(player(state, 'p2').ransomOffer, null);
  assert.equal(player(state, 'p3').hp, 4, 'the link still carried this last shot');
});

// --- End of the match --------------------------------------------------------------

test('match end: the last player alive wins', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.status, 'ended');
  assert.deepEqual(state.result, { type: 'win', winner: 'p1' });
  assert.deepEqual(one(pubs(events, 'matchEnded')), {
    type: 'matchEnded',
    result: 'win',
    winner: 'p1',
    startingPlayers: 3,
    visibility: 'public',
  });
  assert.equal(pubs(events, 'lootStarted').length, 0, 'no loot once the match is over');
  assert.deepEqual(viewFor(state, 'p2').result, { type: 'win', winner: 'p1' });
});

test('match end: one shot eliminating the last living players together is a draw with no winner', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p1: 1, p2: 1 } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
    d.links.push(['p1', 'p2']);
  });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.equal(state.status, 'ended');
  assert.deepEqual(state.result, { type: 'draw', winner: null });
  assert.equal(one(pubs(events, 'matchEnded')).result, 'draw');
  assert.equal(pubs(events, 'eliminated').length, 2);
});

test('match end: a draw also happens when the shooter kills their linked partner and dies through the link', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p1: 1, p2: 1 }, hands: { p1: ['double'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
    d.links.push(['p1', 'p2']);
  });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.deepEqual(state.result, { type: 'draw', winner: null });
});

test('match end: nothing can be done after the match is over', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p2: 1 }, hands: { p1: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state } = act(s0, shoot('p1', 'p2'));
  fails(state, shoot('p1', 'p1'), ERR.MATCH_ENDED);
  fails(state, use('p1', 'heal'), ERR.MATCH_ENDED);
  fails(state, { type: 'timeout' }, ERR.MATCH_ENDED);
  assert.deepEqual(listLegalActions(state, 'p1'), []);
});

test('match end: the winner can be decided by a timeout shot', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p1: 1 } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state } = act(s0, { type: 'timeout' });
  assert.deepEqual(state.result, { type: 'win', winner: 'p2' });
});
