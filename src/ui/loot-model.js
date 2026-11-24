// Pure helpers of the "Ganimet" card (task 4.3b, decision 63; approved mocks 1 and 2 of
// conversation 13). No DOM, no database.
//
// Loot is a private standing offer of the looter: it never stops the game and nobody else learns
// anything about it. Everything here reads only this device's own view (view.self.loots, which
// only the looter's view has) and the deadlines watchMatch computed for it (lootDeadlines). The
// choice leaves the device only inside the lootChoice action.

import { LOOT_SECONDS } from '../engine/index.js';
import { t } from './i18n/i18n.js';
import { isTool, toolName } from './tools.js';

/**
 * The cards to draw: one per open loot of mine (a shot that kills two players gives two), in the
 * order the engine opened them. Empty for everybody but the looter.
 * @param {object} view my view (watchMatch)
 * @param {Record<string, number>} lootDeadlines victim -> server time the loot expires
 * @param {number} serverNow
 * @returns {Array<{ victim: string, tools: Array<{ tool: string, index: number, name: string }>,
 *   empty: boolean, deadline: number | null, ms: number | null, seconds: number | null,
 *   fraction: number }>}
 */
export function lootCards(view, lootDeadlines, serverNow) {
  if (!view || view.status !== 'active' || view.role !== 'alive' || !Array.isArray(view.self?.loots)) return [];
  return view.self.loots.map((loot) => {
    const tools = (Array.isArray(loot.tools) ? loot.tools : []).filter(isTool).map((tool, index) => ({ tool, index, name: toolName(tool) }));
    const deadline = typeof lootDeadlines?.[loot.victim] === 'number' ? lootDeadlines[loot.victim] : null;
    const ms = deadline === null ? null : Math.max(0, Math.min(LOOT_SECONDS * 1000, deadline - serverNow));
    return {
      victim: loot.victim,
      tools,
      empty: tools.length === 0,
      deadline,
      ms,
      seconds: ms === null ? null : Math.ceil(ms / 1000),
      fraction: ms === null ? 1 : ms / (LOOT_SECONDS * 1000),
    };
  });
}

/** The selection after a tap on a tool of a card: a second tap on the same tool clears it. */
export function lootPick(current, index) {
  return current === index ? null : index;
}

/** The selection kept after an update: dropped when that tool is no longer at that place. */
export function keepLootPick(index, card, previousTool) {
  if (index === null || !card) return null;
  return card.tools[index]?.tool === previousTool ? index : null;
}

/**
 * The lootChoice to send for a card: "Al" takes the selected tool; "Tamam" on an empty hand
 * takes nothing. Null while "Al" has nothing selected or the time is up.
 */
export function lootAction(card, index) {
  if (!card || card.ms === 0) return null;
  if (card.empty) return { type: 'lootChoice', victim: card.victim, choice: { kind: 'none' } };
  const pick = index === null || index === undefined ? null : card.tools[index];
  return pick ? { type: 'lootChoice', victim: card.victim, choice: { kind: 'tool', tool: pick.tool } } : null;
}

/** The texts of a card (names are never put inside a Turkish word). */
export function lootTexts(card, nameOf) {
  return {
    title: t('loot.lootTitle', nameOf(card.victim)),
    sub: card.empty ? t('loot.lootOnlyYou') : t('loot.lootOnlyYouPick'),
    button: card.empty ? t('loot.lootOk') : t('loot.lootTake'),
  };
}

/** A refusal of a loot choice as one Turkish line (never a raw code). */
export function lootErrorText(error) {
  return error?.code === 'NO_LOOT' ? t('loot.lootGone') : t('loot.lootRefused');
}
