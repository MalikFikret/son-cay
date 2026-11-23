// Game UI, tools on the match table (task 4.3a): the hand, the tool card's button, picking a
// tool's targets, El Değiştir's counts, the Çal choice, the effects strip (shields and the secret
// results of detection tools), chain badges, jail / Çift Ateş marks, the last-move lines of
// announced tools, and that a hidden tool leaves no trace in anything another seat's screen
// draws (src/ui/tool-model.js, src/ui/table-model.js, src/ui/tools.js). No browser, no emulator.
//
// Every helper is fed exactly what watchMatch gives a device: viewFor / eventsFor of its own
// seat and listLegalActions of its own seat (legalActionsFor in the room layer).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_IDS, eventsFor, listLegalActions, viewFor } from '../src/engine/index.js';
import { TEXT } from '../src/ui/messages.js';
import { TOOL_HELP, toolHelp, toolTags } from '../src/ui/tools.js';
import {
  cardButton,
  chainPartners,
  detectionResults,
  doubleMark,
  effectsStrip,
  handState,
  handSwapPick,
  keepPicks,
  pickBar,
  pickStep,
  stealAction,
  stealPick,
  toolAction,
  toolErrorText,
  toolTagsOf,
  toolTargets,
} from '../src/ui/tool-model.js';
import { lastMove, seatTags, statusText } from '../src/ui/table-model.js';
import { act, edit, setup, shoot, use } from './helpers.js';

const names = { p1: 'Malik', p2: 'Kerem', p3: 'Selin', p4: 'Zeynep' };
const nameOf = (id) => names[id] ?? id;

// What one device receives: its view, its legal actions and its events (from the start).
function device(state, id, events = []) {
  return {
    view: viewFor(state, id),
    legal: listLegalActions(state, id).filter((a) => a.type !== 'timeout'),
    events: eventsFor(events, id),
  };
}

// Plays actions from a start state, keeping the whole event log.
function run(start, ...actions) {
  let state = start;
  const log = [];
  for (const action of actions) {
    const res = act(state, action);
    state = res.state;
    log.push(...res.events);
  }
  return { state, log };
}

const ALL = ['detector', 'probe', 'counter', 'skip', 'swap', 'flip', 'shuffle', 'double', 'reverse', 'link', 'jail', 'handSwap', 'steal', 'shotShield', 'toolShield', 'heal'];

describe('tool texts (tools.js)', () => {
  test('every engine tool has the approved explanation of "Nasıl oynanır · Malzemeler"', () => {
    for (const tool of TOOL_IDS) assert.ok(toolHelp(tool).length > 10, tool);
    assert.equal(TOOL_HELP.detector, 'Şu anki merminin dolu mu boş mu olduğunu yalnız sana gösterir.');
    assert.equal(toolHelp('constructor'), '');
  });

  test('tags: timing first, then who sees it; Kaydır is hidden in Classic only', () => {
    assert.deepEqual(toolTags('detector'), ['sıranda', 'gizli']);
    assert.deepEqual(toolTags('jail'), ['sıranda', 'herkes görür']);
    assert.deepEqual(toolTags('steal'), ['sıranda', 'herkes görür · ne aldığın gizli']);
    assert.deepEqual(toolTags('heal'), ['her an', 'herkes görür']);
    assert.deepEqual(toolTags('shotShield'), ['her an', 'gizli']);
    assert.deepEqual(toolTags('skip', 'classic'), ['sıranda', 'gizli']);
    assert.deepEqual(toolTags('skip', 'custom'), ['sıranda', 'herkes görür']);
    assert.deepEqual(toolTags('nope'), []);
  });
});

describe('hand state', () => {
  const start = setup({ n: 4, hands: { p1: ['detector', 'heal', 'jail'], p2: ['probe', 'shotShield'] }, chambers: 'LBLB' });

  test('my turn: nothing faded, "bu sıra 0/3" from the engine counter and the match setting', () => {
    const hand = handState(device(start, 'p1').view);
    assert.equal(hand.title, 'Elin · 3 malzeme');
    assert.equal(hand.used, 'bu sıra 0/3');
    assert.deepEqual(hand.tools.map((t) => [t.tool, t.faded, t.anytime]), [['detector', false, false], ['heal', false, true], ['jail', false, false]]);
  });

  test('another player\'s turn: turn tools faded, "her an" tools not, no counter', () => {
    const hand = handState(device(start, 'p2').view);
    assert.equal(hand.used, null);
    assert.deepEqual(hand.tools.map((t) => [t.tool, t.faded]), [['probe', true], ['shotShield', false]]);
  });

  test('the counter follows the engine after a use; an empty hand says so', () => {
    const { state } = run(start, use('p1', 'detector'));
    assert.equal(handState(device(state, 'p1').view).used, 'bu sıra 1/3');
    assert.equal(handState(device(start, 'p3').view).title, TEXT.handEmpty);
  });

  test('no hand for a spectator, an eliminated player or an ended match', () => {
    assert.equal(handState(viewFor(start, null)), null);
    const dead = edit(start, (s) => { s.players[3].alive = false; s.players[3].hp = 0; });
    assert.equal(handState(viewFor(dead, 'p4')), null);
    const ended = edit(start, (s) => { s.status = 'ended'; });
    assert.equal(handState(viewFor(ended, 'p1')), null);
  });
});

describe('tool card button', () => {
  const start = setup({ n: 4, hands: { p1: ['detector', 'heal', 'double', 'steal'], p2: ['probe', 'heal', 'toolShield'] }, hp: { p1: 4, p2: 4 }, chambers: 'LBLB' });
  const button = (state, id, tool) => {
    const d = device(state, id);
    return cardButton({ view: d.view, legalActions: d.legal, tool });
  };

  test('"Kullan" when the engine accepts the tool now, with this turn\'s count on my turn', () => {
    const b = button(start, 'p1', 'detector');
    assert.deepEqual(b, { enabled: true, label: 'Kullan', used: 'Bu sıra: 0/3 malzeme kullandın', warning: null });
  });

  test('a turn tool on someone else\'s turn: disabled "Sıranı bekle"; "her an" tools stay enabled', () => {
    assert.deepEqual(button(start, 'p2', 'probe'), { enabled: false, label: 'Sıranı bekle', used: null, warning: null });
    assert.equal(button(start, 'p2', 'heal').enabled, true);
    assert.equal(button(start, 'p2', 'toolShield').enabled, true);
  });

  test('at the per-turn limit: "Bu sıranın sınırı doldu" (for "her an" tools too, on my own turn)', () => {
    const limited = edit(start, (s) => { s.config.toolsPerTurn = 1; });
    const { state } = run(limited, use('p1', 'detector'));
    assert.equal(button(state, 'p1', 'double').label, 'Bu sıranın sınırı doldu');
    assert.equal(button(state, 'p1', 'heal').label, 'Bu sıranın sınırı doldu');
    assert.equal(button(state, 'p1', 'double').used, 'Bu sıra: 1/1 malzeme kullandın');
    // Outside one's own turn the "her an" tools are free of the limit.
    assert.equal(button(state, 'p2', 'heal').enabled, true);
  });

  test('other refusals: full lives, Çift Ateş already armed, a step pending, a tool not held', () => {
    const full = edit(start, (s) => { s.players[0].hp = s.config.hp; });
    assert.equal(button(full, 'p1', 'heal').label, 'Bardakların zaten tam');
    const { state } = run(start, use('p1', 'double'));
    const again = edit(state, (s) => { s.players[0].hand.push('double'); });
    assert.equal(button(again, 'p1', 'double').label, 'Çift Ateş zaten hazır');
    const pending = run(start, use('p1', 'steal', { target: 'p2' })).state;
    assert.equal(button(pending, 'p1', 'detector').label, 'Önce bekleyen adımı bitir');
    assert.equal(button(pending, 'p1', 'heal').enabled, true, '"her an" tools work in every phase');
    assert.equal(button(start, 'p1', 'jail').enabled, false);
  });

  test('Çal with nothing else to give warns first and says "Yine de kullan"', () => {
    const alone = setup({ n: 3, hands: { p1: ['steal'], p2: ['heal'] } });
    assert.deepEqual(button(alone, 'p1', 'steal'), { enabled: true, label: 'Yine de kullan', used: 'Bu sıra: 0/3 malzeme kullandın', warning: TEXT.stealNothingToGive });
    assert.equal(button(start, 'p1', 'steal').warning, null);
  });
});

describe('picking a tool\'s targets', () => {
  const start = setup({ n: 4, hands: { p1: ['jail', 'link', 'steal', 'handSwap', 'detector'] } });
  const legal = listLegalActions(start, 'p1');

  test('Hapis and Çal pick one other player, Zincir two players (me included), the rest none', () => {
    assert.deepEqual(toolTargets(legal, 'jail'), { need: 1, candidates: ['p2', 'p3', 'p4'] });
    assert.deepEqual(toolTargets(legal, 'steal'), { need: 1, candidates: ['p2', 'p3', 'p4'] });
    assert.deepEqual(toolTargets(legal, 'link').need, 2);
    assert.deepEqual([...toolTargets(legal, 'link').candidates].sort(), ['p1', 'p2', 'p3', 'p4']);
    assert.equal(toolTargets(legal, 'detector').need, 0);
    assert.equal(toolTargets(legal, 'handSwap').need, 0, 'El Değiştir picks after it is used');
    assert.deepEqual(toolTargets(listLegalActions(start, 'p2'), 'jail').candidates, []);
  });

  test('pickStep: a tap adds, a second tap removes, a full pick replaces the last; others are ignored', () => {
    const one = { need: 1, candidates: ['p2', 'p3'] };
    assert.deepEqual(pickStep([], 'p2', one), ['p2']);
    assert.deepEqual(pickStep(['p2'], 'p2', one), []);
    assert.deepEqual(pickStep(['p2'], 'p3', one), ['p3']);
    assert.deepEqual(pickStep(['p2'], 'p9', one), ['p2']);
    const two = { need: 2, candidates: ['p1', 'p2', 'p3'] };
    assert.deepEqual(pickStep(['p1'], 'p2', two), ['p1', 'p2']);
    assert.deepEqual(pickStep(['p1', 'p2'], 'p3', two), ['p1', 'p3']);
    assert.deepEqual(keepPicks(['p1', 'p4'], ['p1', 'p2']), ['p1']);
  });

  test('the action carries the target only inside the tool itself, and only when complete', () => {
    assert.deepEqual(toolAction('jail', ['p3']), { type: 'useTool', tool: 'jail', target: 'p3' });
    assert.equal(toolAction('jail', []), null);
    assert.deepEqual(toolAction('link', ['p1', 'p4']), { type: 'useTool', tool: 'link', targets: ['p1', 'p4'] });
    assert.equal(toolAction('link', ['p1']), null);
    assert.deepEqual(toolAction('detector'), { type: 'useTool', tool: 'detector' });
    assert.equal(toolAction('nope'), null);
    // The engine accepts what the UI builds.
    act(start, { ...toolAction('link', ['p1', 'p4']), playerId: 'p1' });
  });

  test('pick bar texts (names never inside a Turkish word)', () => {
    assert.deepEqual(pickBar({ tool: 'jail', picks: [], need: 1, nameOf, mySeat: 'p1' }), { title: 'Hapis', sub: 'bir oyuncu seç', ready: false });
    assert.deepEqual(pickBar({ tool: 'jail', picks: ['p2'], need: 1, nameOf, mySeat: 'p1' }), { title: 'Hapis', sub: 'Kerem', ready: true });
    assert.equal(pickBar({ tool: 'link', picks: [], need: 2, nameOf, mySeat: 'p1' }).sub, 'iki oyuncu seç');
    assert.equal(pickBar({ tool: 'link', picks: ['p1'], need: 2, nameOf, mySeat: 'p1' }).sub, 'kendin · ikinci oyuncuyu seç');
    assert.equal(pickBar({ tool: 'link', picks: ['p4', 'p2'], need: 2, nameOf, mySeat: 'p1' }).sub, 'Zeynep ve Kerem');
    assert.equal(pickBar({ tool: 'handSwap', picks: [], need: 1, nameOf, mySeat: 'p1' }).sub, TEXT.pickSwap);
  });
});

describe('El Değiştir: counts only', () => {
  const start = setup({ n: 4, hands: { p1: ['handSwap', 'heal'], p2: ['probe', 'jail', 'skip'], p3: [], p4: ['heal'] } });
  const { state } = run(start, use('p1', 'handSwap'));

  test('after the use I see each other player\'s tool COUNT, never the tools', () => {
    const d = device(state, 'p1');
    assert.deepEqual(handSwapPick(d.view, d.legal), { candidates: ['p2', 'p3', 'p4'], counts: { p2: 3, p3: 0, p4: 1 } });
    assert.deepEqual(Object.keys(d.view.self.pending).sort(), ['counts', 'type'], 'counts only, no tools');
  });

  test('nobody else gets the pick, and their view does not show the pending step', () => {
    for (const id of ['p2', 'p3', 'p4']) {
      const d = device(state, id);
      assert.equal(handSwapPick(d.view, d.legal), null);
      assert.equal(d.view.phase.type, 'turn');
    }
  });

  test('the swap is announced with the other name only', () => {
    const res = act(state, { type: 'handSwapTarget', playerId: 'p1', target: 'p2' });
    const line = lastMove(eventsFor(res.events, 'p3'), nameOf);
    assert.equal(line.lead, 'Malik malzeme kullandı: El Değiştir · Kerem.');
  });
});

describe('Çal: the victim\'s tools on my screen only', () => {
  const start = setup({ n: 4, hands: { p1: ['steal', 'heal'], p2: ['probe', 'jail'] } });
  const { state, log } = run(start, use('p1', 'steal', { target: 'p2' }));

  test('the thief sees the victim\'s tools and their own hand to give from', () => {
    assert.deepEqual(stealPick(viewFor(state, 'p1')), { victim: 'p2', tools: ['probe', 'jail'], mine: ['heal'] });
  });

  test('nobody else sees the tools; the public line names the victim only', () => {
    for (const id of ['p2', 'p3', 'p4']) {
      assert.equal(stealPick(viewFor(state, id)), null);
      assert.equal(viewFor(state, id).self?.pending ?? null, null);
      assert.equal(eventsFor(log, id).some((e) => e.type === 'stealPeek'), false);
    }
    assert.equal(lastMove(eventsFor(log, 'p3'), nameOf).lead, 'Malik malzeme kullandı: Çal · Kerem.');
  });

  test('stealAction: an exchange needs both tools, else nothing is taken', () => {
    const pick = stealPick(viewFor(state, 'p1'));
    assert.deepEqual(stealAction({ take: 'jail', give: 'heal', pick }), { type: 'stealChoice', take: 'jail', give: 'heal' });
    assert.deepEqual(stealAction({ take: 'jail', give: null, pick }), { type: 'stealChoice', take: null, give: null });
    assert.deepEqual(stealAction({ take: 'double', give: 'heal', pick }), { type: 'stealChoice', take: null, give: null });
    const res = act(state, { ...stealAction({ take: 'jail', give: 'heal', pick }), playerId: 'p1' });
    assert.deepEqual(viewFor(res.state, 'p1').self.hand, ['jail']);
    assert.equal(stealPick(viewFor(res.state, 'p1')), null);
  });
});

describe('effects strip', () => {
  const start = setup({ n: 4, chambers: 'LBLLB', hands: { p1: ['detector', 'probe', 'counter', 'skip', 'swap', 'flip', 'shuffle', 'detector', 'shotShield', 'toolShield'], p2: ['shotShield'] }, config: { toolsPerTurn: 20 } });
  const strip = (state, log, id) => effectsStrip(viewFor(state, id), eventsFor(log, id));
  const texts = (items) => items.map((i) => `${i.text.name}${i.text.text}${i.text.strong}${i.text.after}`);

  test('Göz, Terazi, Sayaç show their result to me only', () => {
    const { state, log } = run(start, use('p1', 'detector'), use('p1', 'probe'), use('p1', 'counter'));
    assert.deepEqual(texts(strip(state, log, 'p1')), [
      'Göz · şu anki mermi Dolu',
      'Terazi · şu anki ile sonraki farklı',
      'Sayaç · şu anki ve sonraki 2 mermide 2 Dolu',
    ]);
    for (const id of ['p2', 'p3', 'p4']) assert.deepEqual(strip(state, log, id), []);
  });

  test('a result vanishes when its Mermi is fired', () => {
    const { state, log } = run(start, use('p1', 'detector'), shoot('p1', 'p2'));
    assert.deepEqual(strip(state, log, 'p1'), []);
  });

  test('a blank on myself keeps the turn but the result is gone with its Mermi', () => {
    const blankFirst = edit(start, (s) => { s.round.chambers[0].type = 'blank'; });
    const { state, log } = run(blankFirst, use('p1', 'detector'), shoot('p1', 'p1'));
    assert.equal(state.turn.playerId, 'p1');
    assert.deepEqual(strip(state, log, 'p1'), []);
  });

  test('Kaydır: earlier results vanish, the skipped Mermi is shown until the next one goes', () => {
    const { state, log } = run(start, use('p1', 'detector'), use('p1', 'skip'));
    assert.deepEqual(texts(strip(state, log, 'p1')), ['Kaydır · geçtiğin mermi Dolu']);
    const after = run(state, use('p1', 'detector'));
    assert.deepEqual(texts(strip(after.state, log.concat(after.log), 'p1')), ['Kaydır · geçtiğin mermi Dolu', 'Göz · şu anki mermi Boş']);
  });

  test('Hokkabaz and Karıştır move the Mermi: every result vanishes', () => {
    const swapped = run(start, use('p1', 'detector'), use('p1', 'swap'));
    assert.deepEqual(strip(swapped.state, swapped.log, 'p1'), []);
    const shuffled = run(start, use('p1', 'probe'), use('p1', 'shuffle'));
    assert.deepEqual(strip(shuffled.state, shuffled.log, 'p1'), []);
  });

  test('Mermi Çevir: the current Mermi is marked as reversed; flipping again shows it normal', () => {
    const once = run(start, use('p1', 'detector'), use('p1', 'flip'));
    assert.deepEqual(texts(strip(once.state, once.log, 'p1')), ['Göz · şu anki mermi Dolu', 'Mermi Çevir · şu anki mermi ters çalışacak']);
    const twice = edit(once.state, (s) => { s.players[0].hand.push('flip'); });
    const res = act(twice, use('p1', 'flip'));
    assert.deepEqual(texts(strip(res.state, once.log.concat(res.events), 'p1')).at(-1), 'Mermi Çevir · şu anki mermi normal çalışacak');
  });

  test('Terazi on the last Mermi and Sayaç with fewer than three left', () => {
    const last = setup({ n: 3, chambers: 'L', hands: { p1: ['probe', 'counter'] } });
    const { state, log } = run(last, use('p1', 'probe'), use('p1', 'counter'));
    assert.deepEqual(texts(strip(state, log, 'p1')), ['Terazi · bu son mermi, sonrası yok', 'Sayaç · kalan 1 mermide 1 Dolu']);
  });

  test('shields: one icon per kind, faded until active (from my next turn)', () => {
    const { state, log } = run(start, use('p1', 'shotShield'), use('p1', 'toolShield'));
    const items = strip(state, log, 'p1');
    assert.deepEqual(items.map((i) => [i.tool, i.faded]), [['shotShield', true], ['toolShield', true]]);
    assert.equal(texts(items)[0], 'Mermi Kalkanı · sonraki sıradan itibaren çalışır');
    const later = act(state, shoot('p1', 'p2')).state; // live on p2: the turn passes
    assert.deepEqual(effectsStrip(viewFor(later, 'p1'), []).map((i) => i.faded), [false, false]);
    assert.equal(texts(effectsStrip(viewFor(later, 'p1'), []))[0], 'Mermi Kalkanı · etkin');
  });

  test('a shield raised on someone else\'s turn shows on my strip only', () => {
    const { state, log } = run(start, use('p2', 'shotShield'));
    assert.deepEqual(strip(state, log, 'p2').map((i) => i.tool), ['shotShield']);
    assert.deepEqual(strip(state, log, 'p1'), []);
  });

  test('another player\'s receipt is never read, even if delivered', () => {
    const fake = [{ type: 'toolUsed', tool: 'detector', by: 'p2', chamber: 'live', visibility: 'private', to: ['p2'] }];
    assert.deepEqual(detectionResults(fake, 'p1'), []);
    assert.deepEqual(detectionResults(fake, null), []);
  });
});

describe('chains, jail and Çift Ateş', () => {
  test('chain partners: one badge per link, also with several chains and far seats', () => {
    const links = [['p1', 'p3'], ['p3', 'p9'], ['p2', 'p4']];
    assert.deepEqual(chainPartners(links, 'p3'), ['p1', 'p9']);
    assert.deepEqual(chainPartners(links, 'p4'), ['p2']);
    assert.deepEqual(chainPartners(links, 'p5'), []);
    assert.deepEqual(chainPartners(null, 'p1'), []);
  });

  test('seat tags: "zincirli" for a linked seat, "hapiste" for a jailed one (public)', () => {
    const start = setup({ n: 4, hands: { p1: ['link', 'jail'] } });
    const { state, log } = run(start, use('p1', 'link', { targets: ['p2', 'p4'] }), use('p1', 'jail', { target: 'p3' }));
    const view = viewFor(state, 'p3');
    const tagsOf = (id) => seatTags(view.players.find((p) => p.id === id), { viewerId: 'p3', turnId: 'p1', target: null, present: true, links: view.links });
    assert.deepEqual(tagsOf('p2'), ['zincirli']);
    assert.deepEqual(tagsOf('p3'), ['sen', 'hapiste']);
    assert.deepEqual(toolTagsOf(view.players[0], view.links), []);
    assert.equal(lastMove(eventsFor(log, 'p2'), nameOf).lead, 'Malik malzeme kullandı: Hapis · Selin.');
    assert.equal(lastMove(eventsFor(log.slice(0, 1), 'p2'), nameOf).lead, 'Malik malzeme kullandı: Zincir · Kerem ve Zeynep.');
  });

  test('a jailed turn is skipped with the existing line', () => {
    const start = setup({ n: 3, hands: { p1: ['jail'] }, chambers: 'LLLL' });
    const { log } = run(start, use('p1', 'jail', { target: 'p2' }), shoot('p1', 'p3'));
    assert.equal(lastMove(eventsFor(log, 'p3'), nameOf).lead, 'Kerem hapiste, sırası geçti.');
  });

  test('"×2" while the next shot is doubled, gone after the shot', () => {
    const start = setup({ n: 3, hands: { p1: ['double'] }, chambers: 'LLLL' });
    const armed = act(start, use('p1', 'double')).state;
    assert.equal(doubleMark(viewFor(armed, 'p2')), '×2');
    assert.equal(doubleMark(viewFor(act(armed, shoot('p1', 'p2')).state, 'p2')), null);
  });

  test('a tool shield\'s block is announced after the tool line', () => {
    const start = setup({ n: 3, hands: { p1: ['jail'], p2: ['toolShield'] } });
    const shielded = edit(run(start, use('p2', 'toolShield')).state, (s) => { s.turn.number = 2; });
    const res = act(shielded, use('p1', 'jail', { target: 'p2' }));
    const line = lastMove(eventsFor(res.events, 'p3'), nameOf);
    assert.equal(line.lead, 'Malik malzeme kullandı: Hapis · Kerem.');
    assert.equal(line.tail, 'Malzeme Kalkanı boşa çıkardı: Kerem.');
  });
});

describe('hidden tools leave no trace on other screens', () => {
  const HIDDEN = ['detector', 'probe', 'counter', 'skip', 'swap', 'flip', 'shotShield', 'toolShield'];
  const hands = { p1: [...ALL], p2: ['shotShield', 'toolShield', 'heal'], p3: ['probe'], p4: [] };
  const start = setup({ n: 4, hands, chambers: 'LBLLBB', hp: { p1: 4 } });

  // Everything another seat's table screen draws from what it receives.
  function screenOf(state, log, id) {
    const view = viewFor(state, id);
    const events = eventsFor(log, id);
    const legal = listLegalActions(state, id);
    return JSON.stringify({
      view,
      legal,
      hand: handState(view),
      strip: effectsStrip(view, events),
      last: lastMove(events, nameOf),
      status: statusText(view, nameOf),
      double: doubleMark(view),
      tags: view.players.map((p) => seatTags(p, { viewerId: id, turnId: view.turn.playerId, target: null, present: true, links: view.links })),
      cards: ALL.map((tool) => cardButton({ view, legalActions: legal, tool })),
    });
  }

  for (const tool of HIDDEN) {
    test(`${tool} by the turn player: no event and nothing drawn differently for the others`, () => {
      const log = [];
      const res = act(start, use('p1', tool));
      for (const id of ['p2', 'p3', 'p4']) {
        assert.deepEqual(eventsFor(res.events, id), [], `${id} receives no event`);
        assert.equal(screenOf(res.state, log.concat(res.events), id), screenOf(start, log, id), `${id}'s screen is unchanged`);
      }
      assert.ok(eventsFor(res.events, 'p1').length > 0, 'the user gets the private receipt');
    });
  }

  for (const tool of ['shotShield', 'toolShield']) {
    test(`${tool} raised on someone else's turn: the turn player's screen is unchanged`, () => {
      const res = act(start, use('p2', tool));
      for (const id of ['p1', 'p3', 'p4']) {
        assert.deepEqual(eventsFor(res.events, id), []);
        assert.equal(screenOf(res.state, res.events, id), screenOf(start, [], id));
      }
    });
  }

  test('the announced tools do produce a public line (the contrast)', () => {
    for (const [tool, extra] of [['shuffle', {}], ['double', {}], ['reverse', {}], ['heal', {}], ['link', { targets: ['p2', 'p3'] }], ['jail', { target: 'p2' }], ['steal', { target: 'p2' }]]) {
      const res = act(start, use('p1', tool, extra));
      assert.ok(lastMove(eventsFor(res.events, 'p3'), nameOf).lead.startsWith('Malik malzeme kullandı: '), tool);
    }
  });
});

describe('tool refusals', () => {
  test('engine codes become short Turkish lines, never raw codes', () => {
    assert.equal(toolErrorText({ code: 'TOOL_LIMIT_REACHED' }), 'Bu sıranın sınırı doldu');
    assert.equal(toolErrorText({ code: 'NOT_YOUR_TURN' }), 'Sıranı bekle');
    assert.equal(toolErrorText({ code: 'HP_FULL' }), 'Bardakların zaten tam');
    assert.equal(toolErrorText({ code: 'SOMETHING' }), TEXT.toolRefused);
    assert.equal(toolErrorText(undefined), TEXT.toolRefused);
  });
});
