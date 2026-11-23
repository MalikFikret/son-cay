// Custom mode: private info, tool changes, coins, shop, transfers, ransom and
// loot with coins, ghosts and predictions (document: "Custom mode").

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, createMatch, viewFor, stockCopies, TOOL_IDS } from '../src/engine/index.js';
import { ids, newMatch, setup, act, play, fails, shoot, use, pubs, privs, one, player, edit } from './helpers.js';

const custom = (opts = {}) => setup({ mode: 'custom', ...opts });
const buy = (playerId, tool) => ({ type: 'buy', playerId, tool });
const transfer = (playerId, to, amount) => ({ type: 'transfer', playerId, to, amount });
const predict = (playerId, prediction) => ({ type: 'predict', playerId, prediction });
const kill = (state, ...deadIds) =>
  edit(state, (d) => {
    for (const id of deadIds) {
      const p = d.players.find((q) => q.id === id);
      p.alive = false;
      p.hp = 0;
      p.hand = [];
      p.coins = 0;
      p.privateInfo = null;
    }
  });

// --- Basis -----------------------------------------------------------------------

test('custom: it is classic plus the three additions - the classic turn rules still hold', () => {
  const s0 = custom({ chambers: 'LBB' });
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 4);
  assert.equal(state.turn.playerId, 'p2');
  // The reload is the classic reload: counts announced once.
  const { events } = newMatch({ mode: 'custom', n: 5, seed: 3 });
  assert.equal(pubs(events, 'reloaded').length, 1);
});

// --- Private info ----------------------------------------------------------------

test('private info: at every reload each living player secretly sees one chamber, all different', () => {
  for (let seed = 0; seed < 40; seed++) {
    const { state, events } = newMatch({ mode: 'custom', n: 3 + (seed % 13), seed });
    const seen = {};
    for (const p of state.players) {
      const info = p.privateInfo;
      assert.equal(info.round, 1);
      assert.equal(info.type, state.round.chambers[info.chamberIndex].type, 'the information is true');
      assert.ok(!seen[info.chamberIndex], 'no two players see the same chamber');
      seen[info.chamberIndex] = true;
      const e = one(privs(events, 'privateInfo', p.id));
      assert.deepEqual(e.to, [p.id]);
      assert.equal(e.chamber, info.type);
      assert.deepEqual(viewFor(state, p.id).self.privateInfo, info);
    }
    assert.equal(pubs(events, 'privateInfo').length, 0);
  }
});

test('private info: renewed at the next reload, for living players only', () => {
  let s0 = custom({ n: 4, chambers: 'B' });
  s0 = kill(s0, 'p4');
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.round.index, 2);
  assert.equal(privs(events, 'privateInfo').length, 3);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(player(state, id).privateInfo.round, 2);
  assert.equal(player(state, 'p4').privateInfo, null);
});

test('private info: nobody else can see it', () => {
  const { state } = newMatch({ mode: 'custom', n: 4, seed: 8 });
  const [a, b] = state.players;
  const viewB = JSON.stringify(viewFor(state, b.id));
  const changed = edit(state, (d) => {
    d.players[0].privateInfo.type = a.privateInfo.type === 'live' ? 'blank' : 'live';
    d.players[0].privateInfo.chamberIndex += 1;
  });
  assert.equal(JSON.stringify(viewFor(changed, b.id)), viewB);
});

// --- Tool changes ----------------------------------------------------------------

test('custom tools: swap does not exist in custom mode', () => {
  const { state } = newMatch({ mode: 'custom', n: 4, seed: 2 });
  assert.equal(state.config.enabledTools.includes('swap'), false);
  assert.equal('swap' in state.shop.stock, false);
  fails(state, buy(state.players[0].id, 'swap'), ERR.TOOL_NOT_FOR_SALE);
  assert.equal(createMatch({ mode: 'custom', enabledTools: ['swap'] }, ids(3).map((id) => ({ id })), 1).ok, false);
});

test('custom tools: skip is public - everyone sees the skip, the type stays with the user', () => {
  const s0 = custom({ chambers: 'LBB', hands: { p1: ['skip'] } });
  const { state, events } = act(s0, use('p1', 'skip'));
  assert.deepEqual(pubs(events), [{ type: 'toolUsed', tool: 'skip', by: 'p1', visibility: 'public' }]);
  assert.deepEqual(one(privs(events, 'toolResult')), {
    type: 'toolResult',
    tool: 'skip',
    by: 'p1',
    chamber: 'live',
    visibility: 'private',
    to: ['p1'],
  });
  assert.equal(state.round.cursor, 1);
  assert.equal(state.turn.playerId, 'p1');
});

test('custom tools: shuffle stays and, being announced, marks private info as no longer reliable', () => {
  const { state } = newMatch({ mode: 'custom', n: 4, seed: 5, confirm: false });
  const current = state.turn.playerId;
  const ready = edit(state, (d) => {
    d.players.find((p) => p.id === current).hand = ['shuffle'];
  });
  const { state: after, events } = act(ready, use(current, 'shuffle'));
  assert.equal(one(pubs(events, 'toolUsed')).tool, 'shuffle');
  for (const p of after.players) {
    assert.equal(p.privateInfo.stale, true);
    assert.equal(viewFor(after, p.id).self.privateInfo.stale, true);
  }
});

test('custom tools: shuffle does not touch information about chambers already played', () => {
  let s0 = custom({ chambers: 'LBLB', hands: { p1: ['shuffle'] } });
  s0 = edit(s0, (d) => {
    d.round.cursor = 2;
    d.players[0].privateInfo = { round: 1, chamberIndex: 0, type: 'live', stale: false };
    d.players[1].privateInfo = { round: 1, chamberIndex: 3, type: 'blank', stale: false };
  });
  const { state } = act(s0, use('p1', 'shuffle'));
  assert.equal(player(state, 'p1').privateInfo.stale, false);
  assert.equal(player(state, 'p2').privateInfo.stale, true);
});

test('custom tools: flip stays as it is (hidden; changes the effect, not the type or place)', () => {
  const s0 = custom({ chambers: 'LBB', hands: { p1: ['flip'] } });
  const flipped = act(s0, use('p1', 'flip'));
  assert.deepEqual(pubs(flipped.events), []);
  const { state, events } = act(flipped.state, shoot('p1', 'p2'));
  assert.equal(one(pubs(events, 'shot')).effect, 'blank');
  assert.equal(state.round.chambers[0].type, 'live');
});

test('custom tools: the other tools work as in classic (detector hidden, double announced)', () => {
  const s0 = custom({ chambers: 'LBB', hands: { p1: ['detector', 'double'] } });
  const d = act(s0, use('p1', 'detector'));
  assert.deepEqual(pubs(d.events), []);
  assert.equal(one(d.events).chamber, 'live');
  const { state } = play(d.state, use('p1', 'double'), shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 3);
});

// --- Coins -----------------------------------------------------------------------

test('coins: no random tools are dealt - every tool is bought', () => {
  const { state, events } = newMatch({ mode: 'custom', n: 6, seed: 4 });
  for (const p of state.players) assert.deepEqual(p.hand, []);
  assert.equal(privs(events, 'toolsDealt').length, 0);
  const s0 = custom({ n: 3, chambers: 'B' });
  const reloaded = act(s0, shoot('p1', 'p2'));
  assert.equal(privs(reloaded.events, 'toolsDealt').length, 0);
  for (const p of reloaded.state.players) assert.deepEqual(p.hand, []);
});

test('coins: everyone starts with 4 (design change) and each living player gets 3 with every reload after the first', () => {
  let s0 = custom({ n: 4, chambers: 'B' });
  for (const p of s0.players) assert.equal(p.coins, 4);
  s0 = kill(s0, 'p4');
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(
    state.players.map((p) => p.coins),
    [7, 7, 7, 0],
  );
  const gains = privs(events, 'coinsChanged');
  assert.equal(gains.length, 3);
  for (const g of gains) {
    assert.equal(g.reason, 'reload');
    assert.equal(g.delta, 3);
    assert.equal(g.to.length, 1);
  }
});

test('coins: a blank on yourself earns one coin and keeps the turn', () => {
  const s0 = custom({ chambers: 'BLB' });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').coins, 5);
  assert.equal(state.turn.playerId, 'p1');
  const gain = one(privs(events, 'coinsChanged'));
  assert.deepEqual(gain.to, ['p1']);
  assert.equal(gain.reason, 'selfBlank');
  // No coin for any other outcome.
  assert.equal(player(act(s0, shoot('p1', 'p2')).state, 'p1').coins, 4);
  const live = custom({ chambers: 'LBB' });
  assert.equal(player(act(live, shoot('p1', 'p1')).state, 'p1').coins, 4);
});

test('coins: the amounts are host settings', () => {
  const s0 = custom({
    n: 3,
    chambers: 'BB',
    config: { custom: { startCoins: 2, coinsPerReload: 7, selfBlankCoin: 4 } },
  });
  assert.equal(player(s0, 'p1').coins, 2);
  const blank = act(s0, shoot('p1', 'p1')).state;
  assert.equal(player(blank, 'p1').coins, 6);
  const reloaded = act(blank, shoot('p1', 'p2')).state;
  assert.equal(player(reloaded, 'p1').coins, 13);
  assert.equal(player(reloaded, 'p2').coins, 9);
});

test('coins: a balance is visible to its owner only', () => {
  const s0 = custom({ chambers: 'LBB', coins: { p1: 9, p2: 1 } });
  assert.equal(viewFor(s0, 'p1').self.coins, 9);
  const v2 = viewFor(s0, 'p2');
  assert.equal(v2.self.coins, 1);
  for (const p of v2.players) assert.equal('coins' in p, false);
  assert.ok(!JSON.stringify(viewFor(s0, null)).includes('coins":9'));
});

test('coins: classic mode has no coins, shop, transfers or predictions', () => {
  const s0 = setup({ chambers: 'LBB' });
  fails(s0, buy('p1', 'heal'), ERR.NOT_CUSTOM_MODE);
  fails(s0, transfer('p1', 'p2', 1), ERR.NOT_CUSTOM_MODE);
  fails(s0, predict('p1', 'live'), ERR.NOT_CUSTOM_MODE);
  assert.equal(viewFor(s0, 'p1').shop, null);
  assert.equal(viewFor(s0, 'p1').self.coins, null);
});

// --- Transfers ---------------------------------------------------------------------

test('transfer: a player gives coins to another; only sender and receiver know', () => {
  const s0 = custom({ n: 4, chambers: 'LBBB' });
  const before = { p3: viewFor(s0, 'p3'), spectator: viewFor(s0, null) };
  const { state, events } = act(s0, transfer('p2', 'p4', 3)); // not even p2's turn
  assert.equal(player(state, 'p2').coins, 1);
  assert.equal(player(state, 'p4').coins, 7);
  assert.deepEqual(pubs(events), []);
  assert.deepEqual(one(privs(events, 'transferSent')).to, ['p2']);
  assert.deepEqual(one(privs(events, 'transferReceived')).to, ['p4']);
  assert.equal(privs(events, undefined, 'p3').length, 0);
  assert.deepEqual(viewFor(state, 'p3'), before.p3);
  assert.deepEqual(viewFor(state, null), before.spectator);
});

test('transfer: invalid transfers are refused', () => {
  const s0 = kill(custom({ n: 4, chambers: 'LBBB' }), 'p4');
  fails(s0, transfer('p1', 'p2', 6), ERR.INSUFFICIENT_COINS);
  fails(s0, transfer('p1', 'p2', 0), ERR.INVALID_AMOUNT);
  fails(s0, transfer('p1', 'p2', -2), ERR.INVALID_AMOUNT);
  fails(s0, transfer('p1', 'p2', 1.5), ERR.INVALID_AMOUNT);
  fails(s0, transfer('p1', 'p1', 1), ERR.INVALID_TARGET);
  fails(s0, transfer('p1', 'p4', 1), ERR.INVALID_TARGET);
  fails(s0, transfer('p4', 'p1', 1), ERR.PLAYER_ELIMINATED);
});

// --- Shop --------------------------------------------------------------------------

test('shop: buying is possible at any time, costs the listed price, and is secret', () => {
  const s0 = custom({ n: 4, chambers: 'LBBB', config: { custom: { limitedStock: false } } });
  const before = viewFor(s0, 'p1');
  const { state, events } = act(s0, buy('p3', 'heal')); // during p1's turn
  assert.deepEqual(player(state, 'p3').hand, ['heal']);
  assert.equal(player(state, 'p3').coins, 1);
  assert.deepEqual(pubs(events), [], 'with open stock a purchase leaves no public trace');
  assert.deepEqual(one(events), { type: 'purchased', player: 'p3', tool: 'heal', price: 3, coins: 1, visibility: 'private', to: ['p3'] });
  assert.deepEqual(viewFor(state, 'p1'), before);
});

test('shop: coins buy tools only, and only what you can afford', () => {
  const s0 = custom({ chambers: 'LBB', coins: { p1: 4 } });
  fails(s0, buy('p1', 'double'), ERR.INSUFFICIENT_COINS);
  fails(s0, buy('p1', 'hp'), ERR.TOOL_NOT_FOR_SALE);
  fails(s0, buy('p1'), ERR.TOOL_NOT_FOR_SALE);
  act(s0, buy('p1', 'shuffle'));
});

test('shop: a bought tool obeys its own rules (turn tools only in your turn, shields from the next turn)', () => {
  const s0 = custom({ chambers: 'LLBB', coins: { p2: 20 } });
  const bought = play(s0, buy('p2', 'detector'), buy('p2', 'shotShield')).state;
  fails(bought, use('p2', 'detector'), ERR.NOT_YOUR_TURN);
  const shielded = act(bought, use('p2', 'shotShield')).state;
  const { state } = act(shielded, shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 4, 'bought and raised this turn: not active yet');
  act(state, use('p2', 'detector'));
});

test('shop: stock is limited per reload and tied to the number of living players', () => {
  const { state } = newMatch({ mode: 'custom', n: 6, seed: 12 });
  const stock = state.shop.stock;
  assert.deepEqual(Object.keys(stock), TOOL_IDS.filter((t) => t !== 'swap'));
  for (const tool of Object.keys(stock)) assert.equal(stock[tool], stockCopies(state.config, tool, 6));
  assert.equal(stock.probe, 3, 'half of the six living players');
  assert.ok(stock.shotShield < stock.probe, 'stronger tools have fewer copies');
});

test('shop: first come, first served - players see what is left but never who bought', () => {
  const s0 = custom({ n: 4, chambers: 'LBBB', coins: { p1: 20, p2: 20, p3: 20 } });
  assert.equal(s0.shop.stock.heal, 2);
  const first = act(s0, buy('p2', 'heal'));
  assert.deepEqual(pubs(first.events), [{ type: 'shopStockChanged', tool: 'heal', remaining: 1, visibility: 'public' }]);
  assert.equal(viewFor(first.state, 'p4').shop.stock.heal, 1);
  assert.ok(!JSON.stringify(pubs(first.events)).includes('p2'));
  const second = act(first.state, buy('p3', 'heal')).state;
  assert.equal(second.shop.stock.heal, 0);
  fails(second, buy('p1', 'heal'), ERR.OUT_OF_STOCK);
});

test('shop: the stock is renewed with the next reload, for the players alive then', () => {
  let s0 = custom({ n: 6, chambers: 'B', coins: { p1: 20 } });
  s0 = act(s0, buy('p1', 'probe')).state;
  assert.equal(s0.shop.stock.probe, 2);
  s0 = kill(s0, 'p5', 'p6');
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.shop.stock.probe, 2, 'half of four');
  assert.equal(state.shop.stock.shotShield, 1);
  assert.deepEqual(one(pubs(events, 'shopRestocked')).stock, state.shop.stock);
});

test('shop: the host can make stock unlimited, set copies per tool, and change prices', () => {
  const open = custom({ chambers: 'LBB', coins: { p1: 50 }, config: { custom: { limitedStock: false } } });
  assert.equal(open.shop.stock.probe, null);
  let s = open;
  for (let i = 0; i < 10; i++) s = act(s, buy('p1', 'probe')).state;
  assert.equal(player(s, 'p1').hand.length, 10);

  const tuned = custom({
    chambers: 'LBB',
    coins: { p1: 10 },
    config: { custom: { stock: { heal: 1, probe: 0 }, prices: { heal: 0, double: 9 } } },
  });
  assert.equal(tuned.shop.stock.heal, 1);
  fails(tuned, buy('p1', 'probe'), ERR.OUT_OF_STOCK);
  const free = act(tuned, buy('p1', 'heal')).state;
  assert.equal(player(free, 'p1').coins, 10);
  fails(free, buy('p1', 'heal'), ERR.OUT_OF_STOCK);
  act(free, buy('p1', 'double'));
});

test('shop: only enabled tools are sold; eliminated players cannot buy', () => {
  const s0 = kill(custom({ n: 4, chambers: 'LBBB', config: { enabledTools: ['heal', 'probe'] } }), 'p4');
  assert.deepEqual(Object.keys(s0.shop.stock), ['probe', 'heal']);
  fails(s0, buy('p1', 'double'), ERR.TOOL_NOT_FOR_SALE);
  fails(s0, buy('p4', 'heal'), ERR.PLAYER_ELIMINATED);
});

// --- Jail and loot in custom ---------------------------------------------------------

test('custom ransom: coins can be offered instead of a tool; the amount is whatever the other accepts', () => {
  const s0 = custom({ n: 4, chambers: 'BBBBBB', hands: { p1: ['jail'] } });
  const jailed = act(s0, use('p1', 'jail', { target: 'p2' })).state;
  fails(jailed, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'coins', amount: 6 } }, ERR.INSUFFICIENT_COINS);
  fails(jailed, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'coins', amount: 0 } }, ERR.INVALID_AMOUNT);
  const offered = act(jailed, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'coins', amount: 2 } }).state;
  const { state, events } = act(offered, { type: 'ransomAccept', playerId: 'p3', from: 'p2' });
  assert.equal(player(state, 'p2').coins, 2);
  assert.equal(player(state, 'p3').coins, 6);
  assert.equal(player(state, 'p2').jailed, false);
  assert.deepEqual(pubs(events), [{ type: 'jailReleased', player: 'p2', reason: 'ransom', visibility: 'public' }]);
});

test('custom ransom: a tool still works, and an offer that can no longer be paid cannot be accepted', () => {
  const s0 = custom({ n: 4, chambers: 'BBBBBB', hands: { p1: ['jail'], p2: ['heal'] } });
  const jailed = act(s0, use('p1', 'jail', { target: 'p2' })).state;
  const toolOffer = act(jailed, { type: 'ransomOffer', playerId: 'p2', to: 'p4', offer: { kind: 'tool', tool: 'heal' } }).state;
  assert.deepEqual(player(act(toolOffer, { type: 'ransomAccept', playerId: 'p4', from: 'p2' }).state, 'p4').hand, ['heal']);
  const coinOffer = act(jailed, { type: 'ransomOffer', playerId: 'p2', to: 'p4', offer: { kind: 'coins', amount: 4 } }).state;
  const spent = act(coinOffer, transfer('p2', 'p1', 3)).state;
  fails(spent, { type: 'ransomAccept', playerId: 'p4', from: 'p2' }, ERR.OFFER_NOT_FUNDED);
});

test('custom loot: the looter picks a tool as in classic, or coins up to the cap of 3', () => {
  const s0 = custom({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, coins: { p2: 9 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  assert.deepEqual(viewFor(pending, 'p1').self.loots, [{ victim: 'p2', tools: ['heal', 'jail'], coinsOption: true, clockSeq: pending.clock.seq }]);
  const coins = act(pending, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'coins' } });
  assert.equal(player(coins.state, 'p1').coins, 7);
  assert.deepEqual(player(coins.state, 'p1').hand, []);
  assert.equal(player(coins.state, 'p2').coins, 0, 'the rest leaves the game');
  assert.equal(one(privs(coins.events, 'lootResult')).amount, 3);
  const tool = act(pending, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'tool', tool: 'jail' } });
  assert.deepEqual(player(tool.state, 'p1').hand, ['jail']);
  assert.equal(player(tool.state, 'p1').coins, 4);
});

test('custom loot: the choice is blind - less than the cap gives what is there, nothing gives nothing', () => {
  for (const [balance, gained] of [
    [2, 2],
    [0, 0],
    [3, 3],
  ]) {
    const s0 = custom({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, coins: { p2: balance }, hands: { p2: ['heal'] } });
    const pending = act(s0, shoot('p1', 'p2')).state;
    // The looter's view is identical whatever the victim's balance is.
    const other = edit(pending, (d) => {
      d.players[1].coins = 99;
    });
    assert.deepEqual(viewFor(pending, 'p1'), viewFor(other, 'p1'));
    const { state } = act(pending, { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'coins' } });
    assert.equal(player(state, 'p1').coins, 4 + gained);
  }
});

test('custom loot: the coin cap is a host setting', () => {
  const s0 = custom({
    n: 4,
    chambers: 'LBBB',
    hp: { p2: 1 },
    coins: { p2: 9 },
    config: { custom: { lootCoinCap: 5 } },
  });
  const { state } = play(s0, shoot('p1', 'p2'), { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'coins' } });
  assert.equal(player(state, 'p1').coins, 9);
});

// --- Ghosts and predictions --------------------------------------------------------

function ghostState(extra = {}) {
  // p4 is a ghost; p1 to play.
  return kill(custom({ n: 4, chambers: 'LBLB', ...extra }), 'p4');
}

test('ghost: an eliminated player becomes a ghost and sees only what a spectator sees', () => {
  let s0 = custom({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p1: ['flip'], p2: ['heal'] }, coins: { p3: 9 } });
  s0 = edit(s0, (d) => {
    d.players[1].privateInfo = { round: 1, chamberIndex: 2, type: 'blank', stale: false };
    d.players[2].shields.shot.push(0);
  });
  const dead = play(s0, shoot('p1', 'p2'), { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'none' } }).state;
  const view = viewFor(dead, 'p2');
  assert.equal(view.role, 'ghost');
  assert.equal(view.self, null, 'what they knew while alive is removed from their screen');
  assert.deepEqual(view.ghost, { prediction: null });
  assert.deepEqual({ ...view, viewer: null, role: 'spectator', ghost: null }, viewFor(dead, null));
  assert.equal(player(dead, 'p2').privateInfo, null);
});

test('prediction: a ghost predicts the next shot as live or blank, or leaves it, and may change it freely', () => {
  const s0 = ghostState();
  const a = act(s0, predict('p4', 'live'));
  assert.deepEqual(pubs(a.events), [], 'a standing prediction is not public');
  assert.deepEqual(one(a.events).to, ['p4']);
  assert.equal(viewFor(a.state, 'p4').ghost.prediction, 'live');
  const b = act(a.state, predict('p4', 'blank')).state;
  assert.equal(viewFor(b, 'p4').ghost.prediction, 'blank');
  const c = act(b, predict('p4', null)).state;
  assert.equal(viewFor(c, 'p4').ghost.prediction, null);
  assert.deepEqual(c.predictions, {});
  fails(s0, predict('p4', 'maybe'), ERR.INVALID_PREDICTION);
});

test('prediction: living players do not predict', () => {
  const s0 = ghostState();
  fails(s0, predict('p2', 'live'), ERR.NOT_A_GHOST);
  fails(s0, predict('nobody', 'live'), ERR.UNKNOWN_PLAYER);
});

test('prediction: it is locked when the shooter presses confirm - changes before that count', () => {
  const s0 = ghostState({ confirm: true });
  const aimed = play(s0, predict('p4', 'blank'), shoot('p1', 'p2')).state;
  assert.equal(aimed.phase.type, 'confirm');
  // Still changeable while the shooter has only aimed.
  const changed = act(aimed, predict('p4', 'live')).state;
  const { state, events } = act(changed, { type: 'confirmShot', playerId: 'p1' });
  assert.deepEqual(one(pubs(events, 'predictionResolved')), {
    type: 'predictionResolved',
    player: 'p4',
    round: 1,
    prediction: 'live',
    correct: true,
    visibility: 'public',
  });
  assert.deepEqual(state.predictions, {}, 'cleared for the next shot');
  assert.equal(viewFor(state, 'p4').ghost.prediction, null);
});

test('prediction: with confirmation turned off, it is locked the moment the target is chosen', () => {
  const s0 = ghostState({ confirm: false });
  const { events } = play(s0, predict('p4', 'blank'), shoot('p1', 'p2'));
  const resolved = one(pubs(events, 'predictionResolved'));
  assert.equal(resolved.prediction, 'blank');
  assert.equal(resolved.correct, false);
});

test('prediction: the shot does not wait for ghosts - no prediction means no result', () => {
  const s0 = ghostState();
  const { events } = act(s0, shoot('p1', 'p2'));
  assert.equal(pubs(events, 'predictionResolved').length, 0);
});

test('prediction: judged by the displayed effect - a flipped chamber counts as what it showed', () => {
  const s0 = ghostState({ hands: { p1: ['flip'] } });
  // The chamber is live, flipped to act (and show) as blank.
  const { events } = play(s0, predict('p4', 'blank'), use('p1', 'flip'), shoot('p1', 'p2'));
  assert.equal(one(pubs(events, 'shot')).effect, 'blank');
  assert.equal(one(pubs(events, 'predictionResolved')).correct, true);
  const wrong = play(s0, predict('p4', 'live'), use('p1', 'flip'), shoot('p1', 'p2')).events;
  assert.equal(one(pubs(wrong, 'predictionResolved')).correct, false);
});

test('prediction: one prediction per shot - a new one is needed after each shot, also within one turn', () => {
  const s0 = kill(custom({ n: 4, chambers: 'BBLB' }), 'p4');
  const first = play(s0, predict('p4', 'blank'), shoot('p1', 'p1'));
  assert.equal(pubs(first.events, 'predictionResolved').length, 1);
  assert.equal(first.state.turn.playerId, 'p1');
  const second = act(first.state, shoot('p1', 'p1'));
  assert.equal(pubs(second.events, 'predictionResolved').length, 0);
  const third = play(second.state, predict('p4', 'live'), shoot('p1', 'p2'));
  assert.equal(one(pubs(third.events, 'predictionResolved')).correct, true);
});

test('prediction: a timeout shot settles standing predictions too', () => {
  const s0 = ghostState();
  const { events } = play(s0, predict('p4', 'live'), { type: 'timeout' });
  assert.equal(one(pubs(events, 'predictionResolved')).correct, true);
});

test('prediction: gives no coins, and several ghosts predict independently', () => {
  const s0 = kill(custom({ n: 5, chambers: 'LBLBB' }), 'p4', 'p5');
  const { state, events } = play(s0, predict('p4', 'live'), predict('p5', 'blank'), shoot('p1', 'p2'));
  assert.deepEqual(
    pubs(events, 'predictionResolved').map((e) => [e.player, e.correct]),
    [
      ['p4', true],
      ['p5', false],
    ],
  );
  assert.equal(player(state, 'p4').coins, 0);
  assert.equal(player(state, 'p5').coins, 0);
  // Each ghost sees only their own prediction.
  const pending = play(s0, predict('p4', 'live')).state;
  assert.equal(viewFor(pending, 'p5').ghost.prediction, null);
  assert.ok(!JSON.stringify(viewFor(pending, 'p1')).includes('prediction'));
});

test('prediction: a player killed by a shot is not judged on that same shot', () => {
  const s0 = custom({ n: 4, chambers: 'LBBB', hp: { p2: 1 } });
  const { events } = act(s0, shoot('p1', 'p2'));
  assert.equal(pubs(events, 'predictionResolved').length, 0);
});
