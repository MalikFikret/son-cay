// Game UI: the tools as the player sees them (src/ui/tools.js): one approved Turkish name and
// both approved icons per engine tool id, icons built only from safe constant shapes, and the
// vocabulary rule (a bullet is "Mermi", never "kurşun") over every UI file.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TOOL_IDS, TOOL_INFO } from '../src/engine/index.js';
import {
  FRAME_COPPER,
  FRAME_TURQUOISE,
  ICON_SIZES,
  TOOL_DRAWINGS,
  frameColor,
  isTool,
  toolIconTree,
  toolName,
} from '../src/ui/tools.js';
import tr from '../src/ui/i18n/tr.js';

// The approved names are locale entries keyed by tool id (src/ui/i18n/tr.js).
const TOOL_NAMES = tr.tools.names;

const APPROVED = {
  detector: 'Göz',
  probe: 'Terazi',
  counter: 'Sayaç',
  skip: 'Kaydır',
  swap: 'Hokkabaz',
  flip: 'Mermi Çevir',
  shuffle: 'Karıştır',
  double: 'Çift Ateş',
  reverse: 'Yön Değiştir',
  link: 'Zincir',
  jail: 'Hapis',
  handSwap: 'El Değiştir',
  steal: 'Çal',
  shotShield: 'Mermi Kalkanı',
  toolShield: 'Malzeme Kalkanı',
  heal: 'Pansuman',
};

// Every element of a tree, depth first.
function* walk(node) {
  yield node;
  for (const child of node.slice(2)) yield* walk(child);
}

describe('tool names', () => {
  test('every engine tool id has exactly one name, the approved one, and names are unique', () => {
    assert.deepEqual(Object.keys(TOOL_NAMES).sort(), [...TOOL_IDS].sort());
    assert.deepEqual({ ...TOOL_NAMES }, APPROVED);
    assert.equal(new Set(Object.values(TOOL_NAMES)).size, TOOL_IDS.length);
    for (const tool of TOOL_IDS) assert.equal(toolName(tool), APPROVED[tool]);
  });

  test('anything that is not a tool id has no name', () => {
    for (const value of ['', 'nope', 'constructor', '__proto__', 'toString', null, undefined, 3]) {
      assert.equal(isTool(value), false, String(value));
      assert.equal(toolName(value), '', String(value));
    }
  });
});

describe('tool icons', () => {
  test('every engine tool id has both icons, and nothing else has one', () => {
    assert.deepEqual(Object.keys(TOOL_DRAWINGS).sort(), [...TOOL_IDS].sort());
    assert.deepEqual([...ICON_SIZES], ['large', 'small']);
    for (const tool of TOOL_IDS) {
      for (const size of ICON_SIZES) {
        assert.ok(Array.isArray(TOOL_DRAWINGS[tool][size]) && TOOL_DRAWINGS[tool][size].length > 0, `${tool} ${size}`);
        const tree = toolIconTree(tool, size);
        assert.equal(tree[0], 'svg');
        assert.equal(tree[1].viewBox, '0 0 80 80');
      }
    }
    for (const value of ['nope', 'constructor', '__proto__']) assert.throws(() => toolIconTree(value, 'small'));
    assert.throws(() => toolIconTree('heal', 'medium'));
  });

  test('LARGE: double frame and stroke 2.2; SMALL: single frame and stroke 3', () => {
    for (const tool of TOOL_IDS) {
      const large = toolIconTree(tool, 'large');
      const small = toolIconTree(tool, 'small');
      assert.equal(large.slice(2).filter((n) => n[0] === 'circle').length, 2, tool);
      assert.equal(small.slice(2).filter((n) => n[0] === 'circle').length, 1, tool);
      assert.equal(large.at(-1)[1]['stroke-width'], '2.2');
      assert.equal(small.at(-1)[1]['stroke-width'], '3');
    }
  });

  test('copper frame exactly for the three tools usable at any time, turquoise for the rest', () => {
    const copper = TOOL_IDS.filter((tool) => frameColor(tool) === FRAME_COPPER).sort();
    assert.deepEqual(copper, ['heal', 'shotShield', 'toolShield']);
    for (const tool of TOOL_IDS) {
      const expected = TOOL_INFO[tool].timing === 'anytime' ? FRAME_COPPER : FRAME_TURQUOISE;
      for (const size of ICON_SIZES) assert.equal(toolIconTree(tool, size)[2][1].stroke, expected, `${tool} ${size}`);
    }
  });

  test('icons are made of plain shapes only: no scripts, links, events or foreign content', () => {
    const TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'ellipse']);
    for (const tool of TOOL_IDS) {
      for (const size of ICON_SIZES) {
        for (const [tag, attrs] of walk(toolIconTree(tool, size))) {
          assert.ok(TAGS.has(tag), `${tool} ${size}: <${tag}>`);
          for (const [name, value] of Object.entries(attrs)) {
            assert.doesNotMatch(name, /^on|href|style/i, `${tool} ${size}: ${name}`);
            assert.equal(typeof value, 'string');
            assert.doesNotMatch(value, /url\(|javascript:|[<>]/i, `${tool} ${size}: ${name}`);
          }
        }
      }
    }
  });
});

describe('vocabulary', () => {
  function uiFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) files.push(...uiFiles(url));
      else files.push(url);
    }
    return files;
  }

  test('no UI file says "kurşun" (a bullet is "Mermi")', () => {
    const root = new URL('../', import.meta.url);
    const files = [...uiFiles(new URL('src/ui/', root)), new URL('index.html', root)];
    assert.ok(files.length > 10);
    for (const url of files) {
      const text = readFileSync(url, 'utf8').toLocaleLowerCase('tr');
      assert.ok(!text.includes('kurşun'), url.pathname);
    }
  });
});
