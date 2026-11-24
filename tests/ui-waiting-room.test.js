// Game UI, waiting room (step 4.1c): moving a seat up / down, the player options each viewer
// gets, the start check, the player list in the saved order, and the Tablo display values.
// No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { moveSeat, playerOptions, playerRows, startCheck } from '../src/ui/lobby-model.js';
import { breakdownLines, formatSigned, matchView, sessionView, statusText } from '../src/ui/tablo-model.js';
import { errorMessage } from '../src/ui/messages.js';
import { t } from '../src/ui/i18n/i18n.js';
import { ROOM_ERR } from '../src/rooms/index.js';

const seat = (name, joinedAt) => ({ uid: 'u', name, joinedAt });

describe('seat order editing', () => {
  test('up and down swap with the neighbour; the ends do not move; the input is not changed', () => {
    const order = ['s01', 's02', 's03'];
    assert.deepEqual(moveSeat(order, 1, -1), ['s02', 's01', 's03']);
    assert.deepEqual(moveSeat(order, 1, +1), ['s01', 's03', 's02']);
    assert.equal(moveSeat(order, 0, -1), order);
    assert.equal(moveSeat(order, 2, +1), order);
    assert.equal(moveSeat(order, 7, -1), order);
    assert.deepEqual(order, ['s01', 's02', 's03']);
  });

  test('the player list follows the saved order; newcomers after the save come last', () => {
    const seats = { s01: seat('Malik', 1), s02: seat('Selin', 2), s03: seat('Yusuf', 3), s04: seat('Kerem', 50) };
    const base = { seats, presence: {}, scores: {}, hostSeat: 's01', mySeat: 's02' };
    assert.deepEqual(playerRows(base).map((r) => r.name), ['Malik', 'Selin', 'Yusuf', 'Kerem']);
    const seatOrder = { seats: ['s03', 's01', 's04', 's02'], savedAt: 10 };
    assert.deepEqual(playerRows({ ...base, seatOrder }).map((r) => r.name), ['Yusuf', 'Malik', 'Selin', 'Kerem']);
  });
});

describe('player options', () => {
  const lobby = { mySeat: 's01', hostSeat: 's01', inLobby: true };
  test('the host: rename for everyone, hand over and remove for the others', () => {
    assert.deepEqual(playerOptions({ seatId: 's01' }, lobby), ['rename']);
    assert.deepEqual(playerOptions({ seatId: 's02' }, lobby), ['rename', 'handOver', 'kick']);
  });
  test('a player: only their own rename; nothing during a match', () => {
    const player = { mySeat: 's02', hostSeat: 's01', inLobby: true };
    assert.deepEqual(playerOptions({ seatId: 's02' }, player), ['rename']);
    assert.deepEqual(playerOptions({ seatId: 's01' }, player), []);
    assert.deepEqual(playerOptions({ seatId: 's02' }, { ...lobby, inLobby: false }), []);
    assert.deepEqual(playerOptions({ seatId: 's02' }, { ...player, inLobby: false }), []);
  });
});

describe('start check', () => {
  test('3 or more seated players can start; the absent ones are listed', () => {
    const rows = [{ name: 'A', present: true }, { name: 'B', present: false }];
    assert.deepEqual(startCheck(rows), { canStart: false, absent: [rows[1]] });
    const three = [...rows, { name: 'C', present: true }];
    assert.equal(startCheck(three).canStart, true);
    assert.deepEqual(startCheck(three).absent.map((r) => r.name), ['B']);
  });
  test('start errors have Turkish messages', () => {
    for (const code of [ROOM_ERR.NOT_ENOUGH_PLAYERS, ROOM_ERR.INVALID_SETTINGS, ROOM_ERR.WRITE_DENIED, ROOM_ERR.NOT_IN_LOBBY, ROOM_ERR.INVALID_SEAT_ORDER]) {
      assert.ok(errorMessage(code).length > 0 && !errorMessage(code).includes(code));
    }
  });
});

// A summarizeMatch-like row.
function row(seatId, status, points, extra = {}) {
  const breakdown = {
    liveOnOther: { count: 2, points: 2 },
    blankOnOther: { count: 1, points: -1 },
    blankOnSelf: { count: 1, points: 2 },
    liveOnSelf: { count: 0, points: 0 },
    eliminations: { count: 0, points: 0 },
    rounds: { count: 2, points: 8 },
    win: { points: 0 },
    predictions: { count: 0, points: 0 },
  };
  return { seatId, status, points, outRound: null, roundsSurvived: 2, hp: 3, breakdown, name: seatId.toUpperCase(), ...extra };
}

describe('Tablo values', () => {
  test('signed points use a real minus sign', () => {
    assert.equal(formatSigned(3), '+3');
    assert.equal(formatSigned(-1), '−1');
    assert.equal(formatSigned(0), '0');
    assert.equal(formatSigned(undefined), '0');
  });

  test('status lines', () => {
    assert.equal(statusText(row('s01', 'won', 1), 'win'), 'Kazandı');
    assert.equal(statusText(row('s02', 'eliminated', 1, { outRound: 2 }), 'win'), '2. turda çıktı');
    assert.equal(statusText(row('s03', 'removed', 0, { outRound: 1 }), 'win'), '1. turda masadan çıkarıldı');
  });

  test('breakdown lines in the design order, total last', () => {
    const lines = breakdownLines(row('s01', 'eliminated', 11), 'classic');
    assert.deepEqual(lines.map((l) => l.label), [
      'Başkasına dolu', 'Başkasına boş', 'Kendine boş', 'Kendine dolu', 'Eleme', 'Tur sonu (2 tur)', 'Kazanma (maç sonunda)', 'Toplam',
    ]);
    assert.deepEqual(lines.map((l) => l.points), ['+2', '−1', '+2', '0', '0', '+8', '—', '11']);
    assert.deepEqual(lines.map((l) => l.count).slice(0, 5), ['2 kez', '1 kez', '1 kez', '—', '—']);
    assert.ok(breakdownLines(row('s01', 'won', 1), 'custom').some((l) => l.label === 'Tahmin'));
  });

  test('"Bu maç": the summary order is kept, a player who left is named as such, glasses only for the living', () => {
    const summary = {
      n: 3, rounds: 4, mode: 'classic', result: 'win', winner: 's02', startHp: 5,
      rows: [row('s02', 'won', 20), row('s01', 'eliminated', 9, { outRound: 4 }), row('s03', 'eliminated', 5, { outRound: 2, name: null })],
    };
    const view = matchView(summary, 's01');
    assert.equal(view.header, 'Maç 3 · 4 tur · Klasik');
    assert.deepEqual(view.rows.map((r) => [r.rank, r.displayName, r.statusText]), [
      [1, 'S02', 'Kazandı'], [2, 'S01', '4. turda çıktı'], [3, t('tablo.leftPlayer'), '2. turda çıktı'],
    ]);
    assert.deepEqual(view.rows.map((r) => r.me), [false, true, false]);
    assert.deepEqual(view.rows[0].glasses, { full: 3, total: 5 });
    assert.equal(view.rows[1].glasses, null);
    assert.equal(matchView(null, 's01'), null);
  });

  test('"Oturum": ranked rows with names, wins and the last match', () => {
    const session = { matches: 3, rows: [
      { seatId: 's02', points: 58, matches: 3, wins: 1, last: 14 },
      { seatId: 's01', points: 51, matches: 3, wins: 1, last: -2 },
      { seatId: 's04', points: 0, matches: 0, wins: 0, last: null },
    ] };
    const view = sessionView(session, { s01: 'Malik', s02: 'Selin', s04: 'Kerem' }, 's01');
    assert.equal(view.header, '3 maç oynandı · bekleme salonu');
    assert.deepEqual(view.rows.map((r) => [r.rank, r.displayName, r.lastText, r.me]), [
      [1, 'Selin', '+14', false], [2, 'Malik', '−2', true], [3, 'Kerem', '', false],
    ]);
    assert.equal(sessionView({ matches: 0, rows: [] }, {}, 's01').header, 'Henüz maç oynanmadı.');
  });
});
