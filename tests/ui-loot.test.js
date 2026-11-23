// Game UI, the "Ganimet" card (task 4.3b, decision 63; src/ui/loot-model.js): the looter's
// private loot card, its rows, countdown, choice and texts, and that nothing about a loot reaches
// what another seat's table draws. No browser, no emulator.
//
// The helpers are fed what watchMatch gives a device: its view, its events, its legal actions and
// lootDeadlines (computed from that device's own view only).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOT_SECONDS, applyAction, eventsFor, listLegalActions, viewFor } from '../src/engine/index.js';
import { TEXT } from '../src/ui/messages.js';
import { keepLootPick, lootAction, lootCards, lootErrorText, lootPick, lootTexts } from '../src/ui/loot-model.js';
import { handState, effectsStrip, cardButton } from '../src/ui/tool-model.js';
import { lastMove, seatTags, statusText, revolverSeat } from '../src/ui/table-model.js';
import { act, edit, setup, shoot, use } from './helpers.js';

const names = { p1: 'Malik', p2: 'Yusuf', p3: 'Zeynep', p4: 'Kerem' };
const nameOf = (id) => names[id] ?? id;
const T0 = 1_000_000;

// p1 kills p2 (holding Göz, Pansuman, Karıştır); the loot's countdown starts at T0.
function killed(hands = { p2: ['detector', 'heal', 'shuffle'] }) {
  return act(setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands }), shoot('p1', 'p2'));
}
const deadlinesOf = (state, id) => Object.fromEntries((viewFor(state, id).self?.loots ?? []).map((l) => [l.victim, T0 + LOOT_SECONDS * 1000]));

describe('Ganimet card', () => {
  test('the looter gets one card with the dead player\'s tools and a 15 s countdown', () => {
    const { state } = killed();
    const cards = lootCards(viewFor(state, 'p1'), deadlinesOf(state, 'p1'), T0 + 4000);
    assert.equal(cards.length, 1);
    const [card] = cards;
    assert.equal(card.victim, 'p2');
    assert.deepEqual(card.tools.map((t) => t.name), ['Göz', 'Pansuman', 'Karıştır']);
    assert.equal(card.empty, false);
    assert.equal(card.seconds, 11);
    assert.ok(Math.abs(card.fraction - 11 / 15) < 1e-9);
    assert.deepEqual(lootTexts(card, nameOf), { title: 'Ganimet: Yusuf', sub: 'Yalnız sen görüyorsun · birini seç', button: 'Al' });
  });

  test('"Al" needs a selected tool; the action carries the victim and the tool only', () => {
    const { state } = killed();
    const [card] = lootCards(viewFor(state, 'p1'), deadlinesOf(state, 'p1'), T0);
    assert.equal(lootAction(card, null), null);
    assert.equal(lootPick(null, 0), 0);
    assert.equal(lootPick(0, 0), null, 'a second tap clears it');
    assert.equal(lootPick(0, 2), 2);
    const action = lootAction(card, 0);
    assert.deepEqual(action, { type: 'lootChoice', victim: 'p2', choice: { kind: 'tool', tool: 'detector' } });
    const { state: after } = act(state, { ...action, playerId: 'p1' });
    assert.deepEqual(viewFor(after, 'p1').self.hand, ['detector']);
    assert.deepEqual(lootCards(viewFor(after, 'p1'), {}, T0), [], 'the card closes');
  });

  test('an empty hand: "Eli boştu" and "Tamam", which closes the loot taking nothing', () => {
    const { state } = killed({});
    const [card] = lootCards(viewFor(state, 'p1'), deadlinesOf(state, 'p1'), T0);
    assert.equal(card.empty, true);
    assert.deepEqual(lootTexts(card, nameOf), { title: 'Ganimet: Yusuf', sub: 'Yalnız sen görüyorsun', button: 'Tamam' });
    const action = lootAction(card, null);
    assert.deepEqual(action, { type: 'lootChoice', victim: 'p2', choice: { kind: 'none' } });
    assert.deepEqual(viewFor(act(state, { ...action, playerId: 'p1' }).state, 'p1').self.loots, []);
    assert.equal(TEXT.lootEmpty, 'Eli boştu');
    assert.equal(TEXT.lootNothing, 'Alacak bir şey yok.');
  });

  test('a double kill shows two rows, each with its own choice', () => {
    const s0 = edit(setup({ n: 5, chambers: 'LBBBB', hp: { p2: 2, p3: 1 }, hands: { p1: ['double'], p2: ['heal'], p3: ['jail'] } }), (d) => {
      d.links.push(['p2', 'p3']);
    });
    const { state } = act(act(s0, use('p1', 'double')).state, shoot('p1', 'p2'));
    const cards = lootCards(viewFor(state, 'p1'), deadlinesOf(state, 'p1'), T0);
    assert.deepEqual(cards.map((c) => [c.victim, c.tools.map((t) => t.tool)]), [['p2', ['heal']], ['p3', ['jail']]]);
    assert.deepEqual(lootAction(cards[1], 0), { type: 'lootChoice', victim: 'p3', choice: { kind: 'tool', tool: 'jail' } });
  });

  test('when the time is up the buttons give nothing; the countdown never goes below 0', () => {
    const { state } = killed();
    const [card] = lootCards(viewFor(state, 'p1'), deadlinesOf(state, 'p1'), T0 + 99_000);
    assert.equal(card.ms, 0);
    assert.equal(card.seconds, 0);
    assert.equal(lootAction(card, 0), null);
    // An unknown deadline: no countdown is drawn, the choice still works.
    const [unknown] = lootCards(viewFor(state, 'p1'), {}, T0);
    assert.equal(unknown.seconds, null);
    assert.equal(lootAction(unknown, 1).choice.tool, 'heal');
  });

  test('the selection survives an update only while the same tool is in the same place', () => {
    const { state } = killed();
    const [card] = lootCards(viewFor(state, 'p1'), {}, T0);
    assert.equal(keepLootPick(1, card, 'heal'), 1);
    assert.equal(keepLootPick(1, card, 'jail'), null);
    assert.equal(keepLootPick(null, card, 'heal'), null);
  });

  test('refusals become a short line: a closed loot says its time is up', () => {
    assert.equal(lootErrorText({ code: 'NO_LOOT' }), 'Ganimetin süresi doldu.');
    assert.equal(lootErrorText({ code: 'X' }), 'Ganimet alınamadı.');
  });

  test('nobody but the looter has a card: not the victim, not a third player, not a spectator', () => {
    const { state } = killed();
    for (const id of ['p2', 'p3', 'p4', null]) {
      assert.deepEqual(lootCards(viewFor(state, id), { p2: T0 }, T0), []);
    }
  });
});

describe('Ganimet: a third player\'s table is identical with and without a loot', () => {
  // Everything the table screen draws from what one seat receives.
  function screen(state, events, id) {
    const view = viewFor(state, id);
    const legal = listLegalActions(state, id);
    const own = Object.fromEntries((view.self?.loots ?? []).map((l) => [l.victim, T0]));
    return JSON.stringify({
      view,
      legal,
      deadlines: own,
      cards: lootCards(view, own, T0),
      hand: handState(view),
      strip: effectsStrip(view, eventsFor(events, id)),
      last: lastMove(eventsFor(events, id), nameOf),
      status: statusText(view, nameOf),
      revolver: revolverSeat({ target: null, view }),
      tags: view.players.map((p) => seatTags(p, { viewerId: id, turnId: view.turn.playerId, target: null, present: true, links: view.links })),
      cardButtons: ['heal', 'detector'].map((tool) => cardButton({ view, legalActions: legal, tool })),
    });
  }

  test('the kill itself: a victim with tools (a loot to pick) looks the same as one with none', () => {
    const rich = killed();
    const poor = killed({});
    for (const id of ['p2', 'p3', 'p4', null]) assert.equal(screen(rich.state, rich.events, id), screen(poor.state, poor.events, id));
  });

  test('an open loot vs no loot at all, and every way it closes: nothing changes for others', () => {
    const { state, events } = killed();
    const none = edit(state, (d) => {
      d.players[0].loots = [];
      d.players[1].hand = [];
    });
    for (const id of ['p2', 'p3', 'p4', null]) assert.equal(screen(state, events, id), screen(none, events, id));
    for (const action of [
      { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'tool', tool: 'heal' } },
      { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'none' } },
      { type: 'lootChoice', playerId: 'p1', victim: 'p2', choice: { kind: 'none' }, expired: true },
    ]) {
      const res = applyAction(state, action);
      assert.ok(res.ok);
      for (const id of ['p2', 'p3', 'p4', null]) {
        assert.deepEqual(eventsFor(res.events, id), [], 'no event at all for a third player');
        assert.equal(screen(res.state, events, id), screen(state, events, id));
      }
    }
  });

  test('the last-move line after a kill never mentions a loot', () => {
    const { events } = killed();
    for (const id of ['p1', 'p3']) {
      const line = lastMove(eventsFor(events, id), nameOf);
      assert.ok(!/ganimet/i.test(`${line.lead} ${line.tail}`));
    }
  });
});
