// Nasıl oynanır (step 4.8, decision Q73): what the screen shows, as plain data (pure, no DOM; the
// texts come from the locale in the current language).
//
// - The numbers the rules call "usually" (shot time, tools per turn) are the engine's defaults
//   for a Classic table (defaultConfig), and the loot time is the engine's LOOT_SECONDS: never
//   written here by hand.
// - The Malzemeler tab lists every engine tool (TOOL_IDS), split as in the approved mock
//   (conversation 11, model 2): "Sıranda" (timing 'turn') and "Her an" (timing 'anytime', copper
//   frame). Names, explanations and tags are the shared tools.* locale entries (tools.js), the
//   same ones the tool card uses. A tool's tags: "her an" first for the copper ones, then its
//   visibility (Classic: Kaydır is hidden); the "sıranda" tag is left out, its heading says it.

import { LOOT_SECONDS, TOOL_IDS, TOOL_INFO, defaultConfig } from '../engine/index.js';
import { t } from './i18n/i18n.js';
import { isTool, toolHelp, toolName } from './tools.js';

/** The kinds of tag shown on a tool row (CSS: .howto-tag.is-<kind>). */
export const TAG_KINDS = Object.freeze({ HIDDEN: 'hidden', ANNOUNCED: 'announced', ANYTIME: 'anytime' });

/** The table defaults the rules mention ("genelde 30 saniye", "genelde 3"). */
export function ruleNumbers(mode = 'classic') {
  const config = defaultConfig(mode);
  return { shotTimeSeconds: config.shotTimeSeconds, toolsPerTurn: config.toolsPerTurn, lootSeconds: LOOT_SECONDS };
}

/** A tool's tags on the Malzemeler tab: [{ kind, text }]. */
export function howToTags(tool, mode = 'classic') {
  if (!isTool(tool)) return [];
  const info = TOOL_INFO[tool];
  const tags = [];
  if (info.timing === 'anytime') tags.push({ kind: TAG_KINDS.ANYTIME, text: t('tools.tags.anytime') });
  const hidden = info.hidden === 'always' || (info.hidden === 'classic' && mode === 'classic');
  if (hidden) tags.push({ kind: TAG_KINDS.HIDDEN, text: t('tools.tags.hidden') });
  else if (tool === 'steal') tags.push({ kind: TAG_KINDS.ANNOUNCED, text: t('tools.tags.stealAnnounced') });
  else tags.push({ kind: TAG_KINDS.ANNOUNCED, text: t('tools.tags.announced') });
  return tags;
}

/**
 * The Malzemeler tab: every engine tool, in the engine's order, in two groups.
 * @returns {{ turn: object[], anytime: object[], count: number }} rows { id, name, help, tags }
 */
export function howToTools(mode = 'classic') {
  const rows = TOOL_IDS.map((id) => ({ id, name: toolName(id), help: toolHelp(id), tags: howToTags(id, mode) }));
  const anytime = (row) => TOOL_INFO[row.id].timing === 'anytime';
  return { turn: rows.filter((row) => !anytime(row)), anytime: rows.filter(anytime), count: rows.length };
}

/** The legend of the three tags (mock: "gizli", "herkes görür", "her an"). */
export function tagLegend() {
  return [
    { kind: TAG_KINDS.HIDDEN, tag: t('tools.tags.hidden'), text: t('howTo.legendHidden') },
    { kind: TAG_KINDS.ANNOUNCED, tag: t('tools.tags.announced'), text: t('howTo.legendAnnounced') },
    { kind: TAG_KINDS.ANYTIME, tag: t('tools.tags.anytime'), text: t('howTo.legendAnytime') },
  ];
}

/** The four cases of the Sıra table: [case, result, highlighted]. */
export function turnCases() {
  return [
    { label: t('howTo.turnSelfBlank'), result: t('howTo.turnSelfBlankResult'), keepsTurn: true },
    { label: t('howTo.turnSelfLive'), result: t('howTo.turnSelfLiveResult'), keepsTurn: false },
    { label: t('howTo.turnOtherBlank'), result: t('howTo.turnOtherBlankResult'), keepsTurn: false },
    { label: t('howTo.turnOtherLive'), result: t('howTo.turnOtherLiveResult'), keepsTurn: false },
  ];
}
