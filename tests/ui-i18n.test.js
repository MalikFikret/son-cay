// Game UI: the language layer (src/ui/i18n/, decisions Q71, Q72). Every player-visible text lives
// in a locale file (tr.js, en.js, with the same keys); t() reads it in the current language
// (Turkish is the default and the fallback). Static checks keep new hard-coded texts out of the
// screens: no Turkish letter in a string literal of a UI file outside src/ui/i18n/, and every
// locale key the UI names exists.

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
  BOLD_SLOT,
  chooseLanguage,
  getLanguage,
  hasText,
  initLanguage,
  languageName,
  lookup,
  lowerCase,
  nextLanguage,
  onLanguageChange,
  requestedLanguage,
  resolveLanguage,
  setLanguage,
  splitBold,
  t,
  upperCase,
} from '../src/ui/i18n/i18n.js';
import tr from '../src/ui/i18n/tr.js';
import en from '../src/ui/i18n/en.js';
import { errorMessage } from '../src/ui/messages.js';
import { modeHint, modeLabel } from '../src/ui/components.js';
import { resultText } from '../src/ui/tool-model.js';
import { breakdownLines } from '../src/ui/tablo-model.js';
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
const SPECIAL_SAMPLES = { 'common.andList': [[['Selin', 'Kerem']], [['Selin']], [['Selin', 'Kerem', 'Ada']]] };

/** t() in one language, then back to Turkish. */
function inLanguage(lang, fn) {
  setLanguage(lang);
  try {
    return fn();
  } finally {
    setLanguage(DEFAULT_LANGUAGE);
  }
}

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

  test('every function entry returns a non-empty string for sample numbers and names, in both languages', () => {
    for (const [lang, locale] of [['tr', tr], ['en', en]]) {
      let functions = 0;
      for (const [key, fn] of entries(locale)) {
        if (typeof fn !== 'function') continue;
        functions += 1;
        const samples = Object.prototype.hasOwnProperty.call(SPECIAL_SAMPLES, key)
          ? SPECIAL_SAMPLES[key]
          : [Array(Math.max(fn.length, 1)).fill(2), Array(Math.max(fn.length, 1)).fill('Selin'), Array(Math.max(fn.length, 1)).fill(1), Array(Math.max(fn.length, 1)).fill(3)];
        for (const params of samples) {
          const text = inLanguage(lang, () => t(key, ...params));
          assert.equal(typeof text, 'string', `${lang} ${key}`);
          assert.ok(text.trim().length > 0, `${lang} ${key}(${params.join(', ')})`);
          assert.ok(!text.includes('undefined') && !text.includes('[object') && !text.includes('NaN'), `${lang} ${key}: ${text}`);
        }
      }
      assert.ok(functions > 60, `${lang}: ${functions} function entries`);
    }
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

describe('the English locale (decision Q72)', () => {
  test('en.js has exactly the keys of tr.js, with the same kind of entry and the same parameters', () => {
    const trEntries = new Map(entries(tr));
    const enEntries = new Map(entries(en));
    assert.deepEqual([...enEntries.keys()].sort(), [...trEntries.keys()].sort());
    for (const [key, value] of trEntries) {
      const other = enEntries.get(key);
      assert.equal(typeof other, typeof value, key);
      if (typeof value === 'function') assert.equal(other.length, value.length, `${key}: parameters`);
    }
  });

  test('every entry is a non-empty string or a function', () => {
    for (const [key, value] of entries(en)) {
      assert.ok(typeof value === 'function' || (typeof value === 'string' && value.length > 0), key);
    }
  });

  test('en.js has no Turkish letter except in the allowed names', () => {
    // The game name stays "Son Çay" in English (approved); "Türkçe" is not in en.js (each
    // language's own name comes from its own locale). Comments may have Turkish words.
    const ALLOWED = [{ value: 'Son Çay', why: 'the game name, the same in every language' }];
    const source = readFileSync(new URL('src/ui/i18n/en.js', root), 'utf8');
    const found = [];
    for (const { line, value } of stringLiterals(source)) {
      let rest = value;
      for (const allowed of ALLOWED) rest = rest.split(allowed.value).join('');
      if (/[çğıöşüÇĞİÖŞÜ]/.test(rest)) found.push(`en.js:${line}: ${value}`);
    }
    assert.deepEqual(found, []);
  });

  test('the approved terms (Q72)', () => {
    assert.deepEqual({ ...en.tools.names }, {
      detector: 'Eye', probe: 'Scales', counter: 'Counter', skip: 'Skip', swap: 'Trickster', flip: 'Flip',
      shuffle: 'Shuffle', double: 'Double Shot', reverse: 'Reverse', link: 'Chain', jail: 'Jail',
      handSwap: 'Hand Swap', steal: 'Steal', shotShield: 'Bullet Shield', toolShield: 'Item Shield', heal: 'Bandage',
    });
    assert.equal(en.app.name, 'Son Çay');
    assert.equal(en.meta.languageName, 'English');
    assert.equal(en.common.tableCodeLabel, 'Table code');
    assert.equal(en.lobby.subtitle, 'Lobby');
    assert.equal(en.tablo.tablo, 'Scoreboard');
    assert.equal(en.tablo.tabSession, 'Session');
    assert.equal(en.table.fire, 'Fire');
    assert.equal(en.table.yourTurn, 'Your turn');
    assert.equal(en.table.watching, 'Spectating');
    assert.equal(en.home.join, 'Join table');
    assert.equal(en.home.create, 'New table');
    assert.equal(en.sit.join, 'Take a seat');
    assert.equal(en.recover.title, 'Reclaim your seat');
    assert.equal(en.about.title, 'About');
    assert.equal(en.start.startMatch, 'Start match');
    assert.deepEqual([en.closeRoom.closeRoom, en.closeRoom.closeRoomTitle, en.closeRoom.closeRoomYes, en.closeRoom.roomClosed, en.closeRoom.roomClosedByMe],
      ['Delete table', 'Delete table?', 'Yes, delete', 'Table deleted.', 'You deleted the table.']);
    assert.equal(en.end.backToLobby, 'Back to lobby');
    assert.equal(en.liveTablo.backToTable, 'Back to table');
    assert.equal(en.away.menuHome, 'Home');
    assert.deepEqual([en.modes.classic, en.modes.custom], ['Classic', 'Custom']);
    assert.deepEqual([en.loot.lootLabel, en.ransom.ransomButton], ['Loot', 'Ransom']);
    assert.deepEqual([en.tablo.lineEliminations, en.tablo.linePredictions], ['Elimination', 'Prediction']);
    assert.equal(en.lobby.tagAbsent, 'offline');
    assert.match(en.home.tagline, /Whoever holds the last tea wins\.$/);
    // A bullet is never a "round" (rounds are the game's rounds).
    for (const [key, value] of entries(en)) {
      if (typeof value === 'string') assert.doesNotMatch(value, /\b(cartridge|chamber)s?\b/i, key);
    }
  });

  test('English sentences with values: names inside, ordinals, singular and plural', () => inLanguage('en', () => {
    assert.equal(t('players.kickConfirm', 'Selin'), 'Remove Selin from the table?');
    assert.equal(t('table.turnOf', 'Selin'), 'Turn: Selin');
    assert.equal(t('shotNotice.shotNoticeTurn', 'Selin'), 'Turn: Selin.');
    assert.equal(t('table.roundTitle', 3), 'Round 3');
    assert.equal(t('end.endTop', 'ABC234', 'Classic', 1), 'Table ABC234 · Classic · Match 1');
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((n) => t('end.place', n)),
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
    assert.deepEqual([1, 2].map((n) => t('sit.playerCount', n)), ['1 player', '2 players']);
    assert.deepEqual([1, 2].map((n) => t('lobby.subtitleCount', n)), ['Lobby · 1 player', 'Lobby · 2 players']);
    assert.deepEqual([1, 5].map((n) => t('settings.hpValue', n)), ['1 tea glass', '5 tea glasses']);
    assert.deepEqual([1, 2].map((n) => t('tablo.hpLabel', n)), ['1 life', '2 lives']);
    assert.equal(t('table.livesLabel', 1, 5), '1 / 5 lives');
    assert.deepEqual([1, 2].map((n) => t('table.handTitle', n)), ['Your hand · 1 item', 'Your hand · 2 items']);
    assert.deepEqual([1, 2].map((n) => t('tableTools.toolCount', n)), ['1 item', '2 items']);
    assert.deepEqual([1, 2].map((n) => t('lobby.points', n)), ['1 point', '2 points']);
    assert.deepEqual([1, 2].map((n) => t('tablo.times', n)), ['1 time', '2 times']);
    assert.deepEqual([1, 2].map((n) => t('table.secondsLeft', n)), ['1 second left', '2 seconds left']);
    assert.deepEqual([1, 3].map((n) => t('end.wonRounds', n)), ['won · 1 round', 'won · 3 rounds']);
    assert.deepEqual([1, 2].map((n) => t('tablo.sessionHeader', n)), ['1 match played · lobby', '2 matches played · lobby']);
    assert.equal(t('common.andList', ['Ada']), 'Ada');
    assert.equal(t('common.andList', ['Ada', 'Bora']), 'Ada and Bora');
    assert.equal(t('common.andList', ['Ada', 'Bora', 'Cem']), 'Ada, Bora and Cem');
    assert.equal(t('lobby.waitingForHost', 'Selin'), 'The table opens when Selin starts the match');
    assert.equal(t('lobby.waitingForHost', ''), 'The table opens when the host starts the match');
    assert.equal(t('tableTools.toolLine', 'Ada', 'Chain', 'Bora and Cem'), 'Ada used an item: Chain · Bora and Cem.');
    assert.equal(t('table.shotAtOther', 'Ada', 'Bora'), 'Ada fired at Bora.');
    assert.equal(t('table.reloadCounts', 1, 4), '1 Loaded · 4 Empty');
  }));

  test('models read their texts when called, so a language switch reaches them (no texts frozen at import)', () => {
    const part = (count, points) => ({ count, points });
    const row = {
      breakdown: {
        liveOnOther: part(1, 1), blankOnOther: part(0, 0), blankOnSelf: part(2, 4), liveOnSelf: part(1, -1),
        eliminations: part(1, 2), rounds: part(2, 10), win: part(0, 0), predictions: part(0, 0),
      },
    };
    const labels = (lang) => inLanguage(lang, () => breakdownLines(row, 'classic').map((line) => line.label));
    assert.deepEqual(labels('en').slice(0, 5), ['Loaded at others', 'Empty at others', 'Empty at yourself', 'Loaded at yourself', 'Elimination']);
    assert.deepEqual(labels('tr').slice(0, 5), ['Başkasına dolu', 'Başkasına boş', 'Kendine boş', 'Kendine dolu', 'Eleme']);
    assert.deepEqual(inLanguage('en', () => STEPPED_SETTINGS.map((s) => s.label)), ['Lives (tea glasses)', 'Items per round', 'Max items per turn', 'Time to fire']);
    assert.deepEqual(inLanguage('en', () => [toolName('detector'), toolHelp('heal'), ...toolTags('steal'), modeLabel('classic'), errorMessage('WRONG_PIN')]),
      ['Eye', "Win back one glass. You can't go above the glasses you started with.", 'on your turn', 'everyone sees · not what you take', 'Classic', 'Wrong PIN.']);
  });

  test('the effects strip puts the bold count where each language wants it', () => {
    for (const [lang, examined, before, after] of [
      ['tr', 3, ' · şu anki ve sonraki 2 mermide ', ''],
      ['tr', 2, ' · kalan 2 mermide ', ''],
      ['en', 3, ' · ', ' in the current and next 2 bullets'],
      ['en', 1, ' · ', ' in the last 1 bullet'],
    ]) {
      const text = inLanguage(lang, () => resultText({ tool: 'counter', examined, live: 1 }));
      assert.equal(text.text, before, `${lang} ${examined}`);
      assert.equal(text.after, after, `${lang} ${examined}`);
    }
    for (const locale of [tr, en]) {
      for (const n of [1, 2, 3]) assert.equal(locale.tableTools.counterResult(n).split(BOLD_SLOT).length, 2, `one slot (${n})`);
    }
    assert.deepEqual(splitBold('a {b} c'), ['a ', ' c']);
    assert.deepEqual(splitBold('no slot'), ['no slot', '']);
  });
});

describe('t(), lookups and the language choice', () => {
  test('Turkish is the default; Turkish and English exist', () => {
    assert.equal(DEFAULT_LANGUAGE, 'tr');
    assert.deepEqual(LANGUAGES, ['tr', 'en']);
    assert.equal(getLanguage(), 'tr');
    assert.ok(Object.isFrozen(LOCALES.tr.tools.names));
    assert.ok(Object.isFrozen(LOCALES.en.tools.names));
  });

  test('each language is named in its own language, whatever the current one', () => {
    for (const lang of ['tr', 'en']) {
      inLanguage(lang, () => {
        assert.equal(languageName('tr'), 'Türkçe');
        assert.equal(languageName('en'), 'English');
        assert.equal(languageName('tr', { short: true }), 'TR');
        assert.equal(languageName('en', { short: true }), 'EN');
      });
    }
    assert.equal(nextLanguage(), 'en');
    assert.equal(inLanguage('en', () => nextLanguage()), 'tr');
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

  test('an English browser with nothing stored gets English; the stored choice always wins', () => {
    assert.equal(chooseLanguage({ stored: null, browser: 'en-GB' }), 'en');
    assert.equal(chooseLanguage({ stored: null, browser: 'en' }), 'en');
    assert.equal(chooseLanguage({ stored: null, browser: 'tr-TR' }), 'tr');
    assert.equal(chooseLanguage({ stored: null, browser: 'de-DE' }), 'tr');
    assert.equal(chooseLanguage({ stored: 'tr', browser: 'en-US' }), 'tr');
    assert.equal(chooseLanguage({ stored: 'en', browser: 'tr-TR' }), 'en');
    assert.equal(chooseLanguage({ stored: 'en', browser: null }), 'en');
  });

  test('a language without a locale (or garbage) falls back to Turkish', () => {
    assert.equal(chooseLanguage({ stored: 'xx' }), 'tr');
    assert.equal(chooseLanguage({ stored: 'xx', browser: 'en-US' }), 'tr');
    assert.equal(resolveLanguage('en'), 'en');
    for (const bad of ['de', 'xx', '', null, undefined, 42, 'constructor', '__proto__', 'EN']) assert.equal(resolveLanguage(bad), 'tr', String(bad));
  });

  test('setLanguage stores the choice on the device; storage failures are ignored', () => {
    const stored = new Map();
    globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) };
    assert.equal(setLanguage('en'), 'en');
    assert.equal(stored.get(STORAGE_KEY), 'en');
    assert.equal(t('table.yourTurn'), 'Your turn');
    assert.equal(initLanguage(), 'en'); // read back from the device
    assert.equal(setLanguage('xx'), 'tr'); // unknown -> Turkish
    assert.equal(stored.get(STORAGE_KEY), 'tr');
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    assert.equal(setLanguage('tr'), 'tr');
    // Nothing readable is stored: the browser's language decides (Node reports one too).
    assert.equal(initLanguage(), chooseLanguage({ stored: null, browser: globalThis.navigator?.language ?? null }));
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
    setLanguage('xx'); // falls back to Turkish, the current language: no change
    setLanguage('en');
    setLanguage('en');
    setLanguage('tr');
    assert.deepEqual(heard, ['en', 'tr']);
    assert.equal(stop(), true);
    setLanguage('en');
    assert.deepEqual(heard, ['en', 'tr']);
  });

  test('a key missing from a language would fall back to Turkish', () => inLanguage('en', () => {
    assert.equal(lookup('table.yourTurn'), 'Your turn');
    assert.equal(lookup('table.yourTurn', 'tr'), 'Sıra sende');
    assert.equal(t('table.noSuchKey'), 'table.noSuchKey');
  }));

  test('casing follows the current language (Turkish dotted and dotless i)', () => {
    assert.equal(lowerCase('İSTANBUL'), 'istanbul');
    assert.equal(lowerCase('IRMAK'), 'ırmak');
    assert.equal(upperCase('iğne'), 'İĞNE');
    assert.equal(upperCase('ılık'), 'ILIK');
    inLanguage('en', () => {
      assert.equal(lowerCase('IRMAK'), 'irmak');
      assert.equal(upperCase('iğne'), 'IĞNE');
    });
  });
});
