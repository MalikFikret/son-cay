// Game UI: Nasıl oynanır (step 4.8, decision Q73). The pure parts of the page: its routes, the
// Malzemeler tab (exactly the engine's tools, each with its name, explanation and tags in both
// languages, from the shared tools.* entries), the numbers of the Kurallar tab (the engine's
// defaults, never typed by hand) and the source checks (no database, the buttons enabled).

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOT_SECONDS, TOOL_IDS, TOOL_INFO, defaultConfig } from '../src/engine/index.js';
import { DEFAULT_LANGUAGE, LANGUAGES, setLanguage, t } from '../src/ui/i18n/i18n.js';
import tr from '../src/ui/i18n/tr.js';
import en from '../src/ui/i18n/en.js';
import { HOW_TO_TABS, ROUTES, hashFor, parseRoute } from '../src/ui/routes.js';
import { TAG_KINDS, howToTags, howToTools, ruleNumbers, tagLegend, turnCases } from '../src/ui/howto-model.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

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

describe('Nasıl oynanır routes', () => {
  test('#/nasil is the Kurallar tab, #/nasil/malzemeler the Malzemeler tab', () => {
    assert.deepEqual(parseRoute('#/nasil'), { name: ROUTES.HOW_TO, tab: HOW_TO_TABS.RULES });
    assert.deepEqual(parseRoute('#/nasil/'), { name: ROUTES.HOW_TO, tab: HOW_TO_TABS.RULES });
    assert.deepEqual(parseRoute('#/nasil/malzemeler'), { name: ROUTES.HOW_TO, tab: HOW_TO_TABS.TOOLS });
    assert.deepEqual(parseRoute('#/nasil/malzemeler?x=1'), { name: ROUTES.HOW_TO, tab: HOW_TO_TABS.TOOLS });
    assert.equal(parseRoute('#/nasil/xyz').name, ROUTES.UNKNOWN);
    assert.equal(parseRoute('#/nasil/malzemeler/x').name, ROUTES.UNKNOWN);
  });

  test('hashFor.howTo round-trips', () => {
    assert.equal(hashFor.howTo(), '#/nasil');
    assert.equal(hashFor.howTo(HOW_TO_TABS.TOOLS), '#/nasil/malzemeler');
    for (const tab of Object.values(HOW_TO_TABS)) assert.equal(parseRoute(hashFor.howTo(tab)).tab, tab);
  });
});

describe('the Malzemeler tab lists exactly the 16 engine tools', () => {
  for (const lang of LANGUAGES) {
    test(`each with its name, explanation and tags (${lang})`, () => inLanguage(lang, () => {
      const locale = lang === 'en' ? en : tr;
      const tools = howToTools();
      const rows = [...tools.turn, ...tools.anytime];
      assert.equal(TOOL_IDS.length, 16);
      assert.equal(tools.count, 16);
      assert.deepEqual(rows.map((row) => row.id).sort(), [...TOOL_IDS].sort());
      assert.equal(new Set(rows.map((row) => row.id)).size, 16);
      for (const row of rows) {
        // The shared tools.* entries, not a second copy.
        assert.equal(row.name, locale.tools.names[row.id], row.id);
        assert.equal(row.help, locale.tools.help[row.id], row.id);
        assert.ok(row.name.length > 0 && row.help.length > 0, row.id);
        assert.ok(row.tags.length >= 1, row.id);
        const tagTexts = Object.values(locale.tools.tags);
        for (const tag of row.tags) {
          assert.ok(Object.values(TAG_KINDS).includes(tag.kind), row.id);
          assert.ok(tagTexts.includes(tag.text), `${row.id}: ${tag.text}`);
        }
      }
    }));
  }

  test('"Sıranda" holds the turn tools, "Her an" the three copper ones, in the engine order', () => {
    const tools = howToTools();
    assert.deepEqual(tools.turn.map((r) => r.id), TOOL_IDS.filter((id) => TOOL_INFO[id].timing === 'turn'));
    assert.deepEqual(tools.anytime.map((r) => r.id), ['shotShield', 'toolShield', 'heal']);
  });

  test('tags as in the mock: "her an" first for the copper ones, then the visibility', () => {
    const kinds = (id) => howToTags(id).map((tag) => tag.kind);
    assert.deepEqual(kinds('detector'), ['hidden']);
    assert.deepEqual(kinds('skip'), ['hidden']); // hidden in Classic
    assert.deepEqual(kinds('shuffle'), ['announced']);
    assert.deepEqual(howToTags('steal').map((tag) => tag.text), ['herkes görür · ne aldığın gizli']);
    assert.deepEqual(kinds('shotShield'), ['anytime', 'hidden']);
    assert.deepEqual(kinds('toolShield'), ['anytime', 'hidden']);
    assert.deepEqual(kinds('heal'), ['anytime', 'announced']);
    assert.deepEqual(howToTags('constructor'), []);
  });

  test('the legend names the three tags in both languages', () => {
    for (const lang of LANGUAGES) {
      inLanguage(lang, () => {
        const legend = tagLegend();
        assert.deepEqual(legend.map((row) => row.kind), ['hidden', 'announced', 'anytime']);
        for (const row of legend) assert.ok(row.tag.length > 0 && row.text.length > 0);
      });
    }
  });
});

describe('the Kurallar tab', () => {
  test('the "usually" numbers are the engine defaults and the loot time its constant', () => {
    const config = defaultConfig('classic');
    assert.deepEqual(ruleNumbers(), { shotTimeSeconds: config.shotTimeSeconds, toolsPerTurn: config.toolsPerTurn, lootSeconds: LOOT_SECONDS });
    assert.equal(t('howTo.timeText', ruleNumbers().shotTimeSeconds).includes(`genelde ${config.shotTimeSeconds} saniye`), true);
    assert.equal(t('howTo.itemsNote', ruleNumbers().toolsPerTurn).includes(`(genelde ${config.toolsPerTurn})`), true);
    assert.equal(t('howTo.lootTime', LOOT_SECONDS).includes(`${LOOT_SECONDS} saniyen`), true);
    assert.equal(t('howTo.itemsAll', TOOL_IDS.length), '16 malzemenin hepsi');
  });

  test('the screen passes the engine numbers, never typed ones', () => {
    const src = read('src/ui/screens/howto.js');
    assert.match(src, /t\('howTo\.timeText', numbers\.shotTimeSeconds\)/);
    assert.match(src, /t\('howTo\.itemsNote', numbers\.toolsPerTurn\)/);
    assert.match(src, /t\('howTo\.lootTime', numbers\.lootSeconds\)/);
    assert.match(src, /t\('howTo\.itemsAll', tools\.count\)/);
  });

  test('the four cases of Sıra; only "Kendine · boş" keeps the turn', () => {
    for (const lang of LANGUAGES) {
      inLanguage(lang, () => {
        const cases = turnCases();
        assert.equal(cases.length, 4);
        assert.deepEqual(cases.map((c) => c.keepsTurn), [true, false, false, false]);
        for (const c of cases) assert.ok(c.label.length > 0 && c.result.length > 0);
      });
    }
  });

  test('copper items: free of the turn limit only on someone else\'s turn (as the engine counts)', () => {
    assert.equal(tr.howTo.itemsNote(3), 'Sırandayken masanın izin verdiği sayıya kadar (genelde 3) kullanırsın. Bakır çerçeveliler her an kullanılır; başkasının sırasında kullanırsan bu sayıdan düşmez.');
    assert.equal(en.howTo.itemsNote(3), "On your turn you can use as many as the table allows (usually 3). Copper-framed items can be used at any time; used on someone else's turn, they don't count toward that limit.");
    assert.match(tr.howTo.legendAnytime, /başkasının sırasında kullanırsan/);
    assert.match(en.howTo.legendAnytime, /used on someone else's turn/);
  });

  test('the approved Q73 additions are there, word for word', () => {
    assert.equal(tr.howTo.turnAiming, 'Hedefini yalnız sen görürsün, ateşlenene kadar kimse bilmez. Kısa bas: hemen ateşler. Basılı tut: horoz çekilir, parmağını kaldırınca ateşler. Vazgeçmek için parmağını düğmenin dışına kaydır.');
    assert.equal(tr.howTo.timeHold, 'Düğmeye basılı tutarken süre biterse de tabanca kendine ateşlenir.');
    assert.equal(tr.howTo.lootTime(15), 'Oyun durmaz: seçmek için 15 saniyen var. Seçmezsen hiçbir şey almazsın.');
  });
});

describe('opening and closing (source checks)', () => {
  test('Giriş and the match ⋮ menu open the page; "Ayarlar" stays disabled', () => {
    const home = read('src/ui/screens/home.js');
    assert.match(home, /ctx\.go\(hashFor\.howTo\(\)\)/);
    assert.match(home, /disabled: true, title: t\('common\.soon'\) \}, icon\('gear'\)/);
    const table = read('src/ui/screens/table.js');
    assert.match(table, /menuItem\(t\('common\.howToPlay'\), \{ onClick:/);
    assert.match(table, /menuItem\(t\('common\.settings'\), \{ disabled: true \}\)/);
    assert.match(read('src/ui/screens/lobby.js'), /onHowTo: \(\) => ctx\.go\(hashFor\.howTo\(\)\)/);
  });

  test('the page touches no database and no seat', () => {
    const src = read('src/ui/screens/howto.js') + read('src/ui/howto-model.js');
    assert.doesNotMatch(src, /ctx\.api|submitAction|leaveRoom|keeper\.(release|hold|away|back)/);
    assert.doesNotMatch(src, /innerHTML/);
  });
});
