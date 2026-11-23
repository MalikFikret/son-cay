// The private tool result notice (decision Q69, src/ui/tool-notice.js). Every case runs the real
// engine and reads the events as each device receives them (eventsFor). No browser, no emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFor, publicEvents } from '../src/engine/index.js';
import { TOOL_NOTICE_MS, toolNotice } from '../src/ui/tool-notice.js';
import { act, setup, use } from './helpers.js';

// p1 uses `tool` with the given chambers left; returns what p1's and p2's devices receive.
function useTool(tool, chambers) {
  const { events } = act(setup({ chambers, hands: { p1: [tool] } }), use('p1', tool));
  return { mine: eventsFor(events, 'p1'), other: eventsFor(events, 'p2'), all: events };
}

const content = (notice) => notice && [notice.name, notice.word, notice.scope];

describe('toolNotice: each private result', () => {
  test('Göz: Dolu and Boş, the current Mermi', () => {
    assert.deepEqual(content(toolNotice(useTool('detector', 'LBB').mine, 'p1')), ['Göz', 'Dolu', 'şu anki mermi']);
    assert.deepEqual(content(toolNotice(useTool('detector', 'BLB').mine, 'p1')), ['Göz', 'Boş', 'şu anki mermi']);
  });

  test('Terazi: aynı, farklı, and the last Mermi', () => {
    assert.deepEqual(content(toolNotice(useTool('probe', 'LLB').mine, 'p1')), ['Terazi', 'aynı', 'şu anki ile sonraki']);
    assert.deepEqual(content(toolNotice(useTool('probe', 'LBB').mine, 'p1')), ['Terazi', 'farklı', 'şu anki ile sonraki']);
    assert.deepEqual(content(toolNotice(useTool('probe', 'L').mine, 'p1')), ['Terazi', 'Son mermi', 'bu son mermi, sonrası yok']);
  });

  test('Sayaç: 3 Mermi and fewer than 3', () => {
    assert.deepEqual(content(toolNotice(useTool('counter', 'LBLB').mine, 'p1')), ['Sayaç', '2 Dolu', 'şu anki ve sonraki 2 mermide']);
    assert.deepEqual(content(toolNotice(useTool('counter', 'BL').mine, 'p1')), ['Sayaç', '1 Dolu', 'kalan 2 mermide']);
  });

  test('Kaydır: the Mermi it put aside', () => {
    assert.deepEqual(content(toolNotice(useTool('skip', 'LBB').mine, 'p1')), ['Kaydır', 'Dolu', 'geçtiğin mermi']);
  });

  test('Mermi Çevir: the flip state', () => {
    assert.deepEqual(content(toolNotice(useTool('flip', 'LBB').mine, 'p1')), ['Mermi Çevir', 'ters çalışacak', 'şu anki mermi']);
  });

  test('3 s for every tool', () => {
    for (const tool of ['detector', 'probe', 'counter', 'skip', 'flip']) {
      assert.equal(toolNotice(useTool(tool, 'LBB').mine, 'p1').durationMs, TOOL_NOTICE_MS);
    }
    assert.equal(TOOL_NOTICE_MS, 3000);
  });
});

describe('toolNotice: nobody else ever gets one', () => {
  for (const tool of ['detector', 'probe', 'counter', 'skip', 'flip']) {
    test(`${tool}: another player's event stream and the public stream produce no notice`, () => {
      const { other, all } = useTool(tool, 'LBB');
      assert.equal(toolNotice(other, 'p2'), null);
      assert.equal(toolNotice(publicEvents(all), 'p2'), null);
      assert.equal(toolNotice(publicEvents(all), 'p1'), null, 'not even the user, from public events');
      // Even holding every raw event, another seat never matches my receipt.
      assert.equal(toolNotice(all, 'p2'), null);
    });
  }

  test('a tool without a private result (Çift Ateş) and an empty update give no notice', () => {
    assert.equal(toolNotice(useTool('double', 'LBB').mine, 'p1'), null);
    assert.equal(toolNotice([], 'p1'), null);
    assert.equal(toolNotice(undefined, 'p1'), null);
    assert.equal(toolNotice(useTool('detector', 'LBB').mine, null), null);
  });
});
