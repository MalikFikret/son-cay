// Away from the table (decision Q70): the "Masaya dön" bar state on Giriş and the
// one-table-per-player guard (src/ui/home-model.js). The match views come from the real engine.
// No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFor } from '../src/engine/index.js';
import { BAR, homeBarState, tableGuard } from '../src/ui/home-model.js';
import { act, setup, shoot } from './helpers.js';

const held = { code: 'ABC234', seatId: 'p1' };

describe('homeBarState', () => {
  test('hidden without a seat, for a bad code, a closed room or a lost seat', () => {
    assert.deepEqual(homeBarState({ held: null }), { kind: BAR.HIDDEN, code: null });
    assert.equal(homeBarState({ held: { code: 'nope', seatId: 'p1' } }).kind, BAR.HIDDEN);
    assert.equal(homeBarState({ held: { code: 'ABC234' } }).kind, BAR.HIDDEN);
    assert.equal(homeBarState({ held, roomGone: true }).kind, BAR.HIDDEN);
    assert.equal(homeBarState({ held, seatLost: true }).kind, BAR.HIDDEN);
    const view = viewFor(setup({ turn: 'p1' }), 'p1');
    assert.equal(homeBarState({ held, roomGone: true, view }).kind, BAR.HIDDEN, 'even on my turn');
  });

  test('neutral in the waiting room (no match yet) and while someone else has the turn', () => {
    assert.deepEqual(homeBarState({ held }), { kind: BAR.NEUTRAL, code: 'ABC234' });
    assert.equal(homeBarState({ held, view: viewFor(setup({ turn: 'p2' }), 'p1') }).kind, BAR.NEUTRAL);
  });

  test('my turn in a running match: red', () => {
    assert.deepEqual(homeBarState({ held, view: viewFor(setup({ turn: 'p1' }), 'p1') }), { kind: BAR.MY_TURN, code: 'ABC234' });
  });

  test('neutral once I am out, and after the match ended', () => {
    const out = act(setup({ chambers: 'LBB', hp: { p2: 1 }, turn: 'p1' }), shoot('p1', 'p2')).state;
    // p2 is out; even if the turn pointed at p2, the bar is not red for them.
    assert.equal(homeBarState({ held: { code: 'ABC234', seatId: 'p2' }, view: viewFor(out, 'p2') }).kind, BAR.NEUTRAL);
    const ended = act(setup({ n: 3, chambers: 'LLB', hp: { p2: 1, p3: 1 }, turn: 'p1' }), shoot('p1', 'p2')).state;
    const last = act(ended, shoot('p3', 'p3')).state;
    assert.equal(last.status, 'ended');
    assert.equal(homeBarState({ held, view: viewFor(last, 'p1') }).kind, BAR.NEUTRAL);
  });

  test('a spectator (waiting seat) view is never my turn', () => {
    const view = viewFor(setup({ turn: 'p1' }), null);
    assert.equal(homeBarState({ held: { code: 'ABC234', seatId: 's09' }, view }).kind, BAR.NEUTRAL);
  });
});

describe('tableGuard (one table per player)', () => {
  test('not seated: everything is allowed', () => {
    for (const intent of ['create', 'join', 'recover']) {
      assert.deepEqual(tableGuard({ heldCode: null, intent, code: 'XYZ789' }), { allowed: true, sameTable: false, message: null });
    }
  });

  test('seated: creating, joining or recovering at another table is refused with "Önce masana dön."', () => {
    for (const intent of ['create', 'join', 'recover']) {
      const guard = tableGuard({ heldCode: 'ABC234', intent, code: 'XYZ789' });
      assert.equal(guard.allowed, false, intent);
      assert.equal(guard.message, 'Önce masana dön.');
    }
    assert.equal(tableGuard({ heldCode: 'ABC234', intent: 'create' }).allowed, false);
  });

  test('seated: my own table (code or invite link) is allowed and marked as the same table', () => {
    assert.deepEqual(tableGuard({ heldCode: 'ABC234', intent: 'join', code: 'ABC234' }), { allowed: true, sameTable: true, message: null });
    assert.deepEqual(tableGuard({ heldCode: 'ABC234', intent: 'recover', code: 'ABC234' }), { allowed: true, sameTable: true, message: null });
  });
});
