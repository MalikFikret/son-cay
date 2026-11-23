// Masa: the match table, shown in place of the waiting room while a match runs (approved mocks
// "Masa · sıra sende" and "Masa · başkasının sırası", conversation 13, models 3 and 4).
//
// Top to bottom: the top bar (round, table code, the live Tablo; Ayarlar / ? disabled for now),
// the seats around the table with their tea-glass lives and the turn direction, the revolver in
// the middle, the status line with the countdown and the last move, my effects strip, then my
// hand and the fire button on my turn, or the "İzliyorsun" strip for a player who is out or a
// seat that joined during the match. Tools (task 4.3a): a tap on a tool opens its card; a tool
// with a target is aimed on the table (the pick bar replaces the fire button meanwhile); El
// Değiştir shows the tool COUNTS on the seats, Çal its own sheet with the victim's tools.
// Loot (task 4.3b, decision 63): the looter alone gets a "Ganimet" card above the hand, one row
// per victim, with its own 15 s countdown; the game goes on meanwhile.
// Fidye (task 4.3c, decision 64): a jailed player with tools gets a "Fidye" row above the hand
// (a sheet like Çal's: a player, a tool, "Teklif et"; a pending offer with "Geri çek"); the
// recipient gets a card like the Ganimet card ("Kabul et" / "Reddet", no countdown). Only those
// two see anything, plus a short line when the offer closes; everyone else sees only the public
// "X hapisten çıktı.". The host sees a kick button on a disconnected
// player's seat (removeAbsentPlayer). After the last shot the end screen (approved mocks 6-8 of
// conversation 13) replaces the table until the player presses "Salona dön".
//
// It reads only what watchMatch gives this device (its own view, events and legal actions).
// Secret aiming: the target I pick stays on this device; it is sent only inside the shot itself
// (one chooseTarget: the engine's confirmation step is off by default, decision 55). Nothing
// about the press is sent either. Every device runs the match clock (runMatchClock).
// Tools follow the same rule: a tool's target leaves this device only inside the tool action,
// and every secret (my hand, my detection results, El Değiştir's counts, the victim's tools of
// Çal) is read from this device's own view and private events only, and never written anywhere.
//
// Every listener, timer and animation stops in destroy().

import { h, svg } from '../dom.js';
import { ICONS, errorLine } from '../components.js';
import { TEXT, errorMessage } from '../messages.js';
import { MODE_LABELS } from '../lobby-model.js';
import { createSheet } from '../sheet.js';
import { createTablo } from '../tablo.js';
import { formatSigned, liveMatchView } from '../tablo-model.js';
import { toolHelp, toolIcon, toolName, toolTags } from '../tools.js';
import {
  cardButton,
  chainPartners,
  doubleMark,
  effectsStrip,
  handState,
  handSwapPick,
  holdsHand,
  keepPicks,
  pickBar,
  pickStep,
  stealAction,
  stealPick,
  toolAction,
  toolErrorText,
  toolTargets,
} from '../tool-model.js';
import { keepLootPick, lootAction, lootCards, lootErrorText, lootPick, lootTexts } from '../loot-model.js';
import {
  acceptAction,
  incomingCards,
  offerAction,
  pendingText,
  ransomChoices,
  ransomErrorText,
  ransomNotices,
  ransomRow,
  rejectAction,
  withdrawAction,
} from '../ransom-model.js';
import { revolverSvg, SHOT_TIMING } from '../revolver.js';
import { LONG_PRESS_MS, PRESS, initialPress, isPressing, pressStep } from '../fire-press.js';
import {
  STAGE_WIDTH,
  URGENT_MS,
  aimAngle,
  canKick,
  directionArrows,
  endHeadline,
  endRanking,
  keepTarget,
  lastMove,
  lastRound,
  msLeft,
  nearestAngle,
  outRounds,
  placeSeats,
  pointsLeft,
  reloadFor,
  revolverSeat,
  seatLayout,
  seatTags,
  secondsShown,
  shotsIn,
  statusText,
  tapTarget,
  targetsFrom,
  watchStrip,
} from '../table-model.js';
import { ROOM_ERR, isSeatPresent, summarizeView } from '../../rooms/index.js';

const LOST_CODES = [ROOM_ERR.SEAT_LOST, ROOM_ERR.NOT_MEMBER, ROOM_ERR.ROOM_NOT_FOUND];
const RELOAD_SHOW_MS = 2200; // the reload announcement stays this long
const END_HOLD_MS = 1600; // the final table stays this long before the end screen
const ERROR_SHOW_MS = 6000;
const RING = 2 * Math.PI * 22; // countdown ring circumference (r = 22)

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {{ api: object, uid: string, code: string, mode: string, mySeat: string,
 *   watchServerOffset?: (fn: (offset: number) => void) => () => void,
 *   onLost: (error: object) => void, onBack: () => void }} options
 *   onLost: this device lost its seat (SEAT_LOST / NOT_MEMBER / ROOM_NOT_FOUND);
 *   onBack: "Salona dön" was pressed on the end screen
 * @returns {{ el: HTMLElement, setRoom(room: object): void, isEnded(): boolean, destroy(): void }}
 */
export function createTable({ api, uid, code, mode, mySeat, watchServerOffset, onLost, onBack }) {
  let destroyed = false;
  const stops = [];
  const timers = new Set();
  let offset = 0;
  let names = {};
  let presence = {};
  let hostSeat = null;
  let session = null; // the session table of the room (watchLobby)
  let inLobby = false; // the room's status is back to "lobby" (results stored)

  let applied = null; // the last update drawn: { n, view, legalActions, clockAt }
  let events = []; // events seen this match (mine: public + my private ones), from the start
  let outs = {}; // seatId -> { round, removed }
  let round = 0; // the round of the last reloaded event
  let endedAt = null; // when the ended state was drawn (local ms)
  const queue = [];
  let running = false;

  let target = null; // my chosen target: on this device only
  let press = initialPress();
  let holdTimer = null;
  let sending = false;
  let angle = NaN;
  let showingEnd = false;
  // Picking a tool's target(s) on the table (mine only, never sent before the tool itself):
  // { tool, picks: string[], need, candidates, kind: 'tool' | 'handSwap' } or null.
  let picking = null;
  let expanded = null; // the effects strip item shown with its text
  let stealSeen = null; // the Çal step whose sheet was opened automatically
  const lootPicks = new Map(); // victim -> { index, tool }: my selection on a Ganimet card
  let lootSending = false;
  let ransomSending = false;
  let ransomTo = null; // the Fidye sheet's choices (this device only)
  let ransomTool = null;

  // --- Static parts --------------------------------------------------------------------------
  const roundTitle = h('span', { class: 'table-round' });
  const topBar = h('header', { class: 'table-top' },
    h('div', { class: 'table-top-text' },
      roundTitle,
      h('span', { class: 'hint', text: TEXT.tableSubtitle(code, MODE_LABELS[mode] ?? '') })),
    h('div', { class: 'table-top-actions' },
      h('button', { type: 'button', class: 'table-top-button', text: TEXT.tablo, on: { click: () => openTablo() } }),
      h('button', { type: 'button', class: 'table-top-button is-square', 'aria-label': TEXT.settings, disabled: true, title: TEXT.soon }, svg(GEAR)),
      h('button', { type: 'button', class: 'table-top-button is-square', 'aria-label': TEXT.howToPlay, disabled: true, title: TEXT.soon },
        h('span', { class: 'table-help', text: '?' }))));

  const disc = h('div', { class: 'table-disc', 'aria-hidden': 'true' });
  const decor = svg(DECOR);
  const arrows = svg(['svg', { class: 'table-arrows', role: 'img', preserveAspectRatio: 'none' }]);
  const revolverWrap = h('div', { class: 'revolver', role: 'img' }, revolverSvg());
  const reloadLive = h('span', { class: 'reload-live' });
  const reloadBlank = h('span', { class: 'reload-blank' });
  const reloadSr = h('span', { class: 'visually-hidden' });
  const reloadBanner = h('div', { class: 'reload-banner', 'aria-hidden': 'true', hidden: true },
    h('span', { class: 'reload-kicker', text: TEXT.reloadLabel }),
    h('span', { class: 'reload-counts' }, reloadLive, h('span', { class: 'reload-dot', text: '·' }), reloadBlank));
  const reloadLive2 = h('p', { class: 'visually-hidden', role: 'status' }, reloadSr);
  // Çift Ateş: "×2" by the revolver until the next shot (public; decision 54, never red).
  const doubleBadge = h('span', { class: 'double-badge', role: 'img', 'aria-label': TEXT.doubleLabel, text: TEXT.doubleMark, hidden: true });
  const stage = h('div', { class: 'table-stage' }, disc, decor, arrows, revolverWrap, doubleBadge, reloadBanner);
  const seatEls = new Map(); // seatId -> { el, tag, name, lives, chains, bars }

  const statusLine = h('h2', { class: 'table-status-text' });
  const lastLine = h('p', { class: 'table-last' });
  const ringBar = svg(['circle', { cx: 26, cy: 26, r: 22, fill: 'none', 'stroke-width': 4, transform: 'rotate(-90 26 26)', class: 'ring-bar' }]);
  const ringText = h('span', { class: 'ring-text' });
  const ring = h('div', { class: 'table-ring', role: 'timer' },
    svg(['svg', { width: 52, height: 52, viewBox: '0 0 52 52', 'aria-hidden': 'true' },
      ['circle', { cx: 26, cy: 26, r: 22, fill: 'none', stroke: '#3A2E24', 'stroke-width': 4 }]]),
    ringText);
  ring.firstChild.append(ringBar);
  const status = h('section', { class: 'table-status' },
    h('div', { class: 'table-status-main', 'aria-live': 'polite' }, statusLine, lastLine), ring);

  // My own effects (decision 54): shields and detection results, small icons, tap to expand.
  const effects = h('div', { class: 'effects', role: 'group', 'aria-label': TEXT.effectsLabel, hidden: true });
  let effectsKey = null;
  const errors = errorLine('table-error');
  const strip = h('p', { class: 'watch-strip', role: 'status', hidden: true });

  // The Ganimet cards (approved mocks 1 and 2 of conversation 13): mine only, above the hand.
  const lootWrap = h('div', { class: 'loot-cards', hidden: true });
  const lootEls = new Map(); // victim -> { el, ringBar, ring, seconds, key, over }

  // Fidye: the recipient's cards, and the jailed player's row (decision 64).
  const ransomWrap = h('div', { class: 'loot-cards ransom-cards', hidden: true });
  let ransomKey = null;
  const ransomText = h('span', { class: 'ransom-text' });
  const ransomOpen = h('button', { type: 'button', class: 'btn btn-outline ransom-open', on: { click: () => openRansom() } });
  const ransomBack = h('button', { type: 'button', class: 'btn btn-outline ransom-withdraw', text: TEXT.ransomWithdraw, on: { click: () => sendRansom(withdrawAction()) } });
  const ransomBar = h('div', { class: 'ransom-row', hidden: true },
    h('span', { class: 'ransom-row-text' }, ransomText),
    h('div', { class: 'ransom-row-actions' }, ransomBack, ransomOpen));
  // A short neutral line for the two players of a closed offer (never red, decision 54).
  const noteLine = h('p', { class: 'table-note', role: 'status', hidden: true });

  const handTitle = h('span', { class: 'hand-title' });
  const handUsed = h('span', { class: 'hand-used' });
  const handList = h('div', { class: 'hand-list' });
  const hand = h('section', { class: 'hand', hidden: true },
    h('div', { class: 'hand-head' }, handTitle, handUsed),
    handList);
  let handKey = null;

  // The pick bar (instead of the fire button while a tool's target is picked) and the Çal bar.
  const stepTitle = h('span', { class: 'step-title' });
  const stepSub = h('span', { class: 'step-sub' });
  const stepCancel = h('button', { type: 'button', class: 'btn btn-outline step-cancel', text: TEXT.cancel, on: { click: () => cancelPick() } });
  const stepGo = h('button', { type: 'button', class: 'btn btn-primary step-go', text: TEXT.use, on: { click: () => onStepGo() } });
  const stepBar = h('div', { class: 'step-bar', hidden: true, role: 'group' },
    h('div', { class: 'step-text', 'aria-live': 'polite' }, stepTitle, stepSub),
    h('div', { class: 'step-actions' }, stepCancel, stepGo));

  const fireMain = h('span', { class: 'fire-main' });
  const fireSub = h('span', { class: 'fire-sub' });
  const fireButton = h('button', { type: 'button', class: 'fire-button' }, fireMain, fireSub);
  const fireWrap = h('div', { class: 'fire-wrap', hidden: true }, fireButton);

  const tableView = h('div', { class: 'table-view' },
    topBar, stage,
    h('div', { class: 'table-lower' }, status, effects, errors.el, noteLine, lootWrap, ransomWrap, ransomBar, hand, strip, stepBar, fireWrap),
    reloadLive2);

  // End screen (filled when the match is over).
  const endTitle = h('h1', { class: 'end-title' });
  const endLine = h('p', { class: 'end-line' });
  const endSub = h('p', { class: 'end-sub' });
  const endList = h('ol', { class: 'end-list' });
  const backButton = h('button', { type: 'button', class: 'btn-back-lobby', text: TEXT.backToLobby, on: { click: () => onBack() } });
  const backNote = h('span', { class: 'hint center end-note', role: 'status' });
  const endTopLeft = h('span', { class: 'hint' });
  const endView = h('div', { class: 'end-screen', hidden: true },
    h('div', { class: 'end-top' }, endTopLeft, h('span', { class: 'hint', text: TEXT.matchEnded })),
    h('div', { class: 'end-head' }, endTitle, endLine, endSub),
    h('section', { class: 'end-ranking', 'aria-label': TEXT.rankingLabel },
      h('div', { class: 'end-ranking-head' },
        h('span', { class: 'end-kicker', text: TEXT.rankingTitle }),
        h('span', { class: 'hint end-cols', text: TEXT.rankingCols })),
      endList),
    h('div', { class: 'end-actions' },
      h('button', { type: 'button', class: 'btn-end-tablo', text: TEXT.tablo, on: { click: () => openTablo() } }),
      backButton),
    backNote);

  const el = h('div', { class: 'table-screen' }, tableView, endView);

  // The live Tablo (the waiting room's panel; "Bu maç" from this device's view and events).
  const tablo = createTablo({ mySeat, loadLastMatch: async () => null });
  tablo.setLive(() => liveView());
  function openTablo() {
    tablo.open('match');
    updateClock();
  }
  function summary() {
    if (!applied) return null;
    return summarizeView({ n: applied.n, view: applied.view, events });
  }
  function liveView() {
    if (!applied) return null;
    return liveMatchView(summary(), {
      mySeat,
      names,
      present: (id) => isSeatPresent(presence[id]),
      round: applied.view.round.index,
      ended: applied.view.status === 'ended',
    });
  }

  // Kicking a disconnected player from the match: a one-line confirmation (host only).
  const kickSheet = createSheet({ title: '' });
  const kickError = errorLine('kick-error');
  const kickYes = h('button', { type: 'button', class: 'btn btn-primary', text: TEXT.kickYes });
  const kickNo = h('button', { type: 'button', class: 'btn btn-outline', text: TEXT.cancel, on: { click: () => kickSheet.close() } });
  kickSheet.body.append(h('p', { class: 'muted', text: TEXT.kickMatchNote }), kickError.el, h('div', { class: 'dialog-actions' }, kickNo, kickYes));
  let kickSeat = null;
  kickYes.addEventListener('click', async () => {
    if (!kickSeat || kickYes.disabled) return;
    kickYes.disabled = true;
    kickError.clear();
    try {
      const result = await api.removeAbsentPlayer({ uid, code, seatId: kickSeat });
      if (destroyed) return;
      if (result && result.ok === false) kickError.show(errorMessage(ROOM_ERR.ACTION_NOT_ALLOWED));
      else kickSheet.close();
    } catch (error) {
      if (destroyed) return;
      if (LOST_CODES.includes(error?.code)) report(error);
      else kickError.show(errorMessage(error));
    } finally {
      kickYes.disabled = false;
    }
  });
  function askKick(seatId) {
    kickSeat = seatId;
    kickSheet.setTitle(TEXT.kickMatchConfirm(nameOf(seatId)));
    kickError.clear();
    kickSheet.open();
  }

  // The tool card (decision 54, approved mock 5): large badge, name, tags, the explanation of
  // "Nasıl oynanır", this turn's count, "Vazgeç" / "Kullan" (or why it cannot be used now).
  let cardTool = null;
  const card = createSheet({ title: '', className: 'tool-card-sheet', onClose: () => { cardTool = null; } });
  const cardIcon = h('div', { class: 'tool-card-icon' });
  const cardName = h('p', { class: 'tool-card-name', 'aria-hidden': 'true' });
  const cardTags = h('div', { class: 'tool-card-tags' });
  const cardHelp = h('p', { class: 'tool-card-help' });
  const cardUsed = h('span', { class: 'hint tool-card-used' });
  const cardWarn = h('p', { class: 'tool-card-warn', role: 'note' });
  const cardNo = h('button', { type: 'button', class: 'btn btn-outline tool-card-no', text: TEXT.cancel, on: { click: () => card.close() } });
  const cardYes = h('button', { type: 'button', class: 'btn btn-primary tool-card-yes', on: { click: () => onCardUse() } });
  card.body.append(h('div', { class: 'tool-card' }, cardIcon, cardName, cardTags, cardHelp, cardUsed, cardWarn,
    h('div', { class: 'tool-card-actions' }, cardNo, cardYes)));

  function openCard(tool) {
    if (!applied || !holdsHand(applied.view)) return;
    if (picking?.kind === 'tool') picking = null;
    cardTool = tool;
    cardIcon.replaceChildren(toolIcon(tool, 'large'));
    cardName.textContent = toolName(tool);
    card.setTitle(toolName(tool));
    cardTags.replaceChildren(...toolTags(tool, mode).map((tag) => h('span', { class: 'tool-tag', text: tag })));
    cardHelp.textContent = toolHelp(tool);
    renderCard();
    card.open();
    renderAll();
  }

  function renderCard() {
    if (cardTool === null || !applied) return;
    const state = cardButton({ view: applied.view, legalActions: applied.legalActions, tool: cardTool });
    cardUsed.textContent = state.used ?? '';
    cardUsed.hidden = !state.used;
    cardWarn.textContent = state.warning ?? '';
    cardWarn.hidden = !state.warning;
    cardYes.textContent = sending && state.enabled ? TEXT.toolSending : state.label;
    cardYes.disabled = !state.enabled || sending;
  }

  function onCardUse() {
    if (cardTool === null || !applied || sending) return;
    const tool = cardTool;
    if (!cardButton({ view: applied.view, legalActions: applied.legalActions, tool }).enabled) return;
    const spec = toolTargets(applied.legalActions, tool);
    card.close();
    if (spec.need === 0) {
      sendTool(toolAction(tool));
      return;
    }
    // The target is picked on the table, then confirmed in the pick bar (never sent before).
    target = null;
    picking = { tool, picks: [], need: spec.need, candidates: spec.candidates, kind: 'tool' };
    renderAll();
  }

  function cancelPick() {
    if (picking?.kind !== 'tool') return;
    picking = null;
    renderAll();
  }

  function onStepGo() {
    if (!applied || sending) return;
    if (stealPick(applied.view)) {
      openSteal();
      return;
    }
    if (!picking || picking.picks.length < picking.need) return;
    if (picking.kind === 'handSwap') {
      sendTool({ type: 'handSwapTarget', target: picking.picks[0] });
      return;
    }
    const action = toolAction(picking.tool, picking.picks);
    picking = null;
    if (action) sendTool(action);
    else renderAll();
  }

  // Sends one tool action of my own seat (the room layer replaces any playerId with mine).
  async function sendTool(action) {
    if (!action || sending) return;
    sending = true;
    renderAll();
    try {
      const result = await api.submitAction({ uid, code, action });
      if (!destroyed && !result.ok) showError(toolErrorText(result.error));
    } catch (error) {
      report(error);
    } finally {
      sending = false;
      if (!destroyed) renderAll();
    }
  }

  // Çal after the look: the victim's tools, shown to me only, from my own view (self.pending).
  const stealSheet = createSheet({ title: '', className: 'steal-sheet' });
  const stealBody = h('div', { class: 'steal-body' });
  const stealNo = h('button', { type: 'button', class: 'btn btn-outline', text: TEXT.stealNothing, on: { click: () => sendSteal(false) } });
  const stealYes = h('button', { type: 'button', class: 'btn btn-primary', text: TEXT.stealExchange, on: { click: () => sendSteal(true) } });
  stealSheet.body.append(h('p', { class: 'hint steal-note', text: TEXT.onlyYouSee }), stealBody,
    h('div', { class: 'dialog-actions' }, stealNo, stealYes));
  let stealTake = null; // { index, tool } in the victim's list
  let stealGive = null; // { index, tool } in my hand

  function openSteal() {
    if (!applied || !stealPick(applied.view)) return;
    renderSteal();
    stealSheet.open();
  }

  function renderSteal() {
    const pick = applied ? stealPick(applied.view) : null;
    if (!pick) return;
    stealSheet.setTitle(TEXT.stealTitle(nameOf(pick.victim)));
    if (stealTake && pick.tools[stealTake.index] !== stealTake.tool) stealTake = null;
    if (stealGive && pick.mine[stealGive.index] !== stealGive.tool) stealGive = null;
    const list = (tools, chosen, choose) => h('div', { class: 'steal-list' }, ...tools.map((tool, index) => h('button', {
      type: 'button',
      class: chosen?.index === index ? 'steal-tool is-chosen' : 'steal-tool',
      'aria-pressed': String(chosen?.index === index),
      disabled: sending,
      on: { click: () => { choose(chosen?.index === index ? null : { index, tool }); renderSteal(); } },
    }, toolIcon(tool, 'small'), h('span', { class: 'hand-name', text: toolName(tool) }))));
    const parts = [];
    if (pick.tools.length === 0) {
      parts.push(h('p', { class: 'muted', text: TEXT.stealVictimEmpty(nameOf(pick.victim)) }));
    } else {
      parts.push(h('h3', { class: 'steal-head', text: TEXT.stealTake }), list(pick.tools, stealTake, (c) => { stealTake = c; }));
      if (pick.mine.length === 0) parts.push(h('p', { class: 'muted', text: TEXT.stealMineEmpty }));
      else parts.push(h('h3', { class: 'steal-head', text: TEXT.stealGive }), list(pick.mine, stealGive, (c) => { stealGive = c; }));
    }
    stealBody.replaceChildren(...parts);
    stealYes.hidden = pick.tools.length === 0 || pick.mine.length === 0;
    stealYes.disabled = sending || !stealTake || !stealGive;
    stealNo.disabled = sending;
  }

  async function sendSteal(exchange) {
    const pick = applied ? stealPick(applied.view) : null;
    if (!pick || sending) return;
    const action = stealAction({ take: exchange ? stealTake?.tool ?? null : null, give: exchange ? stealGive?.tool ?? null : null, pick });
    stealSheet.close();
    stealTake = null;
    stealGive = null;
    await sendTool(action);
  }

  // The Fidye sheet (decision 64, built like Çal's): a living player, one of my tools, "Teklif et".
  const ransomSheet = createSheet({ title: TEXT.ransomButton, className: 'steal-sheet ransom-sheet' });
  const ransomBody = h('div', { class: 'steal-body' });
  const ransomNo = h('button', { type: 'button', class: 'btn btn-outline', text: TEXT.cancel, on: { click: () => ransomSheet.close() } });
  const ransomYes = h('button', { type: 'button', class: 'btn btn-primary', text: TEXT.ransomSend, on: { click: () => sendOffer() } });
  ransomSheet.body.append(h('p', { class: 'hint steal-note', text: TEXT.ransomSheetNote }), ransomBody,
    h('div', { class: 'dialog-actions' }, ransomNo, ransomYes));

  function openRansom() {
    if (!applied || !ransomRow(applied.view)?.canOffer) return;
    const pending = ransomRow(applied.view).pending;
    ransomTo = pending ? pending.to : null;
    ransomTool = null;
    renderRansomSheet();
    ransomSheet.open();
  }

  function renderRansomSheet() {
    const choices = applied ? ransomChoices(applied.legalActions) : { players: [], tools: [] };
    if (!choices.players.includes(ransomTo)) ransomTo = null;
    if (!choices.tools.includes(ransomTool)) ransomTool = null;
    const players = h('div', { class: 'steal-list' }, ...choices.players.map((id) => h('button', {
      type: 'button',
      class: id === ransomTo ? 'ransom-player is-chosen' : 'ransom-player',
      'aria-pressed': String(id === ransomTo),
      disabled: ransomSending,
      text: nameOf(id),
      on: { click: () => { ransomTo = ransomTo === id ? null : id; renderRansomSheet(); } },
    })));
    const tools = h('div', { class: 'steal-list' }, ...choices.tools.map((tool) => h('button', {
      type: 'button',
      class: tool === ransomTool ? 'steal-tool is-chosen' : 'steal-tool',
      'aria-pressed': String(tool === ransomTool),
      disabled: ransomSending,
      on: { click: () => { ransomTool = ransomTool === tool ? null : tool; renderRansomSheet(); } },
    }, toolIcon(tool, 'small'), h('span', { class: 'hand-name', text: toolName(tool) }))));
    ransomBody.replaceChildren(
      h('h3', { class: 'steal-head', text: TEXT.ransomTo }), players,
      h('h3', { class: 'steal-head', text: TEXT.ransomWhich }), tools);
    ransomYes.disabled = ransomSending || offerAction({ to: ransomTo, tool: ransomTool }, choices) === null;
    ransomNo.disabled = ransomSending;
  }

  async function sendOffer() {
    const action = applied ? offerAction({ to: ransomTo, tool: ransomTool }, ransomChoices(applied.legalActions)) : null;
    if (!action) return;
    ransomSheet.close();
    await sendRansom(action);
  }

  // Sends one ransom action of my own seat; nothing else about an offer is written anywhere.
  async function sendRansom(action) {
    if (!action || ransomSending) return;
    ransomSending = true;
    renderRansom();
    try {
      const result = await api.submitAction({ uid, code, action });
      if (!destroyed && !result.ok) showError(ransomErrorText(result.error));
    } catch (error) {
      report(error);
    } finally {
      ransomSending = false;
      if (!destroyed) renderRansom();
    }
  }

  function showNote(text) {
    noteLine.textContent = text;
    noteLine.hidden = false;
    later(() => { noteLine.hidden = true; }, ERROR_SHOW_MS, 'note');
  }

  // --- Live parts ------------------------------------------------------------------------------
  function report(error) {
    if (destroyed) return;
    if (LOST_CODES.includes(error?.code)) {
      onLost(error);
      return;
    }
    showError(errorMessage(error));
  }

  function showError(text) {
    errors.show(text);
    later(() => errors.clear(), ERROR_SHOW_MS, 'error');
  }

  try {
    stops.push(api.watchMatch({ uid, code, onUpdate: enqueue, onError: report }));
    stops.push(api.runMatchClock({ uid, code, onError: report }));
    if (typeof watchServerOffset === 'function') stops.push(watchServerOffset((value) => { offset = value; }));
  } catch (error) {
    report(error);
  }
  const tick = setInterval(updateClock, 200);

  // A timer that is cleared on destroy. A named one replaces its previous run.
  const named = new Map();
  function later(fn, ms, name) {
    if (name && named.has(name)) {
      clearTimeout(named.get(name));
      timers.delete(named.get(name));
    }
    const id = setTimeout(() => {
      timers.delete(id);
      if (name) named.delete(name);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    if (name) named.set(name, id);
    return id;
  }
  const wait = (ms) => new Promise((resolve) => (ms > 0 ? later(resolve, ms) : resolve()));

  // --- Updates: one at a time, with the shot animation first -------------------------------------
  function enqueue(update) {
    if (destroyed) return;
    queue.push(update);
    if (!running) run();
  }

  async function run() {
    running = true;
    while (queue.length > 0 && !destroyed) {
      const update = queue.shift();
      // Behind by several updates (e.g. a slow tab): draw without animating.
      await play(update, !update.initial && queue.length < 2);
    }
    running = false;
  }

  async function play(update, animate) {
    if (update.initial) {
      events = [];
      outs = {};
      round = 0;
      target = null;
      endedAt = null;
      picking = null;
      expanded = null;
      stealSeen = null;
      lootPicks.clear();
    }
    const shots = shotsIn(update.events);
    if (animate && applied) {
      for (const shot of shots) {
        if (destroyed) return;
        await aimAt(shot.target);
        await shotAnimation(shot);
      }
    }
    if (destroyed) return;
    if (!update.initial) {
      const notes = ransomNotices(update.events, mySeat);
      if (notes.length > 0) showNote(notes.join(' '));
    }
    outs = outRounds(update.events, outs, round);
    round = lastRound(update.events, round);
    events = events.concat(update.events);
    const wasMine = applied?.view.turn.playerId === mySeat;
    applied = update;
    if (shots.length > 0 || !wasMine) target = null;
    target = keepTarget(target, myTargets());
    syncTools();
    if (update.view.status === 'ended' && endedAt === null) {
      endedAt = Date.now();
      dispatch({ type: 'expire' });
      kickSheet.close();
      // The final table a moment (at once on a reloaded page), then the end screen.
      later(showEnd, update.initial ? 0 : END_HOLD_MS, 'end');
    }
    renderAll();
    tablo.refresh();
    const reload = reloadFor(update);
    if (reload) showReload(reload);
  }

  // --- Rendering -------------------------------------------------------------------------------
  const nameOf = (id) => names[id] ?? id ?? '';
  const myTurn = () => applied?.view.status === 'active' && applied.view.role === 'alive'
    && applied.view.turn.playerId === mySeat && applied.view.phase.type === 'turn';
  const myTargets = () => (myTurn() ? targetsFrom(applied.legalActions) : []);
  const clockMs = () => (applied ? msLeft({
    clockAt: applied.clockAt, seconds: applied.view.config.shotTimeSeconds, kind: applied.view.clock.kind, serverNow: Date.now() + offset,
  }) : null);
  const canFire = () => myTurn() && target !== null && !picking && !sending && (clockMs() ?? 1) > 0;

  // After every update: keep the tool steps in line with what the engine now says (my view and
  // my legal actions only). El Değiştir's pick and the Çal sheet follow view.self.pending.
  function syncTools() {
    const { view, legalActions } = applied;
    const swap = handSwapPick(view, legalActions);
    if (swap) {
      const picks = picking?.kind === 'handSwap' ? keepPicks(picking.picks, swap.candidates) : [];
      target = null;
      picking = { tool: 'handSwap', picks, need: 1, candidates: swap.candidates, counts: swap.counts, kind: 'handSwap' };
    } else if (picking?.kind === 'handSwap') {
      picking = null;
    } else if (picking) {
      const spec = toolTargets(legalActions, picking.tool);
      picking = spec.need === 0 || spec.candidates.length === 0
        ? null
        : { ...picking, candidates: spec.candidates, picks: keepPicks(picking.picks, spec.candidates) };
    }
    const steal = stealPick(view);
    if (!steal) {
      stealSeen = null;
      stealSheet.close();
    } else if (stealSeen === null) {
      // The look just happened: open the choice once (closing it keeps the Çal bar).
      stealSeen = steal.victim;
      stealTake = null;
      stealGive = null;
      openSteal();
    } else if (stealSheet.isOpen()) {
      renderSteal();
    }
    if (!holdsHand(view)) {
      card.close();
      picking = null;
    } else {
      renderCard();
    }
  }

  function renderAll() {
    if (!applied || destroyed) return;
    const { view } = applied;
    roundTitle.textContent = TEXT.roundTitle(view.round.index);
    doubleBadge.hidden = doubleMark(view) === null;
    renderSeats(view);
    renderStatus(view);
    renderEffects(view);
    renderLoot();
    renderRansom();
    renderHand(view);
    renderStep();
    renderFire();
    renderCard();
    if (stealSheet.isOpen()) renderSteal();
    pointRevolver(revolverSeat({ target, view }));
    updateClock();
  }

  function renderSeats(view) {
    const layout = seatLayout(view.players.length);
    stage.style.height = `${layout.height}px`;
    stage.style.setProperty('--cy', `${layout.cy}px`);
    stage.dataset.size = layout.size;
    const placed = placeSeats(view.players, view.viewer);
    const mine = myTurn();
    const targets = myTargets();
    disc.classList.toggle('is-mine', mine);
    const turnId = view.status === 'active' ? view.turn.playerId : null;
    for (const spot of placed) {
      const player = view.players.find((p) => p.id === spot.id);
      let seat = seatEls.get(spot.id);
      if (!seat) {
        seat = buildSeat(spot.id);
        seatEls.set(spot.id, seat);
        stage.append(seat.el);
      }
      seat.el.style.left = `${(spot.x / STAGE_WIDTH) * 100}%`;
      seat.el.style.top = `${spot.y}px`;
      const present = isSeatPresent(presence[spot.id]);
      const tags = seatTags(player, { viewerId: view.viewer, turnId, target, present, out: outs[spot.id], ended: view.status === 'ended', links: view.links });
      // El Değiştir: the tool COUNT of each player I may swap with (my screen only).
      if (picking?.kind === 'handSwap' && Number.isInteger(picking.counts?.[spot.id])) tags.push(TEXT.toolCount(picking.counts[spot.id]));
      seat.tag.textContent = tags.join(' · ');
      seat.tag.hidden = tags.length === 0;
      seat.name.textContent = nameOf(spot.id);
      if (seat.hp !== player.hp) {
        seat.hp = player.hp;
        seat.lives.classList.toggle('is-many', view.config.hp > 6);
        seat.lives.replaceChildren(...Array.from({ length: view.config.hp }, (_, i) => svg(i < player.hp ? ICONS.glassFull : ICONS.glassEmpty)));
      }
      const picked = picking !== null && picking.picks.includes(spot.id);
      const targetable = !sending && (picking ? picking.candidates.includes(spot.id) : mine && targets.includes(spot.id));
      seat.kick.hidden = !canKick({ view, seatId: spot.id, mySeat, hostSeat, present });
      renderSeatTools(seat, player, view);
      const cls = seat.el.classList;
      cls.toggle('is-me', spot.id === view.viewer);
      cls.toggle('is-turn', spot.id === turnId);
      // A tool's pick reuses the target red (decision 54); nothing else on the seat turns red.
      cls.toggle('is-target', spot.id === target || picked);
      cls.toggle('is-out', !player.alive);
      cls.toggle('is-absent', !present && player.alive);
      cls.toggle('is-targetable', targetable);
      seat.main.disabled = !targetable;
      seat.main.setAttribute('aria-pressed', String(spot.id === target || picked));
      seat.main.setAttribute('aria-label', TEXT.seatLabel(nameOf(spot.id), tags.join(', '), TEXT.livesLabel(player.hp, view.config.hp)));
      seat.kick.setAttribute('aria-label', TEXT.kickFromMatchFor(nameOf(spot.id)));
      seat.spot = spot;
    }
    for (const [id, seat] of seatEls) {
      if (!placed.some((s) => s.id === id)) {
        seat.el.remove();
        seatEls.delete(id);
      }
    }
    // Turn direction (1 = clockwise on the screen, the engine's seat order).
    arrows.setAttribute('viewBox', `0 0 ${STAGE_WIDTH} ${layout.height}`);
    arrows.setAttribute('aria-label', view.direction === -1 ? TEXT.directionCounter : TEXT.directionClockwise);
    arrows.replaceChildren(...directionArrows(layout.cx, layout.cy, 146, view.direction).flatMap(({ arc, head }) => [
      svg(['path', { d: arc, class: 'arrow-line' }]), svg(['path', { d: head, class: 'arrow-line' }]),
    ]));
  }

  function buildSeat(id) {
    const tag = h('span', { class: 'seat-tag' });
    const name = h('span', { class: 'seat-name' });
    const lives = h('span', { class: 'seat-lives', 'aria-hidden': 'true' });
    // The seat box holds the target button and, for the host, the kick button (never nested).
    const main = h('button', { type: 'button', class: 'seat-main' }, tag, name, lives);
    main.addEventListener('click', () => onSeatTap(id));
    const kick = h('button', { type: 'button', class: 'seat-kick', text: TEXT.kickFromMatch, hidden: true, on: { click: () => askKick(id) } });
    // Hapis: bars in the corner (decision 54). Zincir: one badge per link (decision 58).
    const bars = h('span', { class: 'seat-bars', 'aria-hidden': 'true', hidden: true }, svg(JAIL_BARS));
    const chains = h('div', { class: 'seat-chains', hidden: true });
    const el = h('div', { class: 'seat' }, bars, main, chains, kick);
    return { el, main, kick, tag, name, lives, bars, chains, chainKey: null, hp: null, spot: null };
  }

  // The public tool marks of a seat: jail bars and the chain badges with the other player's name.
  function renderSeatTools(seat, player, view) {
    const active = view.status === 'active' && player.alive;
    seat.bars.hidden = !(active && player.jailed);
    seat.el.classList.toggle('is-jailed', active && player.jailed);
    const partners = active
      ? chainPartners(view.links, player.id).filter((id) => view.players.some((p) => p.id === id && p.alive))
      : [];
    const key = partners.map((id) => `${id}=${nameOf(id)}`).join('|');
    if (key === seat.chainKey) return;
    seat.chainKey = key;
    seat.chains.hidden = partners.length === 0;
    seat.chains.replaceChildren(...partners.map((other) => h('button', {
      type: 'button', class: 'seat-chain', 'aria-label': TEXT.chainWith(nameOf(other)), on: { click: () => flashSeat(other) },
    }, svg(CHAIN), h('span', { class: 'seat-chain-name', text: nameOf(other) }))));
  }

  // A tap on a chain badge lights the other seat for a moment.
  function flashSeat(id) {
    const seat = seatEls.get(id);
    if (!seat) return;
    seat.el.classList.remove('is-flash');
    void seat.el.offsetWidth;
    seat.el.classList.add('is-flash');
    later(() => seat.el.classList.remove('is-flash'), 1300, `flash-${id}`);
  }

  function onSeatTap(id) {
    if (sending || isPressing(press)) return;
    if (picking) {
      picking = { ...picking, picks: pickStep(picking.picks, id, picking) };
      renderAll();
      return;
    }
    if (!myTurn()) return;
    target = tapTarget(target, id, myTargets());
    renderAll();
  }

  function renderStatus(view) {
    statusLine.textContent = statusText(view, nameOf);
    const move = view.status === 'ended' ? { lead: TEXT.matchOver, effect: null, tail: '' } : lastMove(events, nameOf);
    if (move === null) {
      lastLine.replaceChildren();
    } else {
      lastLine.replaceChildren(
        TEXT.lastEventPrefix + move.lead,
        move.effect ? ' ' : '',
        move.effect ? h('span', { class: move.effect === 'live' ? 'effect-live' : 'effect-blank', text: move.effect === 'live' ? TEXT.effectLive : TEXT.effectBlank }) : '',
        move.tail ? ` ${move.tail}` : '');
    }
    const watching = watchStrip(view);
    strip.hidden = watching === null;
    strip.textContent = watching ?? '';
  }

  // --- Ganimet (decision 63) ------------------------------------------------------------------
  // Only this device's own view has loots (view.self.loots), so only the looter draws anything.
  const lootList = () => (applied ? lootCards(applied.view, applied.lootDeadlines, Date.now() + offset) : []);

  function renderLoot() {
    const cards = lootList();
    lootWrap.hidden = cards.length === 0;
    for (const victim of [...lootPicks.keys()]) if (!cards.some((c) => c.victim === victim)) lootPicks.delete(victim);
    for (const [victim, entry] of lootEls) {
      if (!cards.some((c) => c.victim === victim)) {
        entry.el.remove();
        lootEls.delete(victim);
      }
    }
    for (const card of cards) {
      const kept = lootPicks.get(card.victim);
      const index = kept ? keepLootPick(kept.index, card, kept.tool) : null;
      if (index === null) lootPicks.delete(card.victim);
      const over = card.ms === 0;
      const key = JSON.stringify([card.tools, card.empty, index, lootSending, over, nameOf(card.victim)]);
      let entry = lootEls.get(card.victim);
      if (!entry || entry.key !== key) {
        const built = buildLootCard(card, index);
        if (entry) entry.el.replaceWith(built.el);
        else lootWrap.append(built.el);
        entry = { ...built, key, over };
        lootEls.set(card.victim, entry);
      }
    }
    // Keep the engine's order.
    for (const card of cards) lootWrap.append(lootEls.get(card.victim).el);
    updateLootTimers(cards);
  }

  function buildLootCard(card, index) {
    const texts = lootTexts(card, nameOf);
    const ringBar = svg(['circle', { cx: 20, cy: 20, r: 16, fill: 'none', 'stroke-width': 3.5, transform: 'rotate(-90 20 20)', class: 'loot-ring-bar' }]);
    const ringSvg = svg(['svg', { width: 40, height: 40, viewBox: '0 0 40 40', 'aria-hidden': 'true' },
      ['circle', { cx: 20, cy: 20, r: 16, fill: 'none', stroke: '#3A2E24', 'stroke-width': 3.5 }]]);
    ringSvg.append(ringBar);
    const seconds = h('span', { class: 'loot-seconds', role: 'timer' });
    const ring = h('div', { class: 'loot-ring' }, ringSvg, seconds);
    const over = card.ms === 0;
    let body;
    if (card.empty) {
      body = h('div', { class: 'loot-row' },
        h('div', { class: 'loot-empty' },
          h('span', { class: 'loot-empty-title', text: TEXT.lootEmpty }),
          h('span', { class: 'loot-sub', text: TEXT.lootNothing })),
        h('button', { type: 'button', class: 'btn-loot btn-loot-ok', text: texts.button, disabled: lootSending || over, on: { click: () => sendLoot(lootAction(card, null)) } }));
    } else {
      const action = lootAction(card, index);
      body = h('div', { class: 'loot-row' },
        h('div', { class: 'loot-tools' }, ...card.tools.map((item) => h('button', {
          type: 'button',
          class: item.index === index ? 'loot-tool is-picked' : 'loot-tool',
          'aria-label': item.name,
          'aria-pressed': String(item.index === index),
          disabled: lootSending || over,
          on: {
            click: () => {
              const next = lootPick(index, item.index);
              if (next === null) lootPicks.delete(card.victim);
              else lootPicks.set(card.victim, { index: next, tool: item.tool });
              renderLoot();
            },
          },
        }, h('span', { class: 'loot-tool-badge' }, toolIcon(item.tool, 'small')), h('span', { class: 'loot-tool-name', text: item.name })))),
        h('button', { type: 'button', class: 'btn-loot btn-loot-take', text: texts.button, disabled: lootSending || action === null, on: { click: () => sendLoot(lootAction(card, index)) } }));
    }
    const el = h('section', { class: 'loot-card', 'aria-label': TEXT.lootLabel },
      h('div', { class: 'loot-head' },
        h('div', { class: 'loot-head-text' },
          h('span', { class: 'loot-title', text: texts.title }),
          h('span', { class: 'loot-sub', text: texts.sub })),
        ring),
      body);
    return { el, ringBar, ring, seconds };
  }

  // The countdowns (every tick): the ring and the seconds, turquoise, never red (decision 54).
  const LOOT_RING = 2 * Math.PI * 16;
  function updateLootTimers(cards = lootList()) {
    let redraw = false;
    for (const card of cards) {
      const entry = lootEls.get(card.victim);
      if (!entry) continue;
      entry.ring.hidden = card.seconds === null;
      if (card.seconds !== null) {
        entry.seconds.textContent = String(card.seconds);
        entry.seconds.setAttribute('aria-label', TEXT.secondsLeft(card.seconds));
        entry.ringBar.setAttribute('stroke-dasharray', `${(card.fraction * LOOT_RING).toFixed(1)} ${LOOT_RING.toFixed(1)}`);
      }
      // The time is up: the buttons go off (the expiry from runMatchClock then closes the card).
      if ((card.ms === 0) !== entry.over) redraw = true;
    }
    if (redraw) renderLoot();
  }

  // The choice leaves this device only inside the lootChoice action (sent as my own seat).
  async function sendLoot(action) {
    if (!action || lootSending) return;
    lootSending = true;
    renderLoot();
    try {
      const result = await api.submitAction({ uid, code, action });
      if (!destroyed && !result.ok) showError(lootErrorText(result.error));
      if (!destroyed && result.ok) lootPicks.delete(action.victim);
    } catch (error) {
      report(error);
    } finally {
      lootSending = false;
      if (!destroyed) renderLoot();
    }
  }

  // --- Fidye (decision 64) ---------------------------------------------------------------------
  // From my own view only: my standing offer (view.self.ransomOffer) and the offers made to me.
  function renderRansom() {
    const view = applied?.view;
    const row = view ? ransomRow(view) : null;
    ransomBar.hidden = row === null;
    if (row === null) {
      ransomSheet.close();
    } else {
      ransomText.textContent = row.pending ? pendingText(row.pending, nameOf) : TEXT.ransomHint;
      ransomOpen.textContent = row.pending ? TEXT.ransomChange : TEXT.ransomButton;
      ransomOpen.hidden = !row.canOffer;
      ransomOpen.disabled = ransomSending;
      ransomBack.hidden = !row.pending;
      ransomBack.disabled = ransomSending;
      if (ransomSheet.isOpen()) renderRansomSheet();
    }
    const cards = view ? incomingCards(view) : [];
    const key = JSON.stringify([cards, ransomSending, cards.map((c) => nameOf(c.from))]);
    if (key === ransomKey) return;
    ransomKey = key;
    ransomWrap.hidden = cards.length === 0;
    ransomWrap.replaceChildren(...cards.map((card) => h('section', { class: 'loot-card ransom-card', 'aria-label': TEXT.ransomButton },
      h('div', { class: 'loot-head' },
        h('div', { class: 'loot-head-text' },
          h('span', { class: 'loot-title', text: TEXT.ransomIncomingTitle(nameOf(card.from)) }),
          h('span', { class: 'loot-sub', text: TEXT.ransomIncomingSub }))),
      h('div', { class: 'loot-row' },
        h('div', { class: 'loot-tools' },
          h('span', { class: 'loot-tool ransom-tool' },
            h('span', { class: 'loot-tool-badge' }, toolIcon(card.tool, 'small')),
            h('span', { class: 'loot-tool-name', text: card.name }))),
        h('div', { class: 'ransom-actions' },
          h('button', { type: 'button', class: 'btn-loot btn-loot-ok', text: TEXT.ransomReject, disabled: ransomSending, on: { click: () => sendRansom(rejectAction(card)) } }),
          // Always enabled: whether the offer is still funded is the offerer's secret.
          h('button', { type: 'button', class: 'btn-loot btn-loot-take', text: TEXT.ransomAccept, disabled: ransomSending, on: { click: () => sendRansom(acceptAction(card)) } }))))));
  }

  // My hand (decision 54): small badges on every turn, turn tools faded on others' turns, and on
  // my turn "bu sıra N/M". A tap opens the tool's card (no long press).
  function renderHand(view) {
    const state = handState(view);
    hand.hidden = state === null;
    if (state === null) return;
    handTitle.textContent = state.title;
    handUsed.textContent = state.used ?? '';
    const key = JSON.stringify(state.tools);
    if (key === handKey) return;
    handKey = key;
    handList.replaceChildren(...state.tools.map((item) => h('button', {
      type: 'button',
      class: item.faded ? 'hand-tool is-faded' : 'hand-tool',
      'aria-label': item.name,
      'aria-haspopup': 'dialog',
      on: { click: () => openCard(item.tool) },
    }, toolIcon(item.tool, 'small'), h('span', { class: 'hand-name', text: item.name }))));
  }

  // My effects strip (decision 54): icons only; a tap expands one item with its text, a tap
  // anywhere else closes it. Built from my own view and private events only.
  function renderEffects(view) {
    const items = effectsStrip(view, events);
    if (!items.some((item) => item.key === expanded)) expanded = null;
    const key = JSON.stringify([items, expanded]);
    if (key === effectsKey) return;
    effectsKey = key;
    effects.hidden = items.length === 0;
    effects.replaceChildren(...items.map((item) => {
      const open = item.key === expanded;
      const { name, text, strong, after } = item.text;
      const icon = toolIcon(item.tool, 'small');
      if (item.faded) icon.classList.add('is-faded');
      return h('button', {
        type: 'button',
        class: open ? 'effect is-open' : 'effect',
        'aria-expanded': String(open),
        'aria-label': open ? `${name}${text}${strong}${after}` : name,
        on: {
          click: (event) => {
            event.stopPropagation();
            expanded = open ? null : item.key;
            renderEffects(applied.view);
          },
        },
      }, icon, open ? h('span', { class: 'effect-text' },
        h('strong', { text: name }), text, strong ? h('strong', { text: strong }) : null, after) : null);
    }));
  }

  const closeEffects = (event) => {
    if (expanded === null || effects.contains(event.target) || !applied) return;
    expanded = null;
    renderEffects(applied.view);
  };
  document.addEventListener('click', closeEffects);

  // The pick bar (a tool's target, then the short confirmation) and the Çal bar, in place of the
  // fire button.
  function renderStep() {
    const steal = applied ? stealPick(applied.view) : null;
    if (steal) {
      stepBar.hidden = false;
      stepTitle.textContent = toolName('steal');
      stepSub.textContent = nameOf(steal.victim);
      stepCancel.hidden = true;
      stepGo.textContent = sending ? TEXT.toolSending : TEXT.stealPending;
      stepGo.disabled = sending;
      return;
    }
    if (!picking) {
      stepBar.hidden = true;
      return;
    }
    const bar = pickBar({ tool: picking.tool, picks: picking.picks, need: picking.need, nameOf, mySeat });
    stepBar.hidden = false;
    stepTitle.textContent = bar.title;
    stepSub.textContent = bar.sub;
    stepCancel.hidden = picking.kind === 'handSwap'; // El Değiştir is already spent
    stepCancel.disabled = sending;
    stepGo.textContent = sending ? TEXT.toolSending : TEXT.use;
    stepGo.disabled = sending || !bar.ready;
  }

  function renderFire() {
    const show = myTurn() && !picking;
    fireWrap.hidden = !show;
    if (!show) return;
    const pressing = isPressing(press);
    fireButton.disabled = !canFire() && !pressing;
    fireButton.classList.toggle('is-ready', target !== null);
    fireButton.classList.toggle('is-pressing', pressing);
    fireMain.textContent = target === null ? TEXT.chooseTarget : TEXT.fire;
    if (sending) fireSub.textContent = TEXT.firing;
    else if (pressing) fireSub.textContent = TEXT.slideToCancel;
    else if (target === null) fireSub.textContent = TEXT.chooseTargetHint;
    else fireSub.textContent = target === mySeat ? TEXT.targetSelf : TEXT.targetIs(nameOf(target));
  }

  function updateClock() {
    if (destroyed || !applied) return;
    const ms = clockMs();
    ring.hidden = ms === null;
    if (ms !== null) {
      const total = applied.view.config.shotTimeSeconds * 1000;
      const seconds = secondsShown(ms);
      ringText.textContent = String(seconds);
      ring.setAttribute('aria-label', TEXT.secondsLeft(seconds));
      ringBar.setAttribute('stroke-dasharray', `${((ms / total) * RING).toFixed(1)} ${RING.toFixed(1)}`);
      ring.classList.toggle('is-mine', applied.view.clock.playerId === mySeat);
    }
    updateLootTimers();
    // In the open Tablo, on my turn: the red "Sıra sende" bar with the seconds.
    tablo.setTurnBar(myTurn() && ms !== null ? secondsShown(ms) : null);
    const urgent = myTurn() && ms !== null && ms <= URGENT_MS && ms > 0;
    fireButton.classList.toggle('is-urgent', urgent);
    // Time ran out during a press: cancel it; the clock sends the timeout (engine rule).
    if (ms === 0 && isPressing(press)) dispatch({ type: 'expire' });
    if (ms === 0 && myTurn() && !fireButton.disabled && !isPressing(press)) renderFire();
  }

  // --- Revolver --------------------------------------------------------------------------------
  function pointRevolver(seatId) {
    const seat = seatId ? seatEls.get(seatId) : null;
    if (!seat?.spot || !applied) return;
    const width = stage.clientWidth || STAGE_WIDTH;
    const layout = seatLayout(applied.view.players.length);
    const point = { x: (seat.spot.x / STAGE_WIDTH) * width, y: seat.spot.y };
    const next = nearestAngle(angle, aimAngle({ x: width / 2, y: layout.cy }, point));
    const moved = !Number.isFinite(angle) || Math.abs(next - angle) > 1;
    angle = next;
    // Always the same function list, so the turn (and the mirror flip) interpolates smoothly.
    revolverWrap.style.transform = `rotate(${next.toFixed(1)}deg) scaleY(${pointsLeft(next) ? -1 : 1})`;
    revolverWrap.setAttribute('aria-label', TEXT.revolverAt(nameOf(seatId)));
    return moved;
  }

  async function aimAt(seatId) {
    const moved = pointRevolver(seatId);
    if (moved) await wait(reducedMotion() ? SHOT_TIMING.reducedAim : SHOT_TIMING.aim);
  }

  async function shotAnimation(shot) {
    const reduced = reducedMotion();
    const live = shot.effect === 'live';
    revolverWrap.classList.remove('is-live', 'is-blank', 'is-cocking', 'is-cocked');
    void revolverWrap.offsetWidth; // restart the keyframes
    revolverWrap.classList.add(live ? 'is-live' : 'is-blank');
    const total = live ? (reduced ? SHOT_TIMING.reducedLive : SHOT_TIMING.live) : (reduced ? SHOT_TIMING.reducedBlank : SHOT_TIMING.blank);
    if (live) {
      later(() => {
        for (const hit of shot.hits ?? []) {
          const seat = seatEls.get(hit.player);
          if (hit.result === 'damage' && seat) {
            seat.el.classList.add('is-hit');
            later(() => seat.el.classList.remove('is-hit'), 700);
          }
        }
      }, reduced ? 0 : 440);
    }
    await wait(total);
    revolverWrap.classList.remove('is-live', 'is-blank');
    await wait(SHOT_TIMING.hold);
  }

  // --- Reload announcement -----------------------------------------------------------------------
  function showReload({ live, blank, text }) {
    reloadLive.textContent = live;
    reloadBlank.textContent = blank;
    reloadSr.textContent = `${TEXT.reloadLabel}: ${text}`;
    reloadBanner.hidden = false;
    reloadBanner.classList.remove('is-showing');
    void reloadBanner.offsetWidth;
    reloadBanner.classList.add('is-showing');
    later(() => {
      reloadBanner.hidden = true;
      reloadBanner.classList.remove('is-showing');
    }, RELOAD_SHOW_MS, 'reload');
  }

  // --- The fire button's press ---------------------------------------------------------------------
  function dispatch(event) {
    const result = pressStep(press, event);
    press = result.state;
    const effect = result.effect;
    if (!isPressing(press) && holdTimer !== null) {
      clearTimeout(holdTimer);
      timers.delete(holdTimer);
      holdTimer = null;
    }
    if (effect === 'cock') {
      revolverWrap.classList.add('is-cocking');
      later(() => {
        if (press.phase === PRESS.COCKED) revolverWrap.classList.add('is-cocked');
      }, reducedMotion() ? 0 : 600, 'cocked');
    } else if (effect === 'cancel') {
      revolverWrap.classList.remove('is-cocking', 'is-cocked');
    } else if (effect && effect.fire) {
      // A long press keeps the hammer drawn back until the shot animation lets it fall.
      revolverWrap.classList.remove('is-cocked');
      fire();
    }
    if (applied) renderFire();
  }

  function isInside(event) {
    const box = fireButton.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  function startPress() {
    dispatch({ type: 'down', at: performance.now(), enabled: canFire() });
    if (isPressing(press)) holdTimer = later(() => {
      holdTimer = null;
      dispatch({ type: 'hold', at: performance.now() });
    }, LONG_PRESS_MS);
  }

  fireButton.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      fireButton.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable (e.g. synthetic events): the move / up checks still work.
    }
    startPress();
  });
  fireButton.addEventListener('pointermove', (event) => {
    if (isPressing(press) && !isInside(event)) dispatch({ type: 'leave' });
  });
  fireButton.addEventListener('pointerup', (event) => dispatch({ type: 'up', at: performance.now(), inside: isInside(event) }));
  fireButton.addEventListener('pointercancel', () => dispatch({ type: 'expire' }));
  fireButton.addEventListener('lostpointercapture', () => {
    if (isPressing(press)) dispatch({ type: 'expire' });
  });
  fireButton.addEventListener('contextmenu', (event) => event.preventDefault());
  // Keyboard: Enter / Space press and release like a finger inside the button.
  fireButton.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) startPress();
  });
  fireButton.addEventListener('keyup', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    dispatch({ type: 'up', at: performance.now(), inside: true });
  });
  fireButton.addEventListener('blur', () => dispatch({ type: 'expire' }));
  // Clicks are handled by the press events above.
  fireButton.addEventListener('click', (event) => event.preventDefault());

  // --- Sending the shot -------------------------------------------------------------------------
  // ONE chooseTarget aims and fires in the same write: the confirmation step is off by default in
  // the engine (decision 55), so the target is never stored before the shot.
  async function fire() {
    if (!canFire()) return;
    const aimed = target;
    sending = true;
    renderAll();
    try {
      const result = await api.submitAction({ uid, code, action: { type: 'chooseTarget', target: aimed } });
      if (!destroyed && !result.ok) showError(TEXT.shotRefused);
    } catch (error) {
      report(error);
    } finally {
      sending = false;
      if (!destroyed) {
        if (!revolverWrap.classList.contains('is-live') && !revolverWrap.classList.contains('is-blank')) {
          revolverWrap.classList.remove('is-cocking');
        }
        renderAll();
      }
    }
  }

  // --- End screen ------------------------------------------------------------------------------
  function showEnd() {
    if (destroyed || !applied) return;
    showingEnd = true;
    tableView.hidden = true;
    endView.hidden = false;
    renderEnd();
    window.scrollTo(0, 0);
  }

  function renderEnd() {
    if (!applied || !showingEnd) return;
    const { view } = applied;
    endTopLeft.textContent = TEXT.endTop(code, MODE_LABELS[mode] ?? '', applied.n);
    const head = endHeadline(view, nameOf, outs);
    endTitle.textContent = head.title;
    endLine.textContent = head.line;
    endSub.textContent = head.sub;
    endSub.hidden = !head.sub;
    const rows = endRanking(summary(), { mySeat, nameOf, session, events });
    endList.replaceChildren(...rows.map((row) => h('li', { class: row.me ? 'end-row is-me' : 'end-row' },
      h('span', { class: 'end-place', text: `${row.place}.` }),
      h('span', { class: 'end-who' },
        h('span', { class: 'end-name-line' },
          h('span', { class: 'end-name', text: row.name }),
          row.me ? h('span', { class: 'end-me', text: TEXT.me }) : null),
        h('span', { class: 'end-status', text: row.status })),
      h('span', { class: 'end-points' },
        h('span', { class: row.points > 0 ? 'end-gain is-plus' : 'end-gain', text: formatSigned(row.points) }),
        row.total ? h('span', { class: 'end-total', text: row.total }) : null))));
    // "Salona dön" once the result is stored (the room is back in the lobby).
    backButton.disabled = !inLobby;
    backNote.textContent = inLobby ? '' : TEXT.resultsSaving;
  }

  // --- Public ----------------------------------------------------------------------------------
  return {
    el,
    /**
     * The waiting room's live snapshot: { names, presence, hostSeat, session, status }.
     * status "lobby" means the result is stored and "Salona dön" can be used.
     */
    setRoom(room) {
      names = room.names ?? {};
      presence = room.presence ?? {};
      hostSeat = room.hostSeat ?? null;
      session = room.session ?? null;
      inLobby = room.status === 'lobby';
      tablo.update(session ?? { matches: 0, rows: [] }, names);
      if (!running) renderAll();
      if (showingEnd) renderEnd();
    },
    /** True once the match is over (the end screen is shown or about to be). */
    isEnded: () => endedAt !== null,
    destroy() {
      if (destroyed) return;
      dispatch({ type: 'expire' });
      destroyed = true;
      tablo.destroy();
      kickSheet.destroy();
      card.destroy();
      stealSheet.destroy();
      ransomSheet.destroy();
      document.removeEventListener('click', closeEffects);
      clearInterval(tick);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const stop of stops.splice(0)) {
        try {
          const result = stop();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch {
          // Already stopped.
        }
      }
    },
  };
}

// The table's static drawing (approved mock): dashed ring, eight-pointed star, the revolver's base.
const DECOR = ['svg', { class: 'table-decor', width: 248, height: 248, viewBox: '0 0 248 248', 'aria-hidden': 'true' },
  ['circle', { cx: 124, cy: 124, r: 104, fill: 'none', stroke: '#EFE6D6', 'stroke-opacity': 0.12, 'stroke-width': 1, 'stroke-dasharray': '3 5' }],
  ['rect', { x: 64, y: 64, width: 120, height: 120, fill: 'none', stroke: '#3FB5AC', 'stroke-opacity': 0.35, 'stroke-width': 1.5 }],
  ['rect', { x: 64, y: 64, width: 120, height: 120, fill: 'none', stroke: '#3FB5AC', 'stroke-opacity': 0.35, 'stroke-width': 1.5, transform: 'rotate(45 124 124)' }],
  ['circle', { cx: 124, cy: 124, r: 46, fill: '#1E1814', stroke: '#3FB5AC', 'stroke-opacity': 0.5, 'stroke-width': 1 }]];

// Hapis on a seat: bars in the corner (approved mock 3 of conversation 13).
const JAIL_BARS = ['svg', { width: 22, height: 22, viewBox: '0 0 22 22', 'aria-hidden': 'true' },
  ['rect', { x: 2, y: 2, width: 18, height: 18, rx: 3, fill: 'none', stroke: '#EFE6D6', 'stroke-opacity': 0.8, 'stroke-width': 1.5 }],
  ['path', { d: 'M7 2 V20 M11 2 V20 M15 2 V20', stroke: '#EFE6D6', 'stroke-opacity': 0.8, 'stroke-width': 1.5 }]];

// The chain badge's two links (approved mock 3 of conversation 13, decision 58).
const CHAIN = ['svg', { width: 14, height: 12, viewBox: '0 0 14 12', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 1.5, 'aria-hidden': 'true' },
  ['rect', { x: 0.8, y: 3, width: 7, height: 6, rx: 3 }],
  ['rect', { x: 6.2, y: 3, width: 7, height: 6, rx: 3 }]];

const GEAR = ['svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
  ['circle', { cx: 12, cy: 12, r: 3.2 }],
  ['path', { d: 'M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7.1 7.1 M16.9 16.9 L18.7 18.7 M5.3 18.7 L7.1 16.9 M16.9 7.1 L18.7 5.3' }],
  ['circle', { cx: 12, cy: 12, r: 7 }]];
