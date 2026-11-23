// Pure helpers for using tools (malzemeler) on the match table (task 4.3a; decisions 49, 54, 58):
// the hand, the tool card's button, picking a tool's target(s) on the table, the Çal choice, the
// effects strip (my shields and the secret results of my detection tools) and the chain badges.
// No DOM, no database.
//
// Security: everything here reads only what watchMatch gives this device: its own view
// (view.self is mine only), the events it received (public ones plus my own private ones) and
// its own legal actions. Nothing secret is ever written anywhere; a tool's target leaves this
// device only inside the tool action itself, like the shot.

import { TOOL_INFO } from '../engine/index.js';
import { TEXT } from './messages.js';
import { isTool, toolName } from './tools.js';

const isAnytime = (tool) => TOOL_INFO[tool]?.timing === 'anytime';

/** True when the view is a living player's in a running match (only they hold a hand). */
export function holdsHand(view) {
  return Boolean(view && view.status === 'active' && view.role === 'alive' && view.self);
}

/** It is my own turn (the engine's turn player is me), whatever the phase. */
export function isMyTurn(view) {
  return holdsHand(view) && view.turn.playerId === view.viewer;
}

// --- Hand ----------------------------------------------------------------------------------------

/**
 * The hand as drawn (decision 54): every copy of every tool, in hand order, with the turn tools
 * faded on other players' turns; the title "Elin · N malzeme" and, on my own turn, the engine's
 * counter of this turn against the match setting: "bu sıra 2/3". Null when I hold no hand.
 * @returns {{ title: string, used: string | null, tools: Array<{ tool: string, index: number,
 *   name: string, anytime: boolean, faded: boolean }> } | null}
 */
export function handState(view) {
  if (!holdsHand(view)) return null;
  const hand = Array.isArray(view.self.hand) ? view.self.hand.filter(isTool) : [];
  const mine = isMyTurn(view);
  const used = mine && Number.isInteger(view.self.toolsUsedThisTurn)
    ? TEXT.usedThisTurn(view.self.toolsUsedThisTurn, view.config.toolsPerTurn)
    : null;
  return {
    title: hand.length > 0 ? TEXT.handTitle(hand.length) : TEXT.handEmpty,
    used,
    tools: hand.map((tool, index) => ({
      tool,
      index,
      name: toolName(tool),
      anytime: isAnytime(tool),
      faded: !mine && !isAnytime(tool),
    })),
  };
}

// --- Tool card -----------------------------------------------------------------------------------

/** The legal useTool actions of one tool (the engine's listLegalActions for my seat). */
export function toolActions(legalActions, tool) {
  if (!Array.isArray(legalActions)) return [];
  return legalActions.filter((a) => a?.type === 'useTool' && a.tool === tool);
}

/**
 * The tool card's button (decision 54): "Kullan" when the engine accepts the tool now, otherwise
 * a disabled button whose label says why: "Sıranı bekle" (a turn tool on someone else's turn),
 * "Bu sıranın sınırı doldu" (the per-turn limit), and the other engine refusals. Çal with nothing
 * left to give after it warns first (the tool is spent on the look).
 * @returns {{ enabled: boolean, label: string, used: string | null, warning: string | null }}
 */
export function cardButton({ view, legalActions, tool }) {
  const used = isMyTurn(view) && Number.isInteger(view.self.toolsUsedThisTurn)
    ? TEXT.usedThisTurnLong(view.self.toolsUsedThisTurn, view.config.toolsPerTurn)
    : null;
  const off = (label) => ({ enabled: false, label, used, warning: null });
  if (!holdsHand(view) || !isTool(tool) || !view.self.hand.includes(tool)) return off(TEXT.toolUnavailable);
  if (toolActions(legalActions, tool).length > 0) {
    // Çal is spent on the look: with no other tool in the hand there is nothing to give back.
    const nothingToGive = tool === 'steal' && view.self.hand.length <= 1;
    return {
      enabled: true,
      label: nothingToGive ? TEXT.useAnyway : TEXT.use,
      used,
      warning: nothingToGive ? TEXT.stealNothingToGive : null,
    };
  }
  const mine = isMyTurn(view);
  if (!isAnytime(tool) && !mine) return off(TEXT.waitYourTurn);
  if (mine && view.self.toolsUsedThisTurn >= view.config.toolsPerTurn) return off(TEXT.turnLimitReached);
  if (tool === 'heal' && view.players.find((p) => p.id === view.viewer)?.hp >= view.config.hp) return off(TEXT.hpFull);
  if (tool === 'double' && view.doublePending) return off(TEXT.doubleAlready);
  if (mine && view.phase.type !== 'turn') return off(TEXT.finishPending);
  return off(TEXT.toolUnavailable);
}

// --- Targets ---------------------------------------------------------------------------------------

/**
 * What a tool needs before it is sent: nothing (most tools; El Değiştir picks its player AFTER
 * it is used, see handSwapPick), one player (Hapis, Çal: never me) or two different players
 * (Zincir: I may link myself). Candidates come from the legal actions.
 * @returns {{ need: 0 | 1 | 2, candidates: string[] }}
 */
export function toolTargets(legalActions, tool) {
  const actions = toolActions(legalActions, tool);
  const candidates = [];
  const add = (id) => {
    if (typeof id === 'string' && !candidates.includes(id)) candidates.push(id);
  };
  if (tool === 'link') {
    for (const a of actions) if (Array.isArray(a.targets)) a.targets.forEach(add);
    return { need: 2, candidates };
  }
  if (tool === 'jail' || tool === 'steal') {
    for (const a of actions) add(a.target);
    return { need: 1, candidates };
  }
  return { need: 0, candidates };
}

/**
 * The picks after a tap on a seat: a picked seat is unpicked; a new candidate is added while
 * picks are missing, otherwise it replaces the last pick. Anything else changes nothing.
 * @param {string[]} picks
 * @param {string} tapped
 * @param {{ need: number, candidates: string[] }} spec
 */
export function pickStep(picks, tapped, { need, candidates }) {
  if (!candidates.includes(tapped)) return picks;
  if (picks.includes(tapped)) return picks.filter((id) => id !== tapped);
  if (picks.length < need) return [...picks, tapped];
  return [...picks.slice(0, need - 1), tapped];
}

/** The picks still valid after an update (candidates may have changed). */
export function keepPicks(picks, candidates) {
  return picks.filter((id) => candidates.includes(id));
}

/** The action to send for a tool and its picks, or null while picks are missing. */
export function toolAction(tool, picks = []) {
  if (!isTool(tool)) return null;
  if (tool === 'link') return picks.length === 2 && picks[0] !== picks[1] ? { type: 'useTool', tool, targets: [picks[0], picks[1]] } : null;
  if (tool === 'jail' || tool === 'steal') return picks.length === 1 ? { type: 'useTool', tool, target: picks[0] } : null;
  return { type: 'useTool', tool };
}

/**
 * The pick bar shown instead of the fire button while picking (the short confirmation):
 * "Hapis · bir oyuncu seç" -> "Hapis · Kerem"; Zincir "Zincir · Zeynep ve Yusuf".
 */
export function pickBar({ tool, picks, need, nameOf, mySeat }) {
  const who = (id) => (id === mySeat ? TEXT.yourself : nameOf(id));
  let sub;
  if (picks.length >= need) sub = picks.map(who).join(TEXT.and);
  else if (need === 2) sub = picks.length === 0 ? TEXT.pickTwo : TEXT.pickSecond(who(picks[0]));
  else sub = tool === 'handSwap' ? TEXT.pickSwap : TEXT.pickOne;
  return { title: toolName(tool), sub, ready: picks.length >= need };
}

/**
 * El Değiştir after it was used (phase handSwap, mine only): the players I may swap with and
 * their tool COUNTS (view.self.pending.counts, never the tools), or null.
 * @returns {{ candidates: string[], counts: Record<string, number> } | null}
 */
export function handSwapPick(view, legalActions) {
  if (!isMyTurn(view) || view.self.pending?.type !== 'handSwap') return null;
  const candidates = [];
  for (const a of legalActions ?? []) {
    if (a?.type === 'handSwapTarget' && typeof a.target === 'string' && !candidates.includes(a.target)) candidates.push(a.target);
  }
  const counts = {};
  const source = view.self.pending.counts ?? {};
  for (const id of candidates) if (Number.isInteger(source[id])) counts[id] = source[id];
  return { candidates, counts };
}

// --- Çal ---------------------------------------------------------------------------------------

/**
 * Çal after the look (phase steal, mine only): the victim's tools from MY view
 * (view.self.pending.tools) and my own hand to give from, or null.
 */
export function stealPick(view) {
  if (!isMyTurn(view) || view.self.pending?.type !== 'steal') return null;
  return {
    victim: view.self.pending.victim,
    tools: (view.self.pending.tools ?? []).filter(isTool),
    mine: view.self.hand.filter(isTool),
  };
}

/**
 * The stealChoice to send: an exchange needs both a tool to take and one to give, else nothing
 * is taken (both null).
 */
export function stealAction({ take = null, give = null, pick }) {
  if (pick && take !== null && give !== null && pick.tools.includes(take) && pick.mine.includes(give)) {
    return { type: 'stealChoice', take, give };
  }
  return { type: 'stealChoice', take: null, give: null };
}

// --- Effects strip -------------------------------------------------------------------------------

// Events after which the result of a detection tool no longer describes the current Mermi: it
// was fired (shot), the roulette was refilled, the turn changed, or the remaining Mermi were
// moved (Karıştır, public). My own Kaydır and Hokkabaz are handled where they are read.
const CLEARS_RESULTS = ['shot', 'reloaded', 'turnStarted', 'matchEnded'];

/**
 * The secret results of my own detection tools that still describe a Mermi in play, from the
 * events this device received (oldest first). Only my private receipts (toolUsed with `by` me
 * and `to` me) are read; nothing is computed about the roulette here: a result is dropped at the
 * first event after which the engine itself moved on (CLEARS_RESULTS, a public Karıştır, my own
 * Kaydır or Hokkabaz). Kaydır's own result (the Mermi I skipped) stays until the next of these.
 * @returns {Array<{ tool: string, chamber?: string, result?: string, live?: number,
 *   examined?: number, flipped?: boolean }>}
 */
export function detectionResults(events, viewerId) {
  let results = [];
  if (!viewerId) return results;
  for (const e of events ?? []) {
    if (!e || typeof e !== 'object') continue;
    if (CLEARS_RESULTS.includes(e.type)) {
      results = [];
      continue;
    }
    if (e.type === 'toolUsed' && e.visibility === 'public' && e.tool === 'shuffle') {
      results = [];
      continue;
    }
    const mine = e.visibility === 'private' && Array.isArray(e.to) && e.to.includes(viewerId) && e.by === viewerId;
    if (!mine || (e.type !== 'toolUsed' && e.type !== 'toolResult')) continue;
    switch (e.tool) {
      case 'detector':
        results = results.filter((r) => r.tool !== 'detector').concat({ tool: 'detector', chamber: e.chamber });
        break;
      case 'probe':
        results = results.filter((r) => r.tool !== 'probe').concat({ tool: 'probe', result: e.result });
        break;
      case 'counter':
        results = results.filter((r) => r.tool !== 'counter').concat({ tool: 'counter', live: e.live, examined: e.examined });
        break;
      case 'skip':
        // The current Mermi is gone: every earlier result described it (or the order after it).
        results = [{ tool: 'skip', chamber: e.chamber }];
        break;
      case 'swap':
        results = [];
        break;
      case 'flip':
        results = results.filter((r) => r.tool !== 'flip').concat({ tool: 'flip', flipped: e.flipped === true });
        break;
      default:
        break;
    }
  }
  return results;
}

const effectWord = (chamber) => (chamber === 'live' ? TEXT.live : TEXT.blank);

/** The text of one strip item, expanded: { name, text, strong, after }. */
export function resultText(item) {
  const name = toolName(item.tool);
  switch (item.tool) {
    case 'detector':
      return { name, text: TEXT.detectorResult, strong: effectWord(item.chamber), after: '' };
    case 'skip':
      return { name, text: TEXT.skipResult, strong: effectWord(item.chamber), after: '' };
    case 'probe':
      if (item.result === 'noNext') return { name, text: TEXT.probeLast, strong: '', after: '' };
      return { name, text: TEXT.probeResult, strong: item.result === 'same' ? TEXT.same : TEXT.different, after: '' };
    case 'counter':
      return { name, text: TEXT.counterResult(item.examined), strong: TEXT.liveCount(item.live), after: '' };
    case 'flip':
      return { name, text: TEXT.flipResult, strong: item.flipped ? TEXT.flipped : TEXT.notFlipped, after: '' };
    case 'shotShield':
    case 'toolShield':
      return { name, text: ' · ', strong: '', after: item.active ? TEXT.shieldActive(item.count) : TEXT.shieldWaiting(item.count) };
    default:
      return { name, text: '', strong: '', after: '' };
  }
}

/**
 * The effects strip under the status line (decision 54): my own effects only, as small icons.
 * First my shields (one icon per kind, faded until one of them is active), then the results of
 * my detection tools while their Mermi is in play. Empty when I hold no hand.
 * @returns {Array<{ key: string, tool: string, faded: boolean, text: object }>}
 */
export function effectsStrip(view, events) {
  if (!holdsHand(view)) return [];
  const items = [];
  for (const [kind, tool] of [['shot', 'shotShield'], ['tool', 'toolShield']]) {
    const list = Array.isArray(view.self.shields?.[kind]) ? view.self.shields[kind] : [];
    if (list.length === 0) continue;
    const active = list.some((s) => s?.active === true);
    const item = { tool, active, count: list.length };
    items.push({ key: tool, tool, faded: !active, text: resultText(item) });
  }
  for (const result of detectionResults(events, view.viewer)) {
    items.push({ key: result.tool, tool: result.tool, faded: false, text: resultText(result) });
  }
  return items;
}

// --- Chains, jail, Çift Ateş ---------------------------------------------------------------------

/**
 * The chain badges of a seat (decision 58): the other end of every link it is part of (public:
 * view.links), each once. No line is drawn between linked seats.
 */
export function chainPartners(links, seatId) {
  const out = [];
  for (const link of Array.isArray(links) ? links : []) {
    if (!Array.isArray(link) || link.length !== 2) continue;
    const other = link[0] === seatId ? link[1] : link[1] === seatId ? link[0] : null;
    if (other !== null && other !== seatId && !out.includes(other)) out.push(other);
  }
  return out;
}

/** The seat's status words from tools (public): "hapiste", "zincirli". */
export function toolTagsOf(player, links) {
  const tags = [];
  if (!player?.alive) return tags;
  if (player.jailed) tags.push(TEXT.tagJailed);
  if (chainPartners(links, player.id).length > 0) tags.push(TEXT.tagChained);
  return tags;
}

/** "×2" on the revolver while the next shot is doubled (public view.doublePending). */
export const doubleMark = (view) => (view?.status === 'active' && view.doublePending === true ? TEXT.doubleMark : null);

// --- Refusals -------------------------------------------------------------------------------------

/** A short Turkish line for an engine refusal of a tool action. */
export function toolErrorText(error) {
  switch (error?.code) {
    case 'TOOL_LIMIT_REACHED':
      return TEXT.turnLimitReached;
    case 'NOT_YOUR_TURN':
      return TEXT.waitYourTurn;
    case 'HP_FULL':
      return TEXT.hpFull;
    case 'DOUBLE_ALREADY_ACTIVE':
      return TEXT.doubleAlready;
    case 'WRONG_PHASE':
      return TEXT.finishPending;
    default:
      return TEXT.toolRefused;
  }
}
