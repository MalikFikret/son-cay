// Game UI: the language layer (src/ui/i18n/, decision Q71). Every player-visible text lives in a
// locale file; t() reads it in the current language (Turkish for now, and the fallback). Static
// checks keep new hard-coded texts out of the screens: no Turkish letter in a string literal of a
// UI file outside src/ui/i18n/, and every locale key the UI names exists.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TOOL_IDS } from '../src/engine/index.js';
import { ROOM_ERR } from '../src/rooms/index.js';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LOCALES,
  STORAGE_KEY,
  chooseLanguage,
  getLanguage,
  hasText,
  initLanguage,
  lookup,
  lowerCase,
  onLanguageChange,
  requestedLanguage,
  resolveLanguage,
  setLanguage,
  t,
  upperCase,
} from '../src/ui/i18n/i18n.js';
import tr from '../src/ui/i18n/tr.js';
import { errorMessage } from '../src/ui/messages.js';
import { modeHint, modeLabel } from '../src/ui/components.js';
import { toolHelp, toolName, toolTags } from '../src/ui/tools.js';
import { STEPPED_SETTINGS, formatPoints } from '../src/ui/lobby-model.js';

const root = new URL('../', import.meta.url);

function jsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...jsFiles(url));
    else if (entry.name.endsWith('.js')) files.push(url);
  }
  return files;
}

// The UI's own code: every .js file under src/ui/ except the locale layer and the generated
// version stamp.
const UI_FILES = jsFiles(new URL('src/ui/', root))
  .map((url) => ({ name: url.pathname.split('/src/ui/')[1], text: readFileSync(url, 'utf8') }))
  .filter(({ name }) => !name.startsWith('i18n/') && name !== 'version.js');

const BACKSLASH = '\\';
// Characters after which a "/" starts a regular expression literal rather than a division.
const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * The string and template literals of a JavaScript source, without comments and regular
 * expressions (a small tokenizer: enough for this code base, which uses no exotic syntax).
 * Template literals are returned whole, including their ${...} parts.
 * @returns {Array<{ line: number, value: string }>}
 */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  let line = 1;
  let previous = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') line += 1;
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      for (let k = i; k < end; k += 1) if (src[k] === '\n') line += 1;
      i = end + 2;
      continue;
    }
    if (c === '/' && (REGEX_BEFORE.has(previous) || /(return|typeof)\s*$/.test(src.slice(Math.max(0, i - 8), i)))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && (inClass || src[j] !== '/') && src[j] !== '\n') {
        if (src[j] === BACKSLASH) j += 1;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j += 1;
      }
      i = j + 1;
      previous = '/';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = line;
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === BACKSLASH) {
          value += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === '\n') line += 1;
        value += src[j];
        j += 1;
      }
      out.push({ line: start, value });
      i = j + 1;
      previous = 'x';
      continue;
    }
    if (!/\s/.test(c)) previous = c;
    else if (c === '\n') previous = previous === '' ? '' : previous;
    i += 1;
  }
  return out;
}

/** Every [dotted key, entry] of a locale. */
function entries(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? entries(value, path) : [[path, value]];
  });
}

// Samples for the entries that do not take plain numbers or names.
const SPECIAL_SAMPLES = { 'common.andList': [['Selin', 'Kerem']] };

afterEach(() => {
  setLanguage(DEFAULT_LANGUAGE);
  delete globalThis.localStorage;
});

describe('no hard-coded player text outside src/ui/i18n/', () => {
  const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;
  // Allowed literals: none needed so far. Add one only with a reason, as { file, value, why }.
  const ALLOWED = [];

  test('the tokenizer sees literals, not comments or regular expressions', () => {
    const sample = "// Çay ' \"\nconst a = /[^']/g; /* Şifre ' */ const b = 'x', c = `y ${1}`; return /\"/.test(z);";
    assert.deepEqual(stringLiterals(sample).map((l) => l.value), ['x', 'y ${1}']);
  });

  test('no UI file outside src/ui/i18n/ has a Turkish letter in a string literal (comments may)', () => {
    assert.ok(UI_FILES.length >= 30);
    const found = [];
    for (const { name, text } of UI_FILES) {
      for (const { line, value } of stringLiterals(text)) {
        if (!TURKISH.test(value)) continue;
        if (ALLOWED.some((a) => a.file === name && a.value === value)) continue;
        found.push(`${name}:${line}: ${value}`);
      }
    }
    assert.deepEqual(found, []);
  });

  test('only i18n.js reads the locale files', () => {
    for (const { name, text } of UI_FILES) assert.doesNotMatch(text, /from\s+['"][^'"]*i18n\/tr\.js['"]/, name);
  });
});

describe('every locale key the UI uses exists', () => {
  const groups = Object.keys(tr).join('|');
  const keyLike = new RegExp(`^(${groups})\\.[A-Za-z0-9_.]+$`);

  test('every literal key (t(...), titles, labels) names a text in tr.js', () => {
    const used = new Set();
    const missing = [];
    for (const { name, text } of UI_FILES) {
      for (const { line, value } of stringLiterals(text)) {
        if (!keyLike.test(value)) continue;
        used.add(value);
        if (!hasText(value)) missing.push(`${name}:${line}: ${value}`);
      }
    }
    assert.deepEqual(missing, []);
    assert.ok(used.size > 250, `only ${used.size} keys found`);
  });

  test('every t(...) call names its key as a literal or one of the known key families', () => {
    const families = ['tools.names.', 'tools.help.', 'modes.', 'modeHints.', 'errors.room.', 'errors.form.'];
    for (const { name, text } of UI_FILES) {
      for (const [, arg] of text.matchAll(/\bt\(\s*([^,)]+)/g)) {
        const literal = /^'[^']*'$/.test(arg);
        const family = families.some((f) => arg.startsWith(`\`${f}\${`));
        // A variable key comes from a table of literal keys (checked above), e.g. ICON_LABELS.
        const fromTable = /^[A-Za-z_.[\]]+$/.test(arg);
        assert.ok(literal || family || fromTable, `${name}: t(${arg}`);
      }
    }
  });

  test('the key families: every tool, mode and error code has its texts', () => {
    for (const tool of TOOL_IDS) {
      assert.ok(hasText(`tools.names.${tool}`), tool);
      assert.ok(hasText(`tools.help.${tool}`), tool);
      assert.ok(toolName(tool).length > 0 && toolHelp(tool).length > 0, tool);
      assert.equal(toolTags(tool).length, 2, tool);
    }
    assert.deepEqual(Object.keys(tr.tools.names).sort(), [...TOOL_IDS].sort());
    assert.deepEqual(Object.keys(tr.tools.help).sort(), [...TOOL_IDS].sort());
    for (const mode of ['classic', 'custom']) {
      assert.ok(modeLabel(mode).length > 0 && modeHint(mode).length > 0, mode);
    }
    assert.equal(modeLabel('constructor'), '');
    assert.equal(modeHint('__proto__'), '');
    for (const code of Object.values(ROOM_ERR)) assert.ok(hasText(`errors.room.${code}`), code);
  });

  test('every code the screens pass to errorMessage has its own message', () => {
    for (const { name, text } of UI_FILES) {
      for (const [, code] of text.matchAll(/errorMessage\('([A-Z_]+)'\)/g)) {
        assert.ok(hasText(`errors.form.${code}`) || hasText(`errors.room.${code}`), `${name}: ${code}`);
        assert.notEqual(errorMessage(code), t('errors.generic'), code);
      }
    }
  });
});

describe('the Turkish locale', () => {
  test('every entry is a non-empty string or a function', () => {
    for (const [key, value] of entries(tr)) {
      assert.ok(typeof value === 'function' || (typeof value === 'string' && value.length > 0), key);
    }
  });

  test('every function entry returns a non-empty string for sample numbers and names', () => {
    let functions = 0;
    for (const [key, fn] of entries(tr)) {
      if (typeof fn !== 'function') continue;
      functions += 1;
      const samples = Object.prototype.hasOwnProperty.call(SPECIAL_SAMPLES, key)
        ? [SPECIAL_SAMPLES[key]]
        : [Array(Math.max(fn.length, 1)).fill(2), Array(Math.max(fn.length, 1)).fill('Selin'), Array(Math.max(fn.length, 1)).fill(1)];
      for (const params of samples) {
        const text = t(key, ...params);
        assert.equal(typeof text, 'string', key);
        assert.ok(text.trim().length > 0, `${key}(${params.join(', ')})`);
        assert.ok(!text.includes('undefined') && !text.includes('[object'), `${key}: ${text}`);
      }
    }
    assert.ok(functions > 60, `${functions} function entries`);
  });

  test('texts with values keep the exact Turkish wording', () => {
    assert.equal(t('table.turnOf', 'Selin'), 'Sıra: Selin');
    assert.equal(t('players.kickConfirm', 'Selin'), 'Selin adlı oyuncu masadan çıkarılsın mı?');
    assert.equal(t('common.andList', ['Selin', 'Kerem']), 'Selin ve Kerem');
    assert.equal(t('lobby.subtitleCount', 4), 'Bekleme salonu · 4 oyuncu');
    assert.equal(t('lobby.waitingForHost', 'Selin'), 'Selin maçı başlatınca masa açılır');
    assert.equal(t('lobby.waitingForHost', ''), 'Masa sahibi maçı başlatınca masa açılır');
    assert.equal(t('lobby.copyFailed', 'https://x/#/masa/ABC234'), 'Kopyalanamadı. Bağlantıyı elle seçip kopyala. https://x/#/masa/ABC234');
    assert.equal(t('table.reloadCounts', 3, 2), '3 Dolu · 2 Boş');
    assert.equal(t('table.lastEvent', 'Maç başladı.'), 'Son olay: Maç başladı.');
    assert.equal(t('app.pageTitle', t('app.titleLobby')), 'Son Çay: bekleme salonu');
    assert.equal(t('away.homeBarBack', 'ABC234'), 'Masaya dön · Masa ABC234');
    assert.equal(t('recover.wait', 2), 'Bekle… 2');
    assert.equal(formatPoints(7), '7 puan');
    assert.deepEqual(STEPPED_SETTINGS.map((s) => [s.label, s.summaryLabel, s.summary(30)]), [
      ['Can (çay bardağı)', 'Can', '30 çay bardağı'],
      ['Her turda malzeme', 'Her turda malzeme', '30'],
      ['Bir sırada en fazla malzeme', 'Bir sırada en fazla malzeme', '30'],
      ['Ateş süresi', 'Ateş süresi', '30 sn'],
    ]);
  });

  test('meta: language code, its name for Hakkında, the page description', () => {
    assert.equal(tr.meta.language, 'tr');
    assert.equal(tr.meta.languageName, 'Türkçe');
    assert.equal(t('meta.languageName'), 'Türkçe');
  });
});

describe('t(), lookups and the language choice', () => {
  test('Turkish is the default and the only language for now', () => {
    assert.equal(DEFAULT_LANGUAGE, 'tr');
    assert.deepEqual(LANGUAGES, ['tr']);
    assert.equal(getLanguage(), 'tr');
    assert.ok(Object.isFrozen(LOCALES.tr.tools.names));
  });

  test('a missing key returns the key itself; lookups use own keys only', () => {
    assert.equal(t('table.noSuchKey'), 'table.noSuchKey');
    assert.equal(t('table'), 'table'); // a group, not a text
    assert.equal(t('constructor'), 'constructor');
    assert.equal(t('common.__proto__'), 'common.__proto__');
    assert.equal(t('tools.names.toString'), 'tools.names.toString');
    assert.equal(t(''), '');
    assert.equal(lookup('tools.names.detector'), 'Göz');
    assert.equal(lookup('tools.names.constructor'), undefined);
    assert.equal(hasText('common.cancel'), true);
    assert.equal(hasText('common'), false);
  });

  test('requested language: the stored choice, else "en" for an English browser, else Turkish', () => {
    assert.equal(requestedLanguage({}), 'tr');
    assert.equal(requestedLanguage({ stored: 'tr', browser: 'en-US' }), 'tr');
    assert.equal(requestedLanguage({ stored: null, browser: 'en-US' }), 'en');
    assert.equal(requestedLanguage({ stored: '', browser: 'en' }), 'en');
    assert.equal(requestedLanguage({ stored: null, browser: 'tr-TR' }), 'tr');
    assert.equal(requestedLanguage({ stored: null, browser: 'de-DE' }), 'tr');
  });

  test('a language without a locale (or garbage) falls back to Turkish', () => {
    assert.equal(chooseLanguage({ stored: null, browser: 'en-GB' }), 'tr');
    assert.equal(chooseLanguage({ stored: 'xx' }), 'tr');
    for (const bad of ['en', 'xx', '', null, undefined, 42, 'constructor', '__proto__']) assert.equal(resolveLanguage(bad), 'tr', String(bad));
  });

  test('setLanguage stores the choice on the device; storage failures are ignored', () => {
    const stored = new Map();
    globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) };
    assert.equal(setLanguage('en'), 'tr'); // no English locale yet
    assert.equal(stored.get(STORAGE_KEY), 'tr');
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    assert.equal(setLanguage('tr'), 'tr');
    assert.equal(initLanguage(), 'tr');
  });

  test('initLanguage reads the stored choice (unknown -> Turkish)', () => {
    globalThis.localStorage = { getItem: (k) => (k === STORAGE_KEY ? 'xx' : null), setItem: () => {} };
    assert.equal(initLanguage(), 'tr');
    assert.equal(getLanguage(), 'tr');
  });

  test('listeners hear only real changes and can stop listening', () => {
    const heard = [];
    const stop = onLanguageChange((lang) => heard.push(lang));
    setLanguage('tr');
    setLanguage('xx'); // falls back to the current language: no change
    assert.deepEqual(heard, []);
    assert.equal(stop(), true);
  });

  test('casing follows the current language (Turkish dotted and dotless i)', () => {
    assert.equal(lowerCase('İSTANBUL'), 'istanbul');
    assert.equal(lowerCase('IRMAK'), 'ırmak');
    assert.equal(upperCase('iğne'), 'İĞNE');
    assert.equal(upperCase('ılık'), 'ILIK');
  });
});
