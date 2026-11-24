// Game UI: the spinning revolver during a fire press (step 4.4b, decisions Q55 / Q74, Q56, Q75).
// Pure helpers of src/ui/press-signal.js: which press signal to believe (seat, match, countdown,
// age), what the screen does with it (the shot always wins), the spin and its stop on the
// target; plus source checks: no tremble, the effects in the CSS, no target in the signal.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRESS_GRACE_MS,
  QUICK_SPIN_MIN_DEG,
  SPIN_DEG_PER_MS,
  SPIN_TURN_MS,
  STOP_MIN_DEG,
  activePress,
  pressExpiresAt,
  signalStep,
  spinAngle,
  stopPlan,
} from '../src/ui/press-signal.js';
import { LONG_PRESS_MS, PRESS, initialPress, pressStep } from '../src/ui/fire-press.js';
import { normalizePress } from '../src/rooms/index.js';
import { SHOT_TIMING } from '../src/ui/revolver.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const AT = 1_000_000;
const view = (over = {}) => ({
  status: 'active',
  phase: { type: 'turn' },
  clock: { seq: 7, kind: 'shot', playerId: 's02' },
  config: { shotTimeSeconds: 30 },
  ...over,
});
const press = (entries) => normalizePress(entries);

describe('activePress: accept or ignore a signal', () => {
  const base = { press: press({ s02: { n: 3, seq: 7, at: AT } }), view: view(), n: 3, serverNow: AT + 500 };

  test('accepted for the turn player, this match, this countdown', () => {
    assert.equal(activePress(base), 's02');
  });

  test('ignored for any other seat (also if several seats have one)', () => {
    assert.equal(activePress({ ...base, press: press({ s03: { n: 3, seq: 7, at: AT } }) }), null);
    assert.equal(activePress({ ...base, press: press({ s03: { n: 3, seq: 7, at: AT }, s02: { n: 3, seq: 7, at: AT } }) }), 's02');
    assert.equal(activePress({ ...base, view: view({ clock: { seq: 7, kind: 'shot', playerId: 's03' } }) }), null);
  });

  test('ignored for another countdown or another match (stale)', () => {
    assert.equal(activePress({ ...base, press: press({ s02: { n: 3, seq: 6, at: AT } }) }), null);
    assert.equal(activePress({ ...base, view: view({ clock: { seq: 8, kind: 'shot', playerId: 's02' } }) }), null);
    assert.equal(activePress({ ...base, n: 4 }), null);
  });

  test('ignored once older than the shot time (presser offline, removal lost)', () => {
    const limit = AT + 30_000 + PRESS_GRACE_MS;
    assert.equal(pressExpiresAt({ at: AT }, view()), limit);
    assert.equal(activePress({ ...base, serverNow: limit }), 's02');
    assert.equal(activePress({ ...base, serverNow: limit + 1 }), null);
    assert.equal(activePress({ ...base, serverNow: NaN }), null);
  });

  test('ignored outside a running countdown (ended, loot step, no clock)', () => {
    assert.equal(activePress({ ...base, view: view({ status: 'ended' }) }), null);
    assert.equal(activePress({ ...base, view: view({ phase: { type: 'steal' } }) }), null);
    assert.equal(activePress({ ...base, view: view({ clock: { seq: 7, kind: 'none', playerId: null } }) }), null);
    assert.equal(activePress({ ...base, press: {} }), null);
    assert.equal(activePress({ ...base, press: null }), null);
    assert.equal(activePress({ ...base, view: null }), null);
  });

  test('malformed entries are dropped before anyone looks at them', () => {
    const raw = {
      s02: { n: 3, seq: 7, at: AT, target: 's03' }, // an extra field is not kept
      s03: { n: '3', seq: 7, at: AT },
      s04: { n: 3, seq: -1, at: AT },
      s05: true,
      constructor: { n: 3, seq: 7, at: AT },
      __proto__: { n: 3, seq: 7, at: AT },
    };
    const clean = normalizePress(raw);
    assert.deepEqual(Object.keys(clean), ['s02']);
    assert.deepEqual(clean.s02, { n: 3, seq: 7, at: AT });
    assert.equal(activePress({ ...base, press: clean, view: view({ clock: { seq: 7, kind: 'shot', playerId: 'constructor' } }) }), null);
  });
});

describe('signalStep: the shot always wins', () => {
  test('start, stop, keep', () => {
    assert.equal(signalStep({ spinning: 'none', shotPlaying: false, active: 's02' }), 'start');
    assert.equal(signalStep({ spinning: 'signal', shotPlaying: false, active: null }), 'stop');
    assert.equal(signalStep({ spinning: 'signal', shotPlaying: false, active: 's02' }), 'keep');
    assert.equal(signalStep({ spinning: 'none', shotPlaying: false, active: null }), 'keep');
  });

  test('while a shot plays, the signal changes nothing', () => {
    for (const spinning of ['none', 'signal', 'local']) {
      for (const active of [null, 's02']) assert.equal(signalStep({ spinning, shotPlaying: true, active }), 'keep');
    }
  });

  test('my own press drives my screen, not the signal', () => {
    assert.equal(signalStep({ spinning: 'local', shotPlaying: false, active: null }), 'keep');
  });
});

describe('the spin and its stop', () => {
  test('constant speed, about one turn per 0.6-0.8 s, clockwise', () => {
    assert.ok(SPIN_TURN_MS >= 600 && SPIN_TURN_MS <= 800);
    const s = { from: 10, startedAt: 100 };
    assert.equal(spinAngle(s, 100), 10);
    assert.ok(Math.abs(spinAngle(s, 100 + SPIN_TURN_MS) - 370) < 1e-9);
    const half = spinAngle(s, 100 + SPIN_TURN_MS / 2);
    assert.ok(Math.abs((half - spinAngle(s, 100)) - (spinAngle(s, 100 + SPIN_TURN_MS) - half)) < 1e-9, 'constant speed');
    assert.equal(spinAngle(s, 50), 10, 'never backwards');
  });

  test('the stop: same direction, on the target, at least the minimum ahead, at the same speed', () => {
    for (const current of [0, 95, 359, 720.5, -40]) {
      for (const target of [-170, -90, 0, 45, 180]) {
        for (const minDeg of [STOP_MIN_DEG, QUICK_SPIN_MIN_DEG]) {
          const plan = stopPlan({ current, target, minDeg });
          assert.ok(plan.travel >= minDeg - 1e-9, `${current} ${target}`);
          assert.ok(plan.travel < minDeg + 360, 'never an extra turn');
          assert.equal((((plan.final - target) % 360) + 360) % 360, 0, 'points at the target');
          assert.equal(plan.ms, plan.travel / SPIN_DEG_PER_MS, 'no slowdown');
        }
      }
    }
  });

  test('a quick press is one short spin (about one turn)', () => {
    const plan = stopPlan({ current: 0, target: 0, minDeg: QUICK_SPIN_MIN_DEG });
    assert.equal(plan.final, 360);
    assert.ok(QUICK_SPIN_MIN_DEG >= 270 && QUICK_SPIN_MIN_DEG <= 360);
  });
});

describe('the press and the shot (source checks)', () => {
  test('a long press still cocks; nothing trembles any more', () => {
    let { state, effect } = pressStep(initialPress(), { type: 'down', at: 0, enabled: true });
    ({ state, effect } = pressStep(state, { type: 'hold', at: LONG_PRESS_MS }));
    assert.equal(effect, 'cock');
    assert.equal(state.phase, PRESS.COCKED);
    for (const path of ['src/ui/style.css', 'src/ui/screens/table.js', 'src/ui/fire-press.js']) {
      const code = read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.doesNotMatch(code, /tremble|is-cocked/, path);
    }
  });

  test('the signal never carries the target', () => {
    const src = read('src/rooms/press.js');
    assert.match(src, /\{ n, seq, at: serverTimestamp\(\) \}/);
    assert.doesNotMatch(read('src/ui/screens/table.js'), /setPress\(\{[^}]*target/);
  });

  test('the shot effects: bigger flash and smoke, both with the recoil; static fades with Hareketler off', () => {
    const css = read('src/ui/style.css');
    assert.ok(css.includes('.revolver.is-live .rv-flash { animation: rv-flash'));
    assert.ok(css.includes('.revolver.is-blank .rv-smoke { animation: rv-smoke 0.7s'));
    assert.ok(css.includes('.motion-off .revolver.is-live .rv-flash { animation: rv-fade'));
    assert.ok(css.includes('.motion-off .revolver.is-blank .rv-smoke { animation: rv-fade'));
    assert.equal(SHOT_TIMING.blank, 1150, 'the smoke ends at 0.44 + 0.7 s');
    assert.equal(SHOT_TIMING.effect, 440);
  });
});
