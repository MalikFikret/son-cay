// Game UI: Ayarlar (step 4.4a, decisions Q43, Q53, Q55). The device settings module (defaults,
// saving, reading back, bad / missing / blocked storage), the six revolvers (the same moving
// parts for the animations, pivots as data), their texts in both languages, the route, the
// buttons, and the motion switch replacing the phone's "reduce motion" setting everywhere.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS, MOTION_OFF_CLASS, SETTINGS_KEY, applyMotion, chosenRevolver, getSettings, motionOn,
  onSettingsChange, parseSettings, resetSettingsCache, setSetting, soundOn,
} from '../src/ui/device-settings.js';
import { DEFAULT_REVOLVER, FLASH_ORIGIN, REVOLVERS, REVOLVER_IDS, isRevolverId } from '../src/ui/revolvers.js';
import { REVOLVER_PARTS, SHOT_TIMING, revolverTree } from '../src/ui/revolver.js';
import { DEFAULT_LANGUAGE, LANGUAGES, setLanguage, t } from '../src/ui/i18n/i18n.js';
import tr from '../src/ui/i18n/tr.js';
import en from '../src/ui/i18n/en.js';
import { ROUTES, hashFor, parseRoute } from '../src/ui/routes.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

/** A Map-backed localStorage; `broken` makes every call throw. */
function fakeStorage({ broken = false, initial = {} } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => { if (broken) throw new Error('blocked'); };
  return {
    data,
    getItem: (key) => { guard(); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { guard(); data.set(key, String(value)); },
    removeItem: (key) => { guard(); data.delete(key); },
  };
}

beforeEach(() => {
  delete globalThis.localStorage;
  resetSettingsCache();
});

afterEach(() => {
  delete globalThis.localStorage;
  resetSettingsCache();
  setLanguage(DEFAULT_LANGUAGE);
});

describe('device settings', () => {
  test('defaults: Musul Gravürü, sound on, motion on', () => {
    assert.deepEqual({ ...DEFAULT_SETTINGS }, { revolver: 'mosul', sound: true, motion: true });
    globalThis.localStorage = fakeStorage();
    assert.deepEqual({ ...getSettings() }, { ...DEFAULT_SETTINGS });
    assert.equal(chosenRevolver(), 'mosul');
    assert.equal(soundOn(), true);
    assert.equal(motionOn(), true);
  });

  test('saving and reading back (also after the memory is forgotten)', () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;
    assert.equal(setSetting('revolver', 'cowboy'), true);
    assert.equal(setSetting('sound', false), true);
    assert.equal(setSetting('motion', false), true);
    assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), { revolver: 'cowboy', sound: false, motion: false });
    resetSettingsCache(); // a reload
    assert.deepEqual({ ...getSettings() }, { revolver: 'cowboy', sound: false, motion: false });
    assert.equal(setSetting('revolver', 'cowboy'), false, 'no change');
  });

  test('bad stored values fall back per field to the default', () => {
    const cases = [
      ['not json', DEFAULT_SETTINGS],
      ['null', DEFAULT_SETTINGS],
      ['[1,2]', DEFAULT_SETTINGS],
      ['"mosul"', DEFAULT_SETTINGS],
      ['{"revolver":"bazooka","sound":"yes","motion":0}', DEFAULT_SETTINGS],
      ['{"revolver":"constructor","sound":null}', DEFAULT_SETTINGS],
      ['{"revolver":"detective","motion":"false"}', { ...DEFAULT_SETTINGS, revolver: 'detective' }],
      ['{"sound":false,"extra":1}', { ...DEFAULT_SETTINGS, sound: false }],
      ['{"__proto__":{"motion":false}}', DEFAULT_SETTINGS],
    ];
    for (const [raw, expected] of cases) {
      assert.deepEqual({ ...parseSettings(raw) }, { ...expected }, raw);
      resetSettingsCache();
      globalThis.localStorage = fakeStorage({ initial: { [SETTINGS_KEY]: raw } });
      assert.deepEqual({ ...getSettings() }, { ...expected }, raw);
    }
    assert.deepEqual({ ...parseSettings(undefined) }, { ...DEFAULT_SETTINGS });
  });

  test('missing or blocked storage: defaults, and a change still applies for this page', () => {
    assert.deepEqual({ ...getSettings() }, { ...DEFAULT_SETTINGS }, 'no localStorage at all');
    resetSettingsCache();
    globalThis.localStorage = fakeStorage({ broken: true });
    assert.deepEqual({ ...getSettings() }, { ...DEFAULT_SETTINGS });
    assert.equal(setSetting('motion', false), true);
    assert.equal(motionOn(), false);
    // A getter that throws on access (blocked site data).
    resetSettingsCache();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.deepEqual({ ...getSettings() }, { ...DEFAULT_SETTINGS });
    assert.equal(setSetting('revolver', 'heavy'), true);
    assert.equal(chosenRevolver(), 'heavy');
  });

  test('invalid changes are refused; listeners hear real changes only', () => {
    globalThis.localStorage = fakeStorage();
    const heard = [];
    const stop = onSettingsChange((now, before) => heard.push([before.revolver, now.revolver]));
    assert.equal(setSetting('revolver', 'bazooka'), false);
    assert.equal(setSetting('sound', 'off'), false);
    assert.equal(setSetting('confirmShot', true), false, 'Q55: no such setting');
    assert.equal(setSetting('toString', true), false);
    assert.equal(setSetting('revolver', 'oldSoldier'), true);
    assert.equal(setSetting('revolver', 'oldSoldier'), false);
    stop();
    setSetting('revolver', 'mosul');
    assert.deepEqual(heard, [['mosul', 'oldSoldier']]);
  });

  test('the motion switch is mirrored as a class on the root element', () => {
    globalThis.localStorage = fakeStorage();
    const classes = new Set();
    const rootEl = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
    applyMotion(rootEl);
    assert.equal(classes.has(MOTION_OFF_CLASS), false);
    setSetting('motion', false);
    applyMotion(rootEl);
    assert.equal(classes.has(MOTION_OFF_CLASS), true);
    setSetting('motion', true);
    applyMotion(rootEl);
    assert.equal(classes.has(MOTION_OFF_CLASS), false);
  });
});

/** Every element of a tree, with the chain of its ancestors' classes. */
function walk(node, ancestors = [], out = []) {
  const [tag, attrs, ...children] = node;
  out.push({ tag, attrs, ancestors });
  for (const child of children) walk(child, [...ancestors, { tag, attrs }], out);
  return out;
}

describe('the six revolvers', () => {
  test('six ids in the mock order, Musul Gravürü the default', () => {
    assert.deepEqual([...REVOLVER_IDS], ['birdHead', 'cowboy', 'detective', 'heavy', 'oldSoldier', 'mosul']);
    assert.equal(DEFAULT_REVOLVER, 'mosul');
    assert.deepEqual(Object.keys(REVOLVERS).sort(), [...REVOLVER_IDS].sort());
    assert.equal(isRevolverId('constructor'), false);
    assert.equal(isRevolverId('__proto__'), false);
  });

  for (const id of REVOLVER_IDS) {
    test(`${id}: exposes the same moving parts, pivots as data`, () => {
      const nodes = walk(revolverTree(id, { uid: 't' }));
      const byClass = (name) => nodes.filter((n) => n.attrs.class === name);
      for (const part of REVOLVER_PARTS) assert.equal(byClass(part).length, 1, `${id}: ${part}`);
      // Hammer and cylinder marks move with the body (inside it); the flash does not.
      const inside = (name, parent) => byClass(name)[0].ancestors.some((a) => a.attrs.class === parent);
      assert.ok(inside('rv-hammer', 'rv-body'), id);
      assert.ok(inside('rv-flutes', 'rv-body'), id);
      assert.ok(!inside('rv-flash', 'rv-body'), id);
      // Each pivoted part sits in a group placed at its pivot (the CSS origin is the local 0 0).
      const { pivots } = REVOLVERS[id];
      for (const [part, key] of [['rv-hammer', 'hammer'], ['rv-body', 'body'], ['rv-flash', 'muzzle']]) {
        const parent = byClass(part)[0].ancestors.at(-1);
        assert.equal(parent.attrs.transform, `translate(${pivots[key][0]} ${pivots[key][1]})`, `${id}: ${part}`);
        assert.ok(pivots[key].every(Number.isFinite), `${id}: ${key}`);
      }
      // The marks slide one step; at rest the extra marks lie outside the clip.
      const { flutes } = REVOLVERS[id];
      assert.ok(flutes.step > 0);
      assert.equal(byClass('rv-flutes')[0].attrs['data-step'], flutes.step);
      const marksY = flutes.marks.map(([, a]) => a.y).sort((a, b) => a - b);
      for (let i = 1; i < marksY.length; i += 1) assert.equal(marksY[i] - marksY[i - 1], flutes.step, `${id}: spacing`);
      assert.ok(marksY[0] + flutes.marks[0][1].height <= flutes.clip.y, `${id}: a mark waits above the clip`);
      // Unique ids, and every url(#...) points to a definition in this drawing.
      const ids = nodes.map((n) => n.attrs.id).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length);
      for (const n of nodes) {
        for (const value of Object.values(n.attrs)) {
          const ref = /^url\(#(.+)\)$/.exec(String(value));
          if (ref) assert.ok(ids.includes(ref[1]), `${id}: ${value}`);
          assert.ok(!['HATCH', 'GRIP', 'GRIP_PATH', 'FLUTES'].some((token) => String(value).includes(token)), `${id}: ${value}`);
        }
      }
      assert.equal(nodes[0].attrs['data-revolver'], id);
      assert.equal(nodes[0].attrs.viewBox, '40 0 300 190');
    });
  }

  test('the flash is moved to each muzzle', () => {
    for (const id of REVOLVER_IDS) {
      const nodes = walk(revolverTree(id, { uid: 'f' }));
      const flash = nodes.find((n) => n.attrs.class === 'rv-flash');
      const { muzzle } = REVOLVERS[id].pivots;
      const inner = flash.ancestors.length; // the flash drawing's shift is two levels below
      const shift = nodes.find((n) => n.ancestors.length === inner + 2 && n.ancestors[inner]?.attrs.class === 'rv-flash');
      assert.equal(shift.attrs.transform, `translate(${muzzle[0] - FLASH_ORIGIN[0]} ${muzzle[1] - FLASH_ORIGIN[1]})`, id);
    }
  });

  test('two drawings never share pattern / clip ids; an unknown id draws the default', () => {
    const a = walk(revolverTree('mosul')).map((n) => n.attrs.id).filter(Boolean);
    const b = walk(revolverTree('mosul')).map((n) => n.attrs.id).filter(Boolean);
    assert.equal(a.filter((x) => b.includes(x)).length, 0);
    assert.equal(revolverTree('constructor')[1]['data-revolver'], 'mosul');
  });

  test('every revolver has a name and a note in both languages', () => {
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      for (const id of REVOLVER_IDS) {
        assert.ok(t(REVOLVERS[id].nameKey).length > 0, `${lang} ${id}`);
        assert.ok(t(REVOLVERS[id].noteKey).length > 0, `${lang} ${id}`);
      }
    }
    assert.deepEqual(Object.keys(tr.revolvers.names).sort(), [...REVOLVER_IDS].sort());
    assert.deepEqual(Object.keys(en.revolvers.names).sort(), [...REVOLVER_IDS].sort());
    assert.deepEqual(tr.revolvers.names, {
      birdHead: 'Kuş Başı', cowboy: 'Kovboy', detective: 'Dedektif', heavy: 'Ağır Kalibre', oldSoldier: 'Eski Asker', mosul: 'Musul Gravürü',
    });
    assert.equal(tr.deviceSettings.defaultNote(tr.revolvers.notes.mosul), 'kemik kabza · varsayılan');
  });
});

describe('Ayarlar: route, buttons, texts', () => {
  test('#/ayarlar', () => {
    assert.deepEqual(parseRoute('#/ayarlar'), { name: ROUTES.SETTINGS });
    assert.deepEqual(parseRoute('#/ayarlar/'), { name: ROUTES.SETTINGS });
    assert.equal(hashFor.settings(), '#/ayarlar');
  });

  test('Giriş and the match ⋮ menu open it; navigation only', () => {
    assert.match(read('src/ui/screens/home.js'), /ctx\.go\(hashFor\.settings\(\)\)/);
    assert.match(read('src/ui/screens/table.js'), /menuItem\(t\('common\.settings'\), \{ onClick:/);
    assert.match(read('src/ui/screens/lobby.js'), /onSettings: \(\) => ctx\.go\(hashFor\.settings\(\)\)/);
    const src = read('src/ui/screens/settings.js') + read('src/ui/device-settings.js');
    assert.doesNotMatch(src, /ctx\.api|submitAction|keeper\.(release|hold|away|back)|innerHTML/);
  });

  test('the mock\'s texts, without the "Ateşlemeden önce sor" switch (Q55)', () => {
    assert.equal(tr.deviceSettings.footer, 'Bu ayarlar yalnız bu cihazda saklanır.');
    assert.equal(tr.deviceSettings.sound, 'Ses');
    assert.equal(tr.deviceSettings.motion, 'Hareketler');
    assert.doesNotMatch(JSON.stringify(tr), /Ateşlemeden önce sor/);
    // Exactly two switches on the page: Ses and Hareketler.
    assert.equal(read('src/ui/screens/settings.js').match(/(?<![.\w])toggle\('/g).length, 2);
  });
});

describe('motion follows only the Hareketler switch (Q53)', () => {
  test('no "prefers-reduced-motion" anywhere the browser loads', () => {
    for (const path of ['src/ui/style.css', 'src/ui/screens/table.js', 'src/ui/revolver.js', 'index.html']) {
      assert.doesNotMatch(read(path), /prefers-reduced-motion|matchMedia/, path);
    }
  });

  test('the reduced rules hang on the root class, and the table asks the switch', () => {
    const css = read('src/ui/style.css');
    for (const rule of ['.motion-off .revolver { transition: none; }', '.motion-off .sheet-panel', '.motion-off .shot-notice', '.motion-off .fire-button.is-urgent']) {
      assert.ok(css.includes(rule), rule);
    }
    assert.match(read('src/ui/screens/table.js'), /const reducedMotion = \(\) => !motionOn\(\);/);
    assert.equal(SHOT_TIMING.reducedLive, 500);
    assert.equal(SHOT_TIMING.reducedBlank, 300);
    assert.equal(SHOT_TIMING.reducedAim, 0);
  });
});
