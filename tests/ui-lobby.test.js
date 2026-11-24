// Game UI, waiting room: settings stepping within the engine's limits, the tool list and
// counter, the player rows (src/ui/lobby-model.js) and the coalesced settings writes
// (src/ui/settings-sync.js). No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_LIMITS, TOOL_IDS, defaultConfig, toolsForMode, validateConfig } from '../src/engine/index.js';
import {
  STEPPED_SETTINGS,
  canStep,
  canToggleTool,
  defaultsFor,
  formatPoints,
  normalizeSettings,
  playerRows,
  sameSettings,
  settingLimits,
  stepSetting,
  toggleTool,
  toolCounter,
  toolList,
} from '../src/ui/lobby-model.js';
import { WRITE_DELAY_MS, createSettingsSync } from '../src/ui/settings-sync.js';
import tr from '../src/ui/i18n/tr.js';

const TOOL_NAMES = tr.tools.names;

const classic = (patch = {}) => ({ ...defaultConfig('classic'), ...patch });

describe('stepping a setting', () => {
  test('limits are the engine\'s CONFIG_LIMITS', () => {
    for (const { key } of STEPPED_SETTINGS) assert.deepEqual(settingLimits(key), CONFIG_LIMITS[key]);
    assert.throws(() => settingLimits('randomizeSeats'));
    assert.throws(() => settingLimits('__proto__'));
  });

  test('+ and − move by the step and never leave the limits; the result always validates', () => {
    for (const { key, step } of STEPPED_SETTINGS) {
      const [min, max] = CONFIG_LIMITS[key];
      let config = classic();
      for (let i = 0; i < 1000 && canStep(config, key, +1); i += 1) {
        const next = stepSetting(config, key, +1);
        assert.equal(next[key], Math.min(max, config[key] + step), key);
        config = next;
      }
      assert.equal(config[key], max, `${key} reaches its max`);
      assert.equal(canStep(config, key, +1), false);
      assert.equal(stepSetting(config, key, +1), config, `${key}: + at the max changes nothing`);
      for (let i = 0; i < 1000 && canStep(config, key, -1); i += 1) config = stepSetting(config, key, -1);
      assert.equal(config[key], min, `${key} reaches its min`);
      assert.equal(canStep(config, key, -1), false);
      assert.equal(stepSetting(config, key, -1), config);
      assert.equal(validateConfig(config).ok, true, key);
    }
  });

  test('a value off the step grid is clamped, not overshot', () => {
    const [min, max] = CONFIG_LIMITS.shotTimeSeconds;
    assert.equal(stepSetting(classic({ shotTimeSeconds: min + 2 }), 'shotTimeSeconds', -1).shotTimeSeconds, min);
    assert.equal(stepSetting(classic({ shotTimeSeconds: max - 2 }), 'shotTimeSeconds', +1).shotTimeSeconds, max);
  });

  test('stepping never mutates the config it was given', () => {
    const config = classic();
    const copy = structuredClone(config);
    stepSetting(config, 'hp', +1);
    toggleTool(config, 'heal');
    assert.deepEqual(config, copy);
  });
});

describe('tools', () => {
  test('the counter is N / 16 in Classic, and the list uses the approved names', () => {
    assert.deepEqual(toolCounter(classic()), { enabled: 16, total: toolsForMode('classic').length });
    assert.equal(toolsForMode('classic').length, 16);
    for (const tool of TOOL_IDS) assert.equal(typeof TOOL_NAMES[tool], 'string', tool);
    assert.deepEqual(toolList(classic()).map((t) => t.tool), toolsForMode('classic'));
    assert.deepEqual(toolList(classic()).map((t) => t.name), toolsForMode('classic').map((t) => TOOL_NAMES[t]));
  });

  test('toggling keeps the engine order; the last tool cannot be switched off', () => {
    let config = classic();
    config = toggleTool(config, 'detector');
    assert.equal(toolCounter(config).enabled, 15);
    config = toggleTool(config, 'detector');
    assert.deepEqual(config.enabledTools, toolsForMode('classic'));

    config = classic({ enabledTools: ['heal'] });
    assert.equal(canToggleTool(config, 'heal'), false);
    assert.equal(toggleTool(config, 'heal'), config);
    config = toggleTool(config, 'probe');
    assert.deepEqual(config.enabledTools, ['probe', 'heal']);
    assert.equal(validateConfig(config).ok, true);
  });

  test('unknown ids and tools of another mode are ignored', () => {
    const config = classic();
    for (const tool of ['nope', '__proto__', 'constructor', null]) assert.equal(toggleTool(config, tool), config);
    const custom = defaultConfig('custom');
    assert.equal(toggleTool(custom, 'swap'), custom); // swap is Classic only
  });
});

describe('settings from the database', () => {
  test('a valid stored value is normalized; anything else falls back to the defaults', () => {
    assert.deepEqual(normalizeSettings({ ...classic({ hp: 9 }), custom: undefined }, 'classic'), classic({ hp: 9 }));
    assert.deepEqual(normalizeSettings(null, 'classic'), defaultConfig('classic'));
    assert.deepEqual(normalizeSettings(classic({ hp: 'x' }), 'classic'), defaultConfig('classic'));
    assert.deepEqual(normalizeSettings(classic(), 'custom'), defaultConfig('custom'));
    assert.equal(sameSettings(classic({ hp: 6 }), classic({ hp: 6 })), true);
    assert.equal(sameSettings(classic({ hp: 6 }), classic({ hp: 7 })), false);
    assert.deepEqual(defaultsFor(classic({ hp: 9 })), defaultConfig('classic'));
  });
});

describe('player rows', () => {
  const seats = {
    s02: { name: 'Selin', uid: 'b', joinedAt: 2 },
    s01: { name: 'Malik', uid: 'a', joinedAt: 1 },
    s03: { name: 'Kerem', uid: 'c', joinedAt: 3, waiting: true },
    bogus: { name: 'X' },
  };
  const presence = { s01: { conns: { c: true } }, s02: { conns: { d: true }, lastSeenAt: 5 }, s03: { lastSeenAt: 9 } };

  test('seat order, labels and points', () => {
    const rows = playerRows({ seats, presence, scores: { s01: 4 }, hostSeat: 's01', mySeat: 's01' });
    assert.deepEqual(rows.map((r) => r.seatId), ['s01', 's02', 's03']);
    assert.equal(rows[0].tagLine, 'sen · masa sahibi');
    assert.equal(rows[1].tagLine, '');
    assert.equal(rows[2].tagLine, 'bağlantı yok · sonraki maçta oynar');
    assert.deepEqual(rows.map((r) => r.points), [4, 0, 0]);
    assert.equal(formatPoints(rows[0].points), '4 puan');
    assert.equal(formatPoints(undefined), '0 puan');
  });

  test('a player sees "sen" on their own row and the host label on the host', () => {
    const rows = playerRows({ seats, presence, scores: {}, hostSeat: 's02', mySeat: 's01' });
    assert.equal(rows[0].tagLine, 'sen');
    assert.equal(rows[1].tagLine, 'masa sahibi');
  });
});

// Fake timers: run() fires the pending timer.
function fakeTimers() {
  let pending = null;
  return {
    setTimer: (fn, ms) => {
      pending = { fn, ms };
      return pending;
    },
    clearTimer: (id) => {
      if (pending === id) pending = null;
    },
    pending: () => pending,
    run() {
      const { fn } = pending;
      pending = null;
      fn();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('coalesced settings writes', () => {
  function setup({ fail = false } = {}) {
    const timers = fakeTimers();
    const writes = [];
    const shown = [];
    const errors = [];
    const sync = createSettingsSync({
      write: (value) => {
        writes.push(value);
        return fail ? Promise.reject(new Error('denied')) : Promise.resolve();
      },
      onShow: (value) => shown.push(value),
      onError: (error) => errors.push(error),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    return { sync, timers, writes, shown, errors };
  }

  test('quick taps show at once and become one write after the pause', async () => {
    const { sync, timers, writes, shown } = setup();
    sync.fromServer(classic());
    sync.change(classic({ hp: 6 }));
    sync.change(classic({ hp: 7 }));
    sync.change(classic({ hp: 8 }));
    assert.deepEqual(shown.map((s) => s.hp), [5, 6, 7, 8]);
    assert.equal(writes.length, 0);
    assert.equal(timers.pending().ms, WRITE_DELAY_MS);
    timers.run();
    assert.deepEqual(writes.map((s) => s.hp), [8]);
    await flush();
    assert.equal(sync.busy(), false);
  });

  test('database values do not overwrite a pending change; they show once it is written', async () => {
    const { sync, timers, shown } = setup();
    sync.fromServer(classic());
    sync.change(classic({ hp: 9 }));
    sync.fromServer(classic({ toolsPerTurn: 1 })); // an older echo
    assert.equal(sync.current().hp, 9);
    timers.run();
    sync.fromServer(classic({ hp: 9 })); // the write's own echo
    await flush();
    assert.equal(sync.current().hp, 9);
    assert.equal(shown.at(-1).hp, 9);
    sync.fromServer(classic({ hp: 4 })); // a later change from elsewhere shows
    assert.equal(shown.at(-1).hp, 4);
  });

  test('a failed write rolls back to the database value and reports the error', async () => {
    const { sync, timers, shown, errors } = setup({ fail: true });
    sync.fromServer(classic());
    sync.change(classic({ hp: 12 }));
    timers.run();
    await flush();
    assert.equal(sync.current().hp, 5);
    assert.equal(shown.at(-1).hp, 5);
    assert.equal(errors.length, 1);
  });

  test('a change made during a write stays pending and is written next', async () => {
    const timers = fakeTimers();
    const writes = [];
    let release;
    const sync = createSettingsSync({
      write: (value) => {
        writes.push(value);
        return new Promise((resolve) => { release = resolve; });
      },
      onShow: () => {},
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    sync.fromServer(classic());
    sync.change(classic({ hp: 6 }));
    timers.run();
    sync.change(classic({ hp: 7 }));
    release();
    await flush();
    assert.equal(sync.current().hp, 7);
    timers.run();
    assert.deepEqual(writes.map((s) => s.hp), [6, 7]);
  });

  test('dispose writes a pending change at once and clears the timer', () => {
    const { sync, timers, writes } = setup();
    sync.fromServer(classic());
    sync.change(classic({ hp: 3 }));
    sync.dispose();
    assert.equal(timers.pending(), null);
    assert.deepEqual(writes.map((s) => s.hp), [3]);
    sync.change(classic({ hp: 4 }));
    assert.equal(timers.pending(), null);
  });
});
