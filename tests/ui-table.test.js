// Game UI, match table: seat placement around the table, the revolver's direction, target
// selection, the fire button's press (quick / long / slide-out / timeout), the reload
// announcement, the last-move line and the countdown (src/ui/table-model.js, src/ui/fire-press.js).
// No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAction, createMatch, eventsFor, listLegalActions, viewFor } from '../src/engine/index.js';
import { LONG_PRESS_MS, PRESS, initialPress, isPressing, pressStep } from '../src/ui/fire-press.js';
import { TEXT } from '../src/ui/messages.js';
import {
  SEAT_SIZES,
  STAGE_WIDTH,
  aimAngle,
  directionArrows,
  keepTarget,
  lastMove,
  msLeft,
  nearestAngle,
  outRounds,
  placeSeats,
  pointsLeft,
  reloadFor,
  reloadText,
  revolverSeat,
  seatLayout,
  seatSizeFor,
  seatTags,
  secondsShown,
  shotsIn,
  statusText,
  tapTarget,
  targetsFrom,
} from '../src/ui/table-model.js';

const pub = (type, data = {}) => ({ type, ...data, visibility: 'public' });
const names = { s01: 'Malik', s02: 'Kerem', s03: 'Selin', s04: 'Zeynep' };
const nameOf = (id) => names[id] ?? id;

describe('seats around the table', () => {
  test('seat 0 of the layout is the bottom centre, then clockwise on the screen (left first)', () => {
    const { points, height } = seatLayout(6);
    assert.deepEqual(points[0], { x: STAGE_WIDTH / 2, y: height - 38 });
    assert.ok(points[1].x < STAGE_WIDTH / 2 && points[1].y < points[0].y, 'second seat on the left');
    assert.equal(points[3].x, STAGE_WIDTH / 2, 'opposite seat at the top centre');
    assert.ok(points[3].y < points[2].y);
    assert.ok(points[5].x > STAGE_WIDTH / 2, 'last seat on the right');
  });

  test('the six-seat layout is close to the approved mock (bottom, two left, top, two right)', () => {
    const mock = [[195, 382], [64, 318], [64, 120], [195, 50], [326, 120], [326, 318]];
    seatLayout(6).points.forEach((p, i) => {
      assert.ok(Math.abs(p.x - mock[i][0]) <= 4, `x of seat ${i}`);
      assert.ok(Math.abs(p.y - mock[i][1]) <= 32, `y of seat ${i}`);
    });
  });

  test('for 3 to 15 players no two seat boxes overlap and every box stays on the stage', () => {
    for (let count = 1; count <= 15; count += 1) {
      const layout = seatLayout(count);
      const box = SEAT_SIZES[layout.size];
      assert.equal(layout.points.length, count);
      assert.equal(layout.width, box.width);
      for (const p of layout.points) {
        assert.ok(p.x - box.width / 2 >= 0 && p.x + box.width / 2 <= STAGE_WIDTH, `${count}: x ${p.x}`);
        assert.ok(p.y - box.height / 2 >= 0 && p.y + box.height / 2 <= layout.height, `${count}: y ${p.y}`);
      }
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const a = layout.points[i];
          const b = layout.points[j];
          const apart = Math.abs(a.x - b.x) >= box.width - 0.5 || Math.abs(a.y - b.y) >= box.height - 0.5;
          assert.ok(apart, `${count} players: seats ${i} and ${j} overlap`);
        }
      }
    }
  });

  test('more players get smaller seats', () => {
    assert.equal(seatSizeFor(3), 'large');
    assert.equal(seatSizeFor(6), 'large');
    assert.equal(seatSizeFor(7), 'medium');
    assert.equal(seatSizeFor(10), 'medium');
    assert.equal(seatSizeFor(11), 'small');
    assert.equal(seatSizeFor(15), 'small');
  });

  test('placeSeats puts the viewer at the bottom and the next seats (engine order) clockwise', () => {
    const players = [{ id: 's03', seat: 2 }, { id: 's01', seat: 0 }, { id: 's04', seat: 3 }, { id: 's02', seat: 1 }];
    assert.deepEqual(placeSeats(players, 's03').map((p) => p.id), ['s03', 's04', 's01', 's02']);
    const spots = placeSeats(players, 's03');
    assert.deepEqual({ x: spots[0].x, y: spots[0].y }, seatLayout(4).points[0]);
  });

  test('a spectator (or an unknown viewer) sees seat 0 at the bottom', () => {
    const players = [{ id: 's02', seat: 1 }, { id: 's01', seat: 0 }, { id: 's04', seat: 2 }];
    assert.deepEqual(placeSeats(players, null).map((p) => p.id), ['s01', 's02', 's04']);
    assert.deepEqual(placeSeats(players, 's09').map((p) => p.id), ['s01', 's02', 's04']);
  });

  test('the turn-direction arrows: two arcs, drawn the other way for a reversed direction', () => {
    const cw = directionArrows(195, 210, 146, 1);
    const ccw = directionArrows(195, 210, 146, -1);
    assert.equal(cw.length, 2);
    assert.match(cw[0].arc, / 0 0 1 /);
    assert.match(ccw[0].arc, / 0 0 0 /);
    assert.notEqual(cw[0].head, ccw[0].head);
  });
});

describe('the revolver', () => {
  test('points from the table centre at a seat (0 = right, 90 = down), like the mock', () => {
    const center = { x: 195, y: 210 };
    assert.ok(Math.abs(aimAngle(center, { x: 326, y: 318 }) - 39.5) < 1, 'mock 3: target Yusuf, 40 deg');
    assert.ok(Math.abs(aimAngle(center, { x: 326, y: 120 }) + 34.5) < 1, 'mock 4: current player Zeynep, -34.5 deg');
    assert.equal(aimAngle(center, { x: 195, y: 382 }), 90);
  });

  test('turns the short way, and is mirrored when it points to the left', () => {
    assert.equal(nearestAngle(170, -170), 190);
    assert.equal(nearestAngle(-170, 170), -190);
    assert.equal(nearestAngle(NaN, 40), 40);
    assert.equal(pointsLeft(180), true);
    assert.equal(pointsLeft(190 - 360), true);
    assert.equal(pointsLeft(40), false);
    assert.equal(pointsLeft(90), false);
  });

  test('points at my chosen target on my screen, otherwise at the current player (or the looter)', () => {
    const view = { turn: { playerId: 's02' }, phase: { type: 'turn' } };
    assert.equal(revolverSeat({ target: 's04', view }), 's04');
    assert.equal(revolverSeat({ target: null, view }), 's02');
    assert.equal(revolverSeat({ target: null, view: { ...view, phase: { type: 'loot', queue: [{ looter: 's03', victim: 's01' }] } } }), 's03');
  });
});

describe('target selection', () => {
  const legal = [
    { type: 'chooseTarget', playerId: 's01', target: 's01' },
    { type: 'chooseTarget', playerId: 's01', target: 's02' },
    { type: 'chooseTarget', playerId: 's01', target: 's03' },
    { type: 'useTool', playerId: 's01', tool: 'jail', target: 's04' },
  ];

  test('the targets are the chooseTarget legal actions: living players, myself included', () => {
    assert.deepEqual(targetsFrom(legal), ['s01', 's02', 's03']);
    assert.deepEqual(targetsFrom([]), []);
    assert.deepEqual(targetsFrom(null), []);
  });

  test('there is no default target; a tap picks a seat (or myself), a second tap clears it', () => {
    const targets = targetsFrom(legal);
    let target = null;
    target = tapTarget(target, 's02', targets);
    assert.equal(target, 's02');
    target = tapTarget(target, 's01', targets);
    assert.equal(target, 's01', 'my own seat: a shot at myself');
    assert.equal(tapTarget(target, 's01', targets), null);
  });

  test('a seat that cannot be shot at (eliminated, not my turn) is ignored', () => {
    assert.equal(tapTarget(null, 's04', ['s01', 's02']), null);
    assert.equal(tapTarget('s02', 's04', ['s01', 's02']), 's02');
    assert.equal(tapTarget(null, 's02', []), null, 'not my turn: no targets at all');
  });

  test('the target is dropped when it can no longer be shot at', () => {
    assert.equal(keepTarget('s02', ['s01', 's02']), 's02');
    assert.equal(keepTarget('s02', ['s01']), null);
    assert.equal(keepTarget(null, ['s01']), null);
    assert.equal(keepTarget('s02', []), null);
  });

  test('a real match: my legal targets are the living players, and only on my turn', () => {
    const { state } = createMatch({ mode: 'classic', randomizeSeats: false }, [{ id: 's01' }, { id: 's02' }, { id: 's03' }], 7);
    const turn = state.turn.playerId;
    const other = ['s01', 's02', 's03'].find((id) => id !== turn);
    assert.deepEqual(targetsFrom(listLegalActions(state, turn)).sort(), ['s01', 's02', 's03']);
    assert.deepEqual(targetsFrom(listLegalActions(state, other)), []);
  });
});

describe('the fire button press', () => {
  const down = (state, at = 0, enabled = true) => pressStep(state, { type: 'down', at, enabled });

  test('a quick press fires at once when released inside', () => {
    let { state, effect } = down(initialPress(), 1000);
    assert.equal(state.phase, PRESS.DOWN);
    assert.equal(effect, null);
    ({ state, effect } = pressStep(state, { type: 'up', at: 1000 + LONG_PRESS_MS - 1, inside: true }));
    assert.deepEqual(effect, { fire: 'quick' });
    assert.equal(state.phase, PRESS.IDLE);
  });

  test('a long press cocks the hammer, stays cocked, and fires when released inside', () => {
    let { state } = down(initialPress(), 0);
    let effect;
    ({ state, effect } = pressStep(state, { type: 'hold', at: LONG_PRESS_MS - 10 }));
    assert.equal(effect, null, 'too early: not cocked yet');
    assert.equal(state.phase, PRESS.DOWN);
    ({ state, effect } = pressStep(state, { type: 'hold', at: LONG_PRESS_MS }));
    assert.equal(effect, 'cock');
    assert.equal(state.phase, PRESS.COCKED);
    ({ state, effect } = pressStep(state, { type: 'hold', at: 5000 }));
    assert.equal(state.phase, PRESS.COCKED, 'stays cocked while held');
    assert.equal(effect, null);
    ({ state, effect } = pressStep(state, { type: 'up', at: 6000, inside: true }));
    assert.deepEqual(effect, { fire: 'long' });
    assert.equal(isPressing(state), false);
  });

  test('a long release counts as long even if the hold timer was late', () => {
    const { state } = down(initialPress(), 0);
    assert.deepEqual(pressStep(state, { type: 'up', at: LONG_PRESS_MS + 50, inside: true }).effect, { fire: 'long' });
  });

  test('sliding the finger out of the button uncocks and cancels (nothing fires)', () => {
    for (const cocked of [false, true]) {
      let { state } = down(initialPress(), 0);
      if (cocked) ({ state } = pressStep(state, { type: 'hold', at: LONG_PRESS_MS }));
      let effect;
      ({ state, effect } = pressStep(state, { type: 'leave' }));
      assert.equal(effect, 'cancel');
      assert.equal(state.phase, PRESS.IDLE);
      ({ state, effect } = pressStep(state, { type: 'up', at: 9000, inside: true }));
      assert.equal(effect, null, 'the later release does nothing');
    }
  });

  test('releasing outside the button cancels', () => {
    const { state } = down(initialPress(), 0);
    assert.equal(pressStep(state, { type: 'up', at: 100, inside: false }).effect, 'cancel');
  });

  test('time running out during a press cancels it (the clock sends the timeout)', () => {
    let { state } = down(initialPress(), 0);
    ({ state } = pressStep(state, { type: 'hold', at: LONG_PRESS_MS }));
    let effect;
    ({ state, effect } = pressStep(state, { type: 'expire' }));
    assert.equal(effect, 'cancel');
    assert.equal(state.phase, PRESS.IDLE);
    assert.equal(pressStep(state, { type: 'up', at: 10, inside: true }).effect, null);
  });

  test('a disabled button (no target, not my turn) ignores the press', () => {
    const { state, effect } = down(initialPress(), 0, false);
    assert.equal(state.phase, PRESS.IDLE);
    assert.equal(effect, null);
    assert.equal(pressStep(state, { type: 'up', at: 10, inside: true }).effect, null);
    assert.equal(pressStep(state, { type: 'expire' }).effect, null);
  });

  test('a second finger while pressing changes nothing', () => {
    const first = down(initialPress(), 0).state;
    assert.equal(down(first, 50).state, first);
  });
});

describe('the reload announcement', () => {
  test('shows the announced counts only: "3 Dolu · 3 Boş"', () => {
    assert.deepEqual(reloadText({ live: 3, blank: 3, total: 6 }), { live: '3 Dolu', blank: '3 Boş', text: '3 Dolu · 3 Boş' });
    assert.equal(reloadText({ live: 2, blank: 5 }).text, '2 Dolu · 5 Boş');
    assert.doesNotMatch(reloadText({ live: 4, blank: 1, total: 5 }).text, /5/);
    assert.equal(reloadText(null), null);
    assert.equal(reloadText({ live: 'x', blank: 1 }), null);
  });

  test('comes with a reloaded event, and at the start of a round when the page is (re)opened', () => {
    const view = (shots, status = 'active') => ({ status, round: { index: 2, shots, announced: { total: 5, live: 2, blank: 3 } } });
    assert.equal(reloadFor({ initial: true, view: view(0), events: [] }).text, '2 Dolu · 3 Boş');
    assert.equal(reloadFor({ initial: true, view: view(1), events: [] }), null, 'mid-round reload of the page');
    assert.equal(reloadFor({ initial: false, view: view(0), events: [pub('shot'), pub('reloaded', { round: 3, total: 4, live: 1, blank: 3 })] }).text, '1 Dolu · 3 Boş');
    assert.equal(reloadFor({ initial: false, view: view(2), events: [pub('shot')] }), null);
    assert.equal(reloadFor({ initial: false, view: view(0, 'ended'), events: [pub('reloaded', { live: 1, blank: 1 })] }), null);
  });
});

describe('the last-move line and the seats\' tags', () => {
  test('a shot at another player, with the players it eliminated', () => {
    const events = [
      pub('matchStarted'),
      pub('shot', { shooter: 's04', target: 's02', effect: 'live', auto: false, hits: [] }),
      pub('eliminated', { player: 's02', by: 's04', round: 2 }),
      pub('turnStarted', { player: 's01' }),
    ];
    assert.deepEqual(lastMove(events, nameOf), { lead: TEXT.shotAtOther('Zeynep', 'Kerem'), effect: 'live', tail: TEXT.playerOut('Kerem') });
  });

  test('a shot at oneself, and the automatic shot of a timeout', () => {
    assert.deepEqual(lastMove([pub('shot', { shooter: 's01', target: 's01', effect: 'blank', auto: false })], nameOf), { lead: TEXT.shotAtSelf('Malik'), effect: 'blank', tail: '' });
    assert.equal(lastMove([pub('timedOut'), pub('shot', { shooter: 's03', target: 's03', effect: 'live', auto: true })], nameOf).lead, TEXT.shotOnTimeout('Selin'));
  });

  test('only public events: a private event never shows', () => {
    const events = [
      pub('shot', { shooter: 's01', target: 's02', effect: 'blank', auto: false }),
      { type: 'toolUsed', tool: 'detector', by: 's01', chamber: 'live', visibility: 'private', to: ['s01'] },
      { type: 'targetChosen', player: 's01', target: 's03', visibility: 'private', to: ['s01'] },
    ];
    assert.deepEqual(lastMove(events, nameOf), { lead: TEXT.shotAtOther('Malik', 'Kerem'), effect: 'blank', tail: '' });
  });

  test('before any shot: "Maç başladı."; nothing at all: null', () => {
    assert.deepEqual(lastMove([pub('matchStarted'), pub('reloaded'), pub('turnStarted')], nameOf), { lead: TEXT.matchBegan, effect: null, tail: '' });
    assert.equal(lastMove([], nameOf), null);
  });

  test('the round each player went out in (also when removed by the host)', () => {
    const events = [pub('reloaded', { round: 1 }), pub('eliminated', { player: 's02', round: 1 }), pub('reloaded', { round: 2 }), pub('playerRemoved', { player: 's03' })];
    assert.deepEqual(outRounds(events), { s02: { round: 1, removed: false }, s03: { round: 2, removed: true } });
    assert.deepEqual(outRounds([pub('playerRemoved', { player: 's04' })], {}, 3), { s04: { round: 3, removed: true } });
  });

  test('seat tags: me, the current player, my target, absent, "N. turda çıktı"', () => {
    const info = { viewerId: 's01', turnId: 's02', target: null, present: true };
    assert.deepEqual(seatTags({ id: 's01', alive: true }, info), [TEXT.tagMe]);
    assert.deepEqual(seatTags({ id: 's02', alive: true }, info), [TEXT.tagTurn]);
    assert.deepEqual(seatTags({ id: 's03', alive: true }, { ...info, target: 's03', present: false }), [TEXT.tagTarget, TEXT.tagAbsent]);
    assert.deepEqual(seatTags({ id: 's01', alive: true }, { ...info, turnId: 's01', target: 's01' }), [TEXT.tagMe, TEXT.tagTarget]);
    assert.deepEqual(seatTags({ id: 's04', alive: false }, { ...info, out: { round: 2, removed: false } }), ['2. turda çıktı']);
  });

  test('the status line: my turn, someone else\'s, the winner, a draw', () => {
    const base = { status: 'active', viewer: 's01', turn: { playerId: 's01' }, phase: { type: 'turn' } };
    assert.equal(statusText(base, nameOf), 'Sıra sende');
    assert.equal(statusText({ ...base, turn: { playerId: 's04' } }, nameOf), 'Sıra: Zeynep');
    assert.equal(statusText({ ...base, status: 'ended', result: { type: 'win', winner: 's01' } }, nameOf), 'Kazandın');
    assert.equal(statusText({ ...base, status: 'ended', result: { type: 'win', winner: 's03' } }, nameOf), 'Kazanan: Selin');
    assert.equal(statusText({ ...base, status: 'ended', result: { type: 'draw', winner: null } }, nameOf), 'Berabere');
  });
});

describe('the countdown', () => {
  test('time left from clockAt and the shot time, in server time', () => {
    assert.equal(msLeft({ clockAt: 1000, seconds: 30, kind: 'shot', serverNow: 1000 }), 30000);
    assert.equal(msLeft({ clockAt: 1000, seconds: 30, kind: 'shot', serverNow: 25000 }), 6000);
    assert.equal(msLeft({ clockAt: 1000, seconds: 30, kind: 'shot', serverNow: 99000 }), 0);
    assert.equal(msLeft({ clockAt: 1000, seconds: 30, kind: 'none', serverNow: 0 }), null);
    assert.equal(secondsShown(200), 1);
    assert.equal(secondsShown(0), 0);
    assert.equal(secondsShown(null), null);
  });
});

describe('a played match through the views (what watchMatch gives each seat)', () => {
  test('every shot is animated from public events, and the target never appears before the shot', () => {
    const ids = ['s01', 's02', 's03'];
    let { state } = createMatch({ mode: 'classic', randomizeSeats: false }, ids.map((id) => ({ id, confirmShot: false })), 11);
    for (let i = 0; i < 400 && state.status === 'active'; i += 1) {
      const shooter = state.turn.playerId;
      const legal = listLegalActions(state, shooter);
      const targets = targetsFrom(legal);
      const before = ids.map((id) => JSON.stringify(viewFor(state, id)));
      let res;
      if (state.phase.type === 'loot') res = applyAction(state, { type: 'timeout', seq: state.clock.seq });
      else res = applyAction(state, { type: 'chooseTarget', playerId: shooter, target: targets[i % targets.length] });
      assert.ok(res.ok, res.error?.message);
      // Before the shot, no view knows the target (nothing was sent but the shot itself).
      for (const view of before) assert.doesNotMatch(view, /"pending":\{"type":"confirm"/);
      for (const id of ids) {
        const shots = shotsIn(eventsFor(res.events, id));
        if (state.phase.type !== 'loot') assert.equal(shots.length, 1);
      }
      state = res.state;
    }
    assert.equal(state.status, 'ended');
  });
});

describe('the table screen source', () => {
  const source = readFileSync(new URL('../src/ui/screens/table.js', import.meta.url), 'utf8');

  test('sends only the shot (chooseTarget) and the no-confirmation preference; never the target alone', () => {
    const sent = [...source.matchAll(/submitAction\(\{[^}]*action: \{ type: '([a-zA-Z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(sent.sort(), ['chooseTarget', 'setPreference']);
    assert.doesNotMatch(source, /type: 'confirmShot'/);
  });

  test('cleans up: intervals, timers and listeners are stopped in destroy()', () => {
    assert.match(source, /clearInterval\(tick\)/);
    assert.match(source, /for \(const id of timers\) clearTimeout\(id\)/);
    assert.match(source, /for \(const stop of stops\.splice\(0\)\)/);
  });
});
