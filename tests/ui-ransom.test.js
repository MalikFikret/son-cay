// Game UI, the Hapis ransom (Fidye; task 4.3c, decision 64; src/ui/ransom-model.js): the jailed
// player's row and sheet, the recipient's cards, the closing lines for the two players involved,
// the public release line, and that a third player's table is the same with and without an offer.
// No browser, no emulator. The helpers are fed what watchMatch gives one device.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, eventsFor, listLegalActions, viewFor } from '../src/engine/index.js';
import { t } from '../src/ui/i18n/i18n.js';
import {
  acceptAction,
  incomingCards,
  offerAction,
  pendingText,
  ransomChoices,
  ransomErrorText,
  ransomNotices,
  ransomRow,
  rejectAction,
  withdrawAction,
} from '../src/ui/ransom-model.js';
import { handState, effectsStrip, cardButton } from '../src/ui/tool-model.js';
import { lootCards } from '../src/ui/loot-model.js';
import { lastMove, seatTags, statusText, revolverSeat } from '../src/ui/table-model.js';
import { act, edit, setup, shoot, use } from './helpers.js';

const names = { p1: 'Malik', p2: 'Kerem', p3: 'Selin', p4: 'Zeynep' };
const nameOf = (id) => names[id] ?? id;
const offer = (from, to, tool) => ({ type: 'ransomOffer', playerId: from, to, offer: { kind: 'tool', tool } });

// p1 jails p2 (who holds Pansuman and Göz); it is still p1's turn.
function jailed(hands = { p1: ['jail'], p2: ['heal', 'detector'] }) {
  return act(setup({ n: 4, chambers: 'BBBBBB', hands }), use('p1', 'jail', { target: 'p2' })).state;
}

describe('the jailed player\'s Fidye row', () => {
  test('shown only while I am jailed and hold a tool; never for others', () => {
    const s = jailed();
    assert.deepEqual(ransomRow(viewFor(s, 'p2')), { canOffer: true, pending: null });
    for (const id of ['p1', 'p3', 'p4', null]) assert.equal(ransomRow(viewFor(s, id)), null);
  });

  test('an empty-handed jailed player has no Fidye row', () => {
    const s = jailed({ p1: ['jail'] });
    assert.equal(ransomRow(viewFor(s, 'p2')), null);
  });

  test('the sheet offers the living players (not me) and my tools, each once', () => {
    const s = edit(jailed({ p1: ['jail'], p2: ['heal', 'heal', 'detector'] }), (d) => { d.players[3].alive = false; d.players[3].hp = 0; });
    const choices = ransomChoices(listLegalActions(s, 'p2'));
    assert.deepEqual(choices.players.sort(), ['p1', 'p3']);
    assert.deepEqual(choices.tools.sort(), ['detector', 'heal']);
    assert.equal(offerAction({ to: 'p3', tool: null }, choices), null);
    assert.equal(offerAction({ to: 'p9', tool: 'heal' }, choices), null);
    assert.deepEqual(offerAction({ to: 'p3', tool: 'heal' }, choices), { type: 'ransomOffer', to: 'p3', offer: { kind: 'tool', tool: 'heal' } });
  });

  test('a pending offer shows to whom and which tool; "Geri çek" withdraws it', () => {
    const s = act(jailed(), offer('p2', 'p3', 'heal')).state;
    const row = ransomRow(viewFor(s, 'p2'));
    assert.deepEqual(row.pending, { to: 'p3', tool: 'heal' });
    assert.equal(pendingText(row.pending, nameOf), 'Fidye teklifin: Selin · Pansuman');
    const back = act(s, { ...withdrawAction(), playerId: 'p2' });
    assert.equal(ransomRow(viewFor(back.state, 'p2')).pending, null);
    assert.deepEqual(ransomNotices(eventsFor(back.events, 'p2'), 'p2'), ['Teklif geri çekildi.']);
    assert.deepEqual(ransomNotices(eventsFor(back.events, 'p3'), 'p3'), ['Teklif geri çekildi.']);
  });
});

describe('the recipient\'s Fidye card', () => {
  test('one card per incoming offer, only on the recipient\'s screen', () => {
    let s = edit(jailed({ p1: ['jail', 'jail'], p2: ['heal'], p4: ['detector'] }), (d) => { d.config.toolsPerTurn = 5; });
    s = act(s, use('p1', 'jail', { target: 'p4' })).state;
    s = act(s, offer('p2', 'p3', 'heal')).state;
    s = act(s, offer('p4', 'p3', 'detector')).state;
    assert.deepEqual(incomingCards(viewFor(s, 'p3')), [
      { from: 'p2', tool: 'heal', name: 'Pansuman' },
      { from: 'p4', tool: 'detector', name: 'Göz' },
    ]);
    for (const id of ['p1', 'p2', 'p4', null]) assert.deepEqual(incomingCards(viewFor(s, id)), []);
  });

  test('accept moves the tool and frees the jailed player; both get a line, others only the release', () => {
    const s = act(jailed(), offer('p2', 'p3', 'heal')).state;
    const [card] = incomingCards(viewFor(s, 'p3'));
    assert.deepEqual(acceptAction(card), { type: 'ransomAccept', from: 'p2' });
    const res = act(s, { ...acceptAction(card), playerId: 'p3' });
    assert.deepEqual(viewFor(res.state, 'p3').self.hand, ['heal']);
    assert.equal(viewFor(res.state, 'p1').players.find((p) => p.id === 'p2').jailed, false);
    assert.deepEqual(incomingCards(viewFor(res.state, 'p3')), []);
    assert.equal(ransomRow(viewFor(res.state, 'p2')), null);
    assert.deepEqual(ransomNotices(eventsFor(res.events, 'p2'), 'p2'), ['Fidye kabul edildi: hapisten çıktın.']);
    assert.deepEqual(ransomNotices(eventsFor(res.events, 'p3'), 'p3'), ['Fidye kabul edildi: malzeme artık sende.']);
    for (const id of ['p1', 'p4', null]) {
      assert.deepEqual(ransomNotices(eventsFor(res.events, id), id), []);
      assert.equal(lastMove(eventsFor(res.events, id), nameOf).lead, 'Kerem hapisten çıktı.');
    }
  });

  test('reject closes it for both with one line', () => {
    const s = act(jailed(), offer('p2', 'p3', 'heal')).state;
    const res = act(s, { ...rejectAction(incomingCards(viewFor(s, 'p3'))[0]), playerId: 'p3' });
    assert.deepEqual(incomingCards(viewFor(res.state, 'p3')), []);
    assert.equal(ransomRow(viewFor(res.state, 'p2')).pending, null);
    for (const id of ['p2', 'p3']) assert.deepEqual(ransomNotices(eventsFor(res.events, id), id), ['Fidye reddedildi.']);
    assert.deepEqual(eventsFor(res.events, 'p1'), []);
  });

  test('replace: the old recipient\'s card closes ("geri çekildi"), the new one opens; same recipient: no line', () => {
    const s = act(jailed(), offer('p2', 'p3', 'heal')).state;
    const moved = act(s, offer('p2', 'p4', 'detector'));
    assert.deepEqual(incomingCards(viewFor(moved.state, 'p3')), []);
    assert.deepEqual(incomingCards(viewFor(moved.state, 'p4')), [{ from: 'p2', tool: 'detector', name: 'Göz' }]);
    assert.deepEqual(ransomNotices(eventsFor(moved.events, 'p3'), 'p3'), ['Teklif geri çekildi.']);
    assert.deepEqual(ransomNotices(eventsFor(moved.events, 'p2'), 'p2'), []);
    const same = act(s, offer('p2', 'p3', 'detector'));
    assert.deepEqual(incomingCards(viewFor(same.state, 'p3')), [{ from: 'p2', tool: 'detector', name: 'Göz' }]);
    assert.deepEqual(ransomNotices(eventsFor(same.events, 'p3'), 'p3'), []);
  });

  test('lapse: when the jailed turn is skipped, both cards close with "Teklif düştü."', () => {
    const s = act(jailed(), offer('p2', 'p3', 'heal')).state;
    const res = act(s, shoot('p1', 'p4')); // blank on another player: the turn passes, p2 is skipped
    assert.equal(res.state.turn.playerId, 'p3');
    assert.deepEqual(incomingCards(viewFor(res.state, 'p3')), []);
    assert.equal(ransomRow(viewFor(res.state, 'p2')), null, 'no longer jailed');
    for (const id of ['p2', 'p3']) assert.deepEqual(ransomNotices(eventsFor(res.events, id), id), ['Teklif düştü.']);
    assert.deepEqual(ransomNotices(eventsFor(res.events, 'p4'), 'p4'), []);
  });

  test('an offer that can no longer be paid is still shown; the engine refuses it with a clear line', () => {
    let s = act(jailed({ p1: ['jail'], p2: ['heal'] }), offer('p2', 'p3', 'heal')).state;
    s = edit(s, (d) => { d.players[1].hp = 4; });
    s = act(s, use('p2', 'heal')).state; // the jailed player used the offered tool (any time)
    assert.equal(incomingCards(viewFor(s, 'p3')).length, 1, 'the card does not reveal the offerer\'s hand');
    const res = applyAction(s, { type: 'ransomAccept', playerId: 'p3', from: 'p2' });
    assert.equal(res.ok, false);
    assert.equal(ransomErrorText(res.error), 'Teklif edilen malzeme artık yok.');
    assert.equal(ransomErrorText({ code: 'NO_OFFER' }), t('ransom.ransomGone'));
    assert.equal(ransomErrorText({ code: 'X' }), t('ransom.ransomRefused'));
  });
});

describe('Fidye: a third player\'s table is identical with and without an offer', () => {
  function screen(state, events, id) {
    const view = viewFor(state, id);
    const legal = listLegalActions(state, id);
    return JSON.stringify({
      view,
      legal,
      row: ransomRow(view),
      cards: incomingCards(view),
      notes: ransomNotices(eventsFor(events, id), id),
      loot: lootCards(view, {}, 0),
      hand: handState(view),
      strip: effectsStrip(view, eventsFor(events, id)),
      last: lastMove(eventsFor(events, id), nameOf),
      status: statusText(view, nameOf),
      revolver: revolverSeat({ target: null, view }),
      tags: view.players.map((p) => seatTags(p, { viewerId: id, turnId: view.turn.playerId, target: null, present: true, links: view.links })),
      buttons: ['heal', 'detector'].map((tool) => cardButton({ view, legalActions: legal, tool })),
    });
  }

  test('offering, replacing, withdrawing and rejecting change nothing for p1 and p4', () => {
    const base = jailed();
    const offered = act(base, offer('p2', 'p3', 'heal'));
    for (const id of ['p1', 'p4', null]) {
      assert.deepEqual(eventsFor(offered.events, id), []);
      assert.equal(screen(offered.state, [], id), screen(base, [], id));
    }
    for (const action of [offer('p2', 'p3', 'detector'), { ...withdrawAction(), playerId: 'p2' }, { type: 'ransomReject', playerId: 'p3', from: 'p2' }]) {
      const res = act(offered.state, action);
      for (const id of ['p1', 'p4', null]) {
        assert.deepEqual(eventsFor(res.events, id), [], `${action.type}: no event for ${id}`);
        assert.equal(screen(res.state, [], id), screen(base, [], id));
      }
    }
  });

  test('the offered tool and the recipient stay secret: different offers look the same to third players', () => {
    const base = jailed();
    const a = act(base, offer('p2', 'p3', 'heal')).state;
    const b = act(base, offer('p2', 'p1', 'detector')).state;
    for (const id of ['p4', null]) assert.equal(screen(a, [], id), screen(b, [], id));
  });

  test('accepting shows third players only the public release, never by whom or for what', () => {
    const s = act(jailed(), offer('p2', 'p3', 'heal')).state;
    const res = act(s, { type: 'ransomAccept', playerId: 'p3', from: 'p2' });
    for (const id of ['p1', 'p4', null]) {
      assert.deepEqual(eventsFor(res.events, id).map((e) => e.type), ['jailReleased']);
      assert.ok(!JSON.stringify(eventsFor(res.events, id)).includes('heal'));
      assert.ok(!JSON.stringify(eventsFor(res.events, id)).includes('p3'));
    }
  });
});
