// Visibility: viewFor and event tagging must never leak a secret.
// Covered secrets: chamber order, hands, hand sizes, active shields, private
// info, coin balances, purchases, transfers, loot choices (plus steal results,
// predictions, ransom offers, the tools-used counter, and the PRNG).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyAction, viewFor, eventsFor, publicEvents, listLegalActions } from '../src/engine/index.js';
import { ids, setup, act, play, shoot, use, pubs, privs, edit, deepFreeze } from './helpers.js';
import { checkEvents, checkNoLeakForAll, scrambleSecrets, PUBLIC_EVENT_FIELDS } from './invariants.js';

const same = (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);
const viewers = (state) => [null, ...state.players.map((p) => p.id)];

// The view of everyone except `except` must be identical in both states.
function sameForOthers(a, b, except = []) {
  for (const v of viewers(a)) {
    if (except.includes(v)) continue;
    same(viewFor(a, v), viewFor(b, v), `view of ${v} differs`);
  }
}

test('visibility: no view ever contains the chamber order, the cursor, or the PRNG state', () => {
  for (const mode of ['classic', 'custom']) {
    const { state } = createMatch({ mode }, ids(6).map((id) => ({ id })), 99);
    for (const v of viewers(state)) {
      const json = JSON.stringify(viewFor(state, v));
      for (const key of ['"rng"', '"chambers"', '"cursor"', '"flipped"']) assert.ok(!json.includes(key), `${key} in view of ${v}`);
    }
  }
});

test('visibility: the chamber order does not leak to anyone', () => {
  const a = setup({ n: 4, chambers: 'LBLB' });
  const b = edit(a, (d) => {
    d.round.chambers.reverse();
    d.round.chambers[0].flipped = true;
  });
  sameForOthers(a, b);
});

test('visibility: the remaining live/blank counts are not shown - only what was announced at the reload', () => {
  const s0 = setup({ n: 4, chambers: 'LLBB', hands: { p1: ['skip'] } });
  const later = play(s0, use('p1', 'skip'), shoot('p1', 'p2')).state;
  const round = viewFor(later, 'p3').round;
  assert.deepEqual(round, { index: 1, announced: { total: 4, live: 2, blank: 2 }, shots: 1 });
});

test('visibility: other players\' hands and hand sizes do not leak', () => {
  const a = setup({ n: 4, chambers: 'LBLB', hands: { p2: ['heal'] } });
  const b = edit(a, (d) => {
    d.players[1].hand = ['jail', 'link', 'double', 'steal', 'handSwap'];
  });
  sameForOthers(a, b, ['p2']);
  assert.deepEqual(viewFor(b, 'p2').self.hand, ['jail', 'link', 'double', 'steal', 'handSwap']);
});

test('visibility: active shields do not leak', () => {
  const a = setup({ n: 4, chambers: 'LBLB' });
  const b = edit(a, (d) => {
    d.players[1].shields.shot.push(0, 0);
    d.players[1].shields.tool.push(0);
  });
  sameForOthers(a, b, ['p2']);
  assert.deepEqual(viewFor(b, 'p2').self.shields, { shot: [{ active: true }, { active: true }], tool: [{ active: true }] });
});

test('visibility: private info does not leak (custom)', () => {
  const a = createMatch({ mode: 'custom' }, ids(5).map((id) => ({ id })), 31).state;
  const b = edit(a, (d) => {
    d.players[0].privateInfo = { round: 1, chamberIndex: 0, type: 'live', stale: true };
  });
  sameForOthers(a, b, [a.players[0].id]);
});

test('visibility: coin balances do not leak (custom)', () => {
  const a = setup({ mode: 'custom', n: 4, chambers: 'LBLB' });
  const b = edit(a, (d) => {
    d.players[2].coins = 77;
  });
  sameForOthers(a, b, ['p3']);
  assert.equal(viewFor(b, 'p3').self.coins, 77);
});

test('visibility: purchases do not leak - open stock leaves no trace at all', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB', config: { custom: { limitedStock: false } } });
  const { state, events } = act(s0, { type: 'buy', playerId: 'p2', tool: 'probe' });
  assert.deepEqual(pubs(events), []);
  for (const e of events) assert.deepEqual(e.to, ['p2']);
  sameForOthers(s0, state, ['p2']);
});

test('visibility: purchases do not leak - limited stock shows the remaining count, never the buyer', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB' });
  const byP2 = act(s0, { type: 'buy', playerId: 'p2', tool: 'probe' });
  const byP3 = act(s0, { type: 'buy', playerId: 'p3', tool: 'probe' });
  same(pubs(byP2.events), pubs(byP3.events), 'the public trace is the same whoever buys');
  sameForOthers(byP2.state, byP3.state, ['p2', 'p3']);
  assert.equal(viewFor(byP2.state, 'p1').shop.stock.probe, s0.shop.stock.probe - 1);
});

test('visibility: transfers do not leak', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB' });
  const { state, events } = act(s0, { type: 'transfer', playerId: 'p2', to: 'p3', amount: 4 });
  assert.deepEqual(pubs(events), []);
  assert.deepEqual(eventsFor(events, 'p1'), []);
  assert.deepEqual(eventsFor(events, 'p4'), []);
  assert.equal(eventsFor(events, 'p2').length, 1);
  assert.equal(eventsFor(events, 'p3').length, 1);
  sameForOthers(s0, state, ['p2', 'p3']);
});

test('visibility: loot choices do not leak - every choice looks the same from outside', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB', hp: { p2: 1 }, coins: { p2: 9 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2'));
  const outcomes = [
    { kind: 'tool', tool: 'heal' },
    { kind: 'tool', tool: 'jail' },
    { kind: 'coins' },
    { kind: 'none' },
  ].map((choice) => act(pending.state, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice }));
  // Decision 63: the expiry (sent by the looter's device) looks the same too.
  outcomes.push(act(pending.state, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'none' }, expired: true }));
  for (const o of outcomes) {
    same(pubs(o.events), pubs(outcomes[0].events), 'identical public events');
    sameForOthers(o.state, outcomes[0].state, ['p1']);
    assert.deepEqual(eventsFor(o.events, 'p2'), pubs(o.events), 'the victim learns nothing more than the public');
  }
  for (const o of outcomes) assert.deepEqual(pubs(o.events), [], 'no public event at all');
  // The victim's tools were shown to the looter alone.
  const offer = privs(pending.events, 'lootOffer');
  assert.equal(offer.length, 1);
  assert.deepEqual(offer[0].to, ['p1']);
  assert.ok(!JSON.stringify(pubs(pending.events)).includes('heal'));
});

test('visibility: a steal exchange and a steal that takes nothing look the same to third parties', () => {
  const s0 = setup({ n: 4, chambers: 'LBLB', hands: { p1: ['steal', 'probe'], p2: ['heal'] } });
  const peek = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  const taken = act(peek, { type: 'stealChoice', playerId: 'p1', take: 'heal', give: 'probe' });
  const declined = act(peek, { type: 'stealChoice', playerId: 'p1', take: null, give: null });
  same(pubs(taken.events), pubs(declined.events));
  sameForOthers(taken.state, declined.state, ['p1', 'p2']);
});

test('visibility: the tools-used counter and a pending hand swap are private to the turn player', () => {
  const s0 = setup({ n: 4, chambers: 'LBLB', hands: { p1: ['detector', 'handSwap'] } });
  const used = act(s0, use('p1', 'detector')).state;
  sameForOthers(s0, used, ['p1']);
  assert.equal(viewFor(used, 'p1').self.toolsUsedThisTurn, 1);
  assert.equal(viewFor(used, 'p2').self.toolsUsedThisTurn, null);
  const swapping = act(used, use('p1', 'handSwap')).state;
  sameForOthers(s0, swapping, ['p1']);
});

test('visibility: ransom offers are seen by the two parties only', () => {
  let s0 = setup({ n: 4, chambers: 'LBLB', hands: { p2: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[1].jailed = true;
  });
  const { state, events } = act(s0, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } });
  assert.deepEqual(pubs(events), []);
  sameForOthers(s0, state, ['p2', 'p3']);
  assert.equal(viewFor(state, 'p3').self.incomingRansomOffers.length, 1);
  assert.deepEqual(viewFor(state, 'p2').self.ransomOffer, { to: 'p3', kind: 'tool', tool: 'heal' });
});

test('visibility: ghost predictions are private until judged', () => {
  let s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB' });
  s0 = edit(s0, (d) => {
    Object.assign(d.players[3], { alive: false, hp: 0, coins: 0, privateInfo: null });
  });
  const { state, events } = act(s0, { type: 'predict', playerId: 'p4', prediction: 'live' });
  assert.deepEqual(pubs(events), []);
  sameForOthers(s0, state, ['p4']);
});

test('visibility: the confirmation preference is private', () => {
  const s0 = setup({ n: 4, chambers: 'LBLB' });
  const { state, events } = act(s0, { type: 'setPreference', playerId: 'p2', confirmShot: true });
  assert.deepEqual(pubs(events), []);
  sameForOthers(s0, state, ['p2']);
});

test('visibility: a living player sees their own secrets', () => {
  let s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB', hands: { p2: ['heal', 'jail'] }, coins: { p2: 4 } });
  s0 = edit(s0, (d) => {
    d.players[1].shields.shot.push(5);
    d.players[1].privateInfo = { round: 1, chamberIndex: 2, type: 'live', stale: false };
  });
  const self = viewFor(s0, 'p2').self;
  assert.deepEqual(self.hand, ['heal', 'jail']);
  assert.equal(self.coins, 4);
  assert.deepEqual(self.shields, { shot: [{ active: false }], tool: [] });
  assert.deepEqual(self.privateInfo, { round: 1, chamberIndex: 2, type: 'live', stale: false });
  assert.equal(viewFor(s0, 'p2').role, 'alive');
});

test('visibility: an outside spectator and eliminated players get public information only', () => {
  let s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB', hands: { p1: ['heal'] } });
  s0 = edit(s0, (d) => {
    Object.assign(d.players[3], { alive: false, hp: 0, coins: 0, privateInfo: null });
  });
  const spectator = viewFor(s0, null);
  assert.equal(spectator.role, 'spectator');
  assert.equal(spectator.self, null);
  assert.equal(spectator.ghost, null);
  assert.equal(viewFor(s0, 'someone-else').role, 'spectator');
  const ghost = viewFor(s0, 'p4');
  assert.equal(ghost.role, 'ghost');
  assert.equal(ghost.self, null);
  same({ ...ghost, viewer: null, role: 'spectator', ghost: null }, spectator);
});

test('visibility: what IS public - seats, life points, jail, links, turn, announced counts, double, direction', () => {
  let s0 = setup({ n: 4, chambers: 'LBLB' });
  s0 = edit(s0, (d) => {
    d.players[1].jailed = true;
    d.players[2].hp = 2;
    d.links.push(['p1', 'p3']);
    d.doublePending = true;
    d.direction = -1;
  });
  const v = viewFor(s0, null);
  assert.deepEqual(v.players, [
    { id: 'p1', seat: 0, hp: 5, alive: true, jailed: false },
    { id: 'p2', seat: 1, hp: 5, alive: true, jailed: true },
    { id: 'p3', seat: 2, hp: 2, alive: true, jailed: false },
    { id: 'p4', seat: 3, hp: 5, alive: true, jailed: false },
  ]);
  assert.deepEqual(v.links, [['p1', 'p3']]);
  assert.equal(v.doublePending, true);
  assert.equal(v.direction, -1);
  assert.deepEqual(v.turn, { playerId: 'p1', number: 1 });
  assert.deepEqual(v.round.announced, { total: 4, live: 2, blank: 2 });
  assert.deepEqual(v.config, s0.config);
});

test('visibility: a view is an independent copy of plain JSON data', () => {
  const s0 = setup({ n: 4, chambers: 'LBLB', hands: { p1: ['heal'] } });
  const view = viewFor(s0, 'p1');
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  view.self.hand.push('jail');
  view.players[0].hp = 0;
  view.config.hp = 1;
  assert.deepEqual(s0.players[0].hand, ['heal']);
  assert.equal(viewFor(s0, 'p1').players[0].hp, 5);
});

test('visibility: every event is tagged public or private-to-someone, and eventsFor filters accordingly', () => {
  const s0 = setup({ n: 4, chambers: 'LBLB', hands: { p1: ['detector', 'steal', 'probe'], p2: ['heal'] } });
  const { events } = play(
    s0,
    use('p1', 'detector'),
    use('p1', 'steal', { target: 'p2' }),
    { type: 'stealChoice', playerId: 'p1', take: 'heal', give: 'probe' },
    shoot('p1', 'p3'),
  );
  for (const e of events) {
    assert.ok(e.visibility === 'public' || (e.visibility === 'private' && Array.isArray(e.to)));
  }
  const publicOnes = publicEvents(events);
  assert.deepEqual(eventsFor(events, null), publicOnes);
  assert.deepEqual(eventsFor(events, 'p4'), publicOnes);
  assert.equal(eventsFor(events, 'p1').length, publicOnes.length + 3, 'detector, steal peek, steal result');
  assert.equal(eventsFor(events, 'p2').length, publicOnes.length + 1, 'steal result');
  // Audit records are addressed to nobody.
  assert.ok(events.some((e) => e.type === 'shotAudit'));
  for (const v of ['p1', 'p2', 'p3', 'p4', null]) assert.ok(!eventsFor(events, v).some((e) => e.type === 'shotAudit'));
});

test('visibility: every public event type has a fixed field whitelist', () => {
  assert.deepEqual(Object.keys(PUBLIC_EVENT_FIELDS).sort(), [
    'eliminated',
    'jailReleased',
    'matchEnded',
    'matchStarted',
    'playerRemoved',
    'predictionResolved',
    'reloaded',
    'roundEnded',
    'shopRestocked',
    'shopStockChanged',
    'shot',
    'timedOut',
    'toolBlocked',
    'toolUsed',
    'turnSkipped',
    'turnStarted',
  ]);
});

test('visibility: scrambling every secret a viewer must not know never changes their view (full random matches)', () => {
  // Exhaustive version of the sampled leak check in the fuzz test.
  for (const mode of ['classic', 'custom']) {
    for (let seed = 1; seed <= 12; seed++) {
      let x = seed * 7919;
      const rnd = () => {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        return x / 4294967296;
      };
      const pick = (list) => list[Math.floor(rnd() * list.length)];
      const n = 3 + (seed % 6);
      const created = createMatch({ mode }, ids(n).map((id) => ({ id, confirmShot: seed % 2 === 0 })), seed);
      let state = deepFreeze(created.state);
      checkEvents(state, created.events);
      checkNoLeakForAll(state);
      let steps = 0;
      while (state.status === 'active') {
        assert.ok(steps++ < 20000);
        let action = { type: 'timeout' };
        if (rnd() > 0.05) {
          const looters = state.players.filter((p) => (p.loots ?? []).length > 0);
          const actor = looters.length > 0 && rnd() < 0.3 ? pick(looters).id : rnd() < 0.6 ? state.turn.playerId : pick(state.players).id;
          const legal = listLegalActions(state, actor);
          if (legal.length === 0) continue;
          action = pick(legal);
        }
        const res = applyAction(state, action);
        assert.equal(res.ok, true);
        state = deepFreeze(res.state);
        checkEvents(state, res.events);
        checkNoLeakForAll(state);
      }
    }
  }
});

test('visibility: the scrambler really changes the secrets (the leak check is not vacuous)', () => {
  const s0 = setup({ mode: 'custom', n: 4, chambers: 'LBLB', hands: { p2: ['heal'] } });
  const scrambled = scrambleSecrets(s0, 'p1');
  assert.notDeepEqual(scrambled.round.chambers, s0.round.chambers);
  assert.notDeepEqual(scrambled.players[1].hand, s0.players[1].hand);
  assert.notEqual(scrambled.players[1].coins, s0.players[1].coins);
  assert.notDeepEqual(scrambled.players[1].shields, s0.players[1].shields);
  assert.notEqual(scrambled.rng.s, s0.rng.s);
  assert.deepEqual(scrambled.players[0], s0.players[0], 'the viewer\'s own data is kept');
  // And a deliberately leaky view would be caught:
  const leaky = (state) => JSON.stringify({ ...viewFor(state, 'p1'), peek: state.players[1].hand.length });
  assert.notEqual(leaky(s0), leaky(scrambled));
});
