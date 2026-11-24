// Game UI, around a running match (task 4.2b): the spectator strip, who sees the kick button,
// the live Tablo ("Bu maç" from this device's view and events), the end screen's result and
// ranking, and the engine default without the confirmation step (decision 55).
// No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createMatch, eventsFor, listLegalActions, viewFor } from '../src/engine/index.js';
import { summarizeMatch, summarizeView } from '../src/rooms/index.js';
import { t } from '../src/ui/i18n/i18n.js';
import { liveMatchView } from '../src/ui/tablo-model.js';
import { canKick, endHeadline, endRanking, lastShotVictims, outRounds, targetsFrom, watchStrip } from '../src/ui/table-model.js';

const pub = (type, data = {}) => ({ type, ...data, visibility: 'public' });
const names = { s01: 'Malik', s02: 'Kerem', s03: 'Zeynep', s04: 'Selin' };
const nameOf = (id) => names[id] ?? id;
const IDS = ['s01', 's02', 's03'];

// Plays a classic match to its end with first-legal-target shots (no preference anywhere), and
// keeps every seat's events as watchMatch would deliver them.
function playToEnd(seed = 3, ids = IDS) {
  let { state, events } = createMatch({ mode: 'classic', hp: 1, randomizeSeats: false }, ids.map((id) => ({ id })), seed);
  const seen = Object.fromEntries(ids.map((id) => [id, eventsFor(events, id)]));
  const log = [events];
  for (let i = 0; i < 500 && state.status === 'active'; i += 1) {
    const action = listLegalActions(state, state.turn.playerId).find((a) => a.type === 'chooseTarget' && a.target !== state.turn.playerId);
    const res = applyAction(state, action);
    assert.ok(res.ok, res.error?.message);
    state = res.state;
    log.push(res.events);
    for (const id of ids) seen[id].push(...eventsFor(res.events, id));
  }
  assert.equal(state.status, 'ended');
  return { state, seen, log };
}

describe('the engine default: no confirmation step (decision 55)', () => {
  test('players start with confirmShot false, so ONE chooseTarget fires (the first shot is one write)', () => {
    const { state } = createMatch({ mode: 'classic' }, IDS.map((id) => ({ id })), 9);
    for (const p of state.players) assert.equal(p.confirmShot, false);
    const shooter = state.turn.playerId;
    const before = viewFor(state, shooter);
    assert.equal(before.self.confirmShot, false);
    const res = applyAction(state, { type: 'chooseTarget', playerId: shooter, target: targetsFrom(listLegalActions(state, shooter)).find((t) => t !== shooter) });
    assert.ok(res.ok);
    assert.equal(res.events.filter((e) => e.type === 'shot').length, 1);
    assert.equal(res.state.phase.type === 'confirm', false);
  });

  test('the option itself is still in the engine (createMatch and setPreference)', () => {
    const { state } = createMatch({ mode: 'classic' }, [{ id: 's01', confirmShot: true }, { id: 's02' }, { id: 's03' }], 9);
    assert.equal(state.players.find((p) => p.id === 's01').confirmShot, true);
    const pref = applyAction(state, { type: 'setPreference', playerId: 's02', confirmShot: true });
    assert.equal(pref.ok, true);
    assert.equal(pref.state.players.find((p) => p.id === 's02').confirmShot, true);
  });
});

describe('spectators and kicking', () => {
  const view = (role, status = 'active') => ({ role, status, players: [{ id: 's01', alive: true }, { id: 's02', alive: true }, { id: 's03', alive: false }] });

  test('the strip: none for a living player, "İzliyorsun" when out, the late-joiner text for a waiting seat', () => {
    assert.equal(watchStrip(view('alive')), null);
    assert.equal(watchStrip(view('eliminated')), 'İzliyorsun');
    assert.equal(watchStrip(view('ghost')), 'İzliyorsun');
    assert.equal(watchStrip(view('spectator')), 'İzliyorsun · sonraki maçı bekliyorsun');
    assert.equal(watchStrip(view('eliminated', 'ended')), null, 'the end screen takes over');
  });

  test('only the host sees the kick button, only on another living, disconnected seat, only during the match', () => {
    const v = view('alive');
    assert.equal(canKick({ view: v, seatId: 's02', mySeat: 's01', hostSeat: 's01', present: false }), true);
    assert.equal(canKick({ view: v, seatId: 's02', mySeat: 's04', hostSeat: 's01', present: false }), false, 'not the host');
    assert.equal(canKick({ view: v, seatId: 's02', mySeat: 's01', hostSeat: 's01', present: true }), false, 'connected');
    assert.equal(canKick({ view: v, seatId: 's01', mySeat: 's01', hostSeat: 's01', present: false }), false, 'own seat');
    assert.equal(canKick({ view: v, seatId: 's03', mySeat: 's01', hostSeat: 's01', present: false }), false, 'already out');
    assert.equal(canKick({ view: view('alive', 'ended'), seatId: 's02', mySeat: 's01', hostSeat: 's01', present: false }), false);
    assert.equal(canKick({ view: v, seatId: 's09', mySeat: 's01', hostSeat: 's01', present: false }), false, 'not in the match');
  });
});

describe('the live Tablo', () => {
  test('from a seat\'s own view and events it equals the room layer\'s summary of the finished match', () => {
    const { state, seen, log } = playToEnd();
    const fromLog = summarizeMatch({ n: 1, state, log: Object.fromEntries(log.map((events, i) => [String(i), JSON.stringify(events)])) });
    for (const id of IDS) {
      assert.deepEqual(summarizeView({ n: 1, view: viewFor(state, id), events: seen[id] }), fromLog, id);
    }
  });

  test('during the match: tur, players in and mode in the header; living rows "oyunda" on top, then the last out', () => {
    const created = createMatch({ mode: 'classic', randomizeSeats: false }, ['s01', 's02', 's03', 's04'].map((id) => ({ id })), 2);
    const view = viewFor(created.state, 's01');
    const events = [
      ...eventsFor(created.events, 's01'),
      pub('shot', { shooter: 's01', target: 's02', effect: 'live', auto: false, doubled: false, hits: [] }),
      pub('roundEnded', { round: 1, shots: 1, survivors: ['s01', 's02', 's03', 's04'] }),
      pub('reloaded', { round: 2 }),
      pub('playerRemoved', { player: 's04' }),
      pub('eliminated', { player: 's03', by: 's01', round: 2 }),
    ];
    const players = view.players.map((p) => (p.id === 's03' || p.id === 's04' ? { ...p, alive: false } : p));
    const live = liveMatchView(summarizeView({ n: 1, view: { ...view, players }, events }), {
      mySeat: 's01', names, present: (id) => id !== 's02', round: 2, ended: false,
    });
    assert.equal(live.header, '2. tur · 2 / 4 oyunda · Klasik');
    assert.deepEqual(live.rows.map((r) => r.seatId), ['s01', 's02', 's03', 's04']);
    assert.equal(live.rows[0].statusText, 'oyunda');
    assert.equal(live.rows[0].me, true);
    assert.equal(live.rows[1].statusText, 'bağlantı yok · oyunda');
    assert.equal(live.rows[2].statusText, '2. turda çıktı');
    assert.equal(live.rows[3].statusText, '2. turda masadan çıkarıldı');
    assert.equal(live.rows[0].displayName, 'Malik');
  });

  test('only public information: a private event changes nothing', () => {
    const created = createMatch({ mode: 'classic', randomizeSeats: false }, IDS.map((id) => ({ id })), 2);
    const view = viewFor(created.state, 's01');
    const base = eventsFor(created.events, 's01');
    const priv = { type: 'toolUsed', tool: 'detector', by: 's01', chamber: 'live', visibility: 'private', to: ['s01'] };
    assert.deepEqual(summarizeView({ n: 1, view, events: [...base, priv] }), summarizeView({ n: 1, view, events: base }));
  });
});

describe('the end screen', () => {
  test('the winner sees "Kazandın"; the others "Kazanan: X" and the round they went out', () => {
    const { state, seen } = playToEnd();
    const winner = state.result.winner;
    const loser = IDS.find((id) => id !== winner);
    const outs = outRounds(seen[loser]);
    const mine = endHeadline(viewFor(state, winner), nameOf, outRounds(seen[winner]));
    assert.deepEqual(mine, { title: 'Kazandın', line: t('end.endMine'), sub: '' });
    const theirs = endHeadline(viewFor(state, loser), nameOf, outs);
    assert.equal(theirs.title, `Kazanan: ${nameOf(winner)}`);
    assert.equal(theirs.line, `Sen ${outs[loser].round}. turda çıktın.`);
    assert.equal(theirs.sub, `Son çayı ${nameOf(winner)} içti.`);
    // A seat that joined during the match watched it.
    assert.equal(endHeadline(viewFor(state, null), nameOf, {}).line, t('end.endWatched'));
    assert.equal(endHeadline({ ...viewFor(state, null), status: 'active' }, nameOf, {}), null);
  });

  test('a draw: "Berabere", "Kimse kazanmadı."', () => {
    const view = { status: 'ended', viewer: 's01', result: { type: 'draw', winner: null } };
    assert.deepEqual(endHeadline(view, nameOf, {}), { title: 'Berabere', line: 'Kimse kazanmadı.', sub: t('end.endDrawLine') });
  });

  test('a player removed by the host is told so', () => {
    const view = { status: 'ended', viewer: 's02', result: { type: 'win', winner: 's01' } };
    assert.equal(endHeadline(view, nameOf, { s02: { round: 3, removed: true } }).line, 'Sen 3. turda maçtan çıkarıldın.');
  });

  test('the ranking: places, "kazandı · N tur", the match points and the session total once stored', () => {
    const { state, seen } = playToEnd();
    const summary = summarizeView({ n: 1, view: viewFor(state, 's01'), events: seen.s01 });
    const pending = endRanking(summary, { mySeat: 's01', nameOf, session: { matches: 0, rows: [] }, events: seen.s01 });
    assert.deepEqual(pending.map((r) => r.place), [1, 2, 3]);
    assert.equal(pending[0].seatId, state.result.winner);
    assert.equal(pending[0].status, `kazandı · ${summary.rounds} tur`);
    assert.ok(pending.every((r) => r.total === ''), 'no total before the result is stored');
    assert.equal(pending.filter((r) => r.me).length, 1);
    const session = { matches: 1, rows: summary.rows.map((r) => ({ seatId: r.seatId, points: r.points + 10 })) };
    const stored = endRanking(summary, { mySeat: 's01', nameOf, session, events: seen.s01 });
    assert.equal(stored[0].total, `toplam ${summary.rows[0].points + 10}`);
    assert.equal(stored[0].points, summary.rows[0].points);
  });

  test('a draw: the players taken by the last shot share the first place', () => {
    const events = [
      pub('shot', { shooter: 's01', target: 's02', effect: 'live' }),
      pub('eliminated', { player: 's04', round: 2 }),
      pub('shot', { shooter: 's02', target: 's03', effect: 'live' }),
      pub('eliminated', { player: 's03', round: 3 }),
      pub('eliminated', { player: 's02', round: 3 }),
      pub('matchEnded', { result: 'draw', winner: null }),
    ];
    assert.deepEqual(lastShotVictims(events), ['s03', 's02']);
    const summary = {
      n: 2, rounds: 3, result: 'draw',
      rows: [
        { seatId: 's02', status: 'eliminated', outRound: 3, points: 4 },
        { seatId: 's03', status: 'eliminated', outRound: 3, points: 2 },
        { seatId: 's04', status: 'eliminated', outRound: 2, points: -1 },
      ],
    };
    const rows = endRanking(summary, { mySeat: 's04', nameOf, session: null, events });
    assert.deepEqual(rows.map((r) => [r.seatId, r.place, r.status]), [
      ['s02', 1, 'berabere · 3 tur'],
      ['s03', 1, 'berabere · 3 tur'],
      ['s04', 3, '2. turda çıktı'],
    ]);
  });
});
