// The shot result notice (decision Q68, src/ui/shot-notice.js): built from the public events of
// one update only. Every case runs the real engine, so the events are exactly what the table
// receives. No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOT_NOTICE_BASE_MS, SHOT_NOTICE_ROW_MS, shotNotice } from '../src/ui/shot-notice.js';
import { toolName } from '../src/ui/tools.js';
import { act, edit, play, setup, shoot, use } from './helpers.js';

const NAMES = { p1: 'Kerem', p2: 'Selin', p3: 'Yusuf', p4: 'Zeynep' };
const nameOf = (id) => NAMES[id] ?? id;

// Active shields / links without playing the turns.
function withShields(state, shields = {}, links = []) {
  return edit(state, (d) => {
    for (const id of Object.keys(shields)) d.players.find((p) => p.id === id).shields.shot.push(0);
    for (const link of links) d.links.push(link.slice());
  });
}

// The rows as plain [name, value, chain] triples, for short assertions.
const rowsOf = (notice) => notice.rows.map((row) => [row.name, row.value, row.chain]);

describe('shotNotice: simple cases', () => {
  test('Dolu on another player: "A → B", Dolu, one row, 3 s', () => {
    const { events } = act(setup({ chambers: 'LBB' }), shoot('p1', 'p2'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.kind, 'live');
    assert.equal(notice.self, false);
    assert.equal(notice.shooter, 'Kerem');
    assert.equal(notice.target, 'Selin');
    assert.equal(notice.word, 'Dolu');
    assert.equal(notice.double, false);
    assert.deepEqual(rowsOf(notice), [['Selin', '−1', false]]);
    assert.deepEqual(notice.lines, []);
    assert.equal(notice.durationMs, SHOT_NOTICE_BASE_MS);
  });

  test('Boş on another player: no rows, whose turn it is now, 3 s', () => {
    const { events } = act(setup({ chambers: 'BLB' }), shoot('p1', 'p2'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.kind, 'blank');
    assert.equal(notice.word, 'Boş');
    assert.deepEqual(notice.rows, []);
    assert.deepEqual(notice.lines, ['Sıra: Selin.']);
    assert.equal(notice.durationMs, SHOT_NOTICE_BASE_MS);
  });

  test('Boş on self: "A kendine ateş etti", the turn stays with the shooter', () => {
    const { events } = act(setup({ chambers: 'BLB' }), shoot('p1', 'p1'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.self, true);
    assert.equal(notice.kind, 'blank');
    assert.deepEqual(notice.lines, ['Sıra: Kerem.']);
  });

  test('Dolu on self: one row for the shooter', () => {
    const { events } = act(setup({ chambers: 'LBB' }), shoot('p1', 'p1'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.self, true);
    assert.equal(notice.kind, 'live');
    assert.deepEqual(rowsOf(notice), [['Kerem', '−1', false]]);
  });

  test('an elimination adds "· çıktı"', () => {
    const { events } = act(setup({ chambers: 'LBB', hp: { p2: 1 } }), shoot('p1', 'p2'));
    assert.deepEqual(rowsOf(shotNotice(events, nameOf)), [['Selin', '−1 · çıktı', false]]);
  });

  test('no shot in the update: no notice', () => {
    const { events } = act(setup({ chambers: 'LBB', hands: { p1: ['detector'] } }), use('p1', 'detector'));
    assert.equal(shotNotice(events, nameOf), null);
    assert.equal(shotNotice([], nameOf), null);
    assert.equal(shotNotice(undefined, nameOf), null);
  });
});

describe('shotNotice: Çift Ateş, shields, chains', () => {
  test('Çift Ateş: Dolu with 2×, −2', () => {
    const { events } = play(setup({ chambers: 'LBB', hands: { p1: ['double'] } }), use('p1', 'double'), shoot('p1', 'p2'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.double, true);
    assert.deepEqual(rowsOf(notice), [['Selin', '−2', false]]);
  });

  test('Çift Ateş on a Boş: no 2× badge', () => {
    const { events } = play(setup({ chambers: 'BLB', hands: { p1: ['double'] } }), use('p1', 'double'), shoot('p1', 'p2'));
    assert.equal(shotNotice(events, nameOf).double, false);
  });

  test('a shield reflects: the owner\'s row says so, the shooter takes the damage, 4 s', () => {
    const { events } = act(withShields(setup({ chambers: 'LBB' }), { p2: true }), shoot('p1', 'p2'));
    const notice = shotNotice(events, nameOf);
    assert.deepEqual(rowsOf(notice), [['Selin', 'kalkan geri çevirdi', false], ['Kerem', '−1', false]]);
    assert.equal(notice.rows[0].tone, 'shield');
    assert.deepEqual(notice.lines, []);
    assert.equal(notice.durationMs, SHOT_NOTICE_BASE_MS + SHOT_NOTICE_ROW_MS);
  });

  test('two shields: both rows and "iki kalkan, kimse zarar görmedi"', () => {
    const { events } = act(withShields(setup({ chambers: 'LBB' }), { p1: true, p2: true }), shoot('p1', 'p2'));
    const notice = shotNotice(events, nameOf);
    assert.deepEqual(rowsOf(notice), [['Selin', 'kalkan geri çevirdi', false], ['Kerem', 'kalkan durdurdu', false]]);
    assert.deepEqual(notice.lines, ['iki kalkan, kimse zarar görmedi']);
    assert.ok(!notice.rows.some((row) => row.value.includes('−')), 'nobody was hurt');
  });

  test('a chain: the partner\'s row has the zincir tag', () => {
    const { events } = act(withShields(setup({ chambers: 'LBB' }), {}, [['p2', 'p3']]), shoot('p1', 'p2'));
    assert.deepEqual(rowsOf(shotNotice(events, nameOf)), [['Selin', '−1', false], ['Yusuf', '−1', true]]);
  });

  test('a reflected shot travels the shooter\'s chain too', () => {
    const { events } = act(withShields(setup({ chambers: 'LBB' }), { p2: true }, [['p1', 'p3']]), shoot('p1', 'p2'));
    assert.deepEqual(rowsOf(shotNotice(events, nameOf)), [
      ['Selin', 'kalkan geri çevirdi', false],
      ['Kerem', '−1', false],
      ['Yusuf', '−1', true],
    ]);
  });

  test('Çift Ateş + chain + elimination: −2 · çıktı and −2 · zincir, 4 s', () => {
    const s0 = withShields(setup({ n: 4, chambers: 'LBB', hands: { p1: ['double'] }, hp: { p4: 2 } }), {}, [['p4', 'p3']]);
    const { events } = play(s0, use('p1', 'double'), shoot('p1', 'p4'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.double, true);
    assert.deepEqual(rowsOf(notice), [['Zeynep', '−2 · çıktı', false], ['Yusuf', '−2', true]]);
    assert.equal(notice.durationMs, SHOT_NOTICE_BASE_MS + SHOT_NOTICE_ROW_MS);
  });
});

describe('shotNotice: hidden tools never show', () => {
  const HIDDEN = /Mermi Çevir|Hokkabaz|Kaydır|flip|swap|skip|ters|kaydır/i;

  for (const [tool, chambers, expectWord] of [['flip', 'LBB', 'Boş'], ['skip', 'LBB', 'Boş'], ['swap', 'LBB', 'Boş']]) {
    test(`${toolName(tool)} before the shot: the notice equals the one built from public events only`, () => {
      const { events } = play(setup({ chambers, hands: { p1: [tool] } }), use('p1', tool), shoot('p1', 'p2'));
      assert.ok(events.some((e) => e.visibility !== 'public'), 'the hidden tool left private events');
      const notice = shotNotice(events, nameOf);
      assert.deepEqual(notice, shotNotice(events.filter((e) => e.visibility === 'public'), nameOf));
      assert.equal(notice.word, expectWord);
      assert.doesNotMatch(JSON.stringify(notice), HIDDEN);
    });
  }

  test('a flipped Dolu looks exactly like a real Boş (same notice)', () => {
    const flipped = play(setup({ chambers: 'LBB', hands: { p1: ['flip'] } }), use('p1', 'flip'), shoot('p1', 'p2')).events;
    const real = act(setup({ chambers: 'BLB' }), shoot('p1', 'p2')).events;
    assert.deepEqual(shotNotice(flipped, nameOf), shotNotice(real, nameOf));
  });

  test('only the last shot of an update is shown', () => {
    const { events } = play(setup({ chambers: 'BLBB' }), shoot('p1', 'p2'), shoot('p2', 'p3'));
    const notice = shotNotice(events, nameOf);
    assert.equal(notice.shooter, 'Selin');
    assert.equal(notice.target, 'Yusuf');
  });
});
