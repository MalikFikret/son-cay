// Pure helpers of the waiting room (no DOM): the settings the host can step, the tool list and
// its counter, and the player rows. Limits come from the engine (CONFIG_LIMITS, defaultConfig,
// validateConfig, toolsForMode), never from copies. Tool names and icons live in tools.js.

import { CONFIG_LIMITS, MIN_PLAYERS, TOOL_IDS, defaultConfig, toolsForMode, validateConfig } from '../engine/index.js';
import { isSeatPresent, orderSeats, othersAbsent } from '../rooms/index.js';
import { t } from './i18n/i18n.js';
import { toolName } from './tools.js';

// One stepped setting: its labels are read from the locale whenever they are shown (getters),
// so they follow the current language.
function steppedSetting(key, step, { label, summaryLabel = label, format = String, summary = format }) {
  return Object.freeze({
    key,
    step,
    get label() { return t(label); },
    get summaryLabel() { return t(summaryLabel); },
    format,
    summary,
  });
}

const seconds = (n) => t('settings.seconds', n);

/** The general settings with − / + buttons, in the order of the design. */
export const STEPPED_SETTINGS = Object.freeze([
  steppedSetting('hp', 1, { label: 'settings.hp', summaryLabel: 'settings.hpShort', summary: (n) => t('settings.hpValue', n) }),
  steppedSetting('toolsPerReload', 1, { label: 'settings.toolsPerReload' }),
  steppedSetting('toolsPerTurn', 1, { label: 'settings.toolsPerTurn' }),
  steppedSetting('shotTimeSeconds', 5, { label: 'settings.shotTime', format: seconds, summary: seconds }),
]);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isToolId = (tool) => typeof tool === 'string' && TOOL_IDS.includes(tool);
const stepped = (key) => STEPPED_SETTINGS.find((s) => s.key === key) ?? null;

/** [min, max] of a stepped setting, from the engine. */
export function settingLimits(key) {
  if (!stepped(key) || !hasOwn(CONFIG_LIMITS, key)) throw new Error(`not a stepped setting: ${String(key)}`);
  return CONFIG_LIMITS[key];
}

/**
 * The settings as the engine would use them: a value read from the database, normalized by
 * validateConfig; anything invalid (or missing) falls back to the defaults of `mode`.
 * @returns {object} a full config
 */
export function normalizeSettings(raw, mode = 'classic') {
  const checked = validateConfig(raw ?? {});
  if (checked.ok && checked.config.mode === mode) return checked.config;
  return defaultConfig(mode);
}

/** Whether − (direction -1) or + (+1) can change `key` within the engine's limits. */
export function canStep(config, key, direction) {
  const [min, max] = settingLimits(key);
  const value = config[key];
  return direction < 0 ? value > min : value < max;
}

/**
 * One − / + tap: the value moves by the setting's step and is clamped to the engine's limits.
 * Returns a new config (the same object if nothing changes).
 */
export function stepSetting(config, key, direction) {
  const { step } = stepped(key) ?? {};
  const [min, max] = settingLimits(key);
  if (!canStep(config, key, direction)) return config;
  const next = Math.min(max, Math.max(min, config[key] + Math.sign(direction) * step));
  return next === config[key] ? config : { ...config, [key]: next };
}

/** The tools of the config's mode, in the engine's order, each with its name and state. */
export function toolList(config) {
  const enabled = new Set(config.enabledTools);
  return toolsForMode(config.mode).map((tool) => ({ tool, name: toolName(tool), enabled: enabled.has(tool) }));
}

/** "Oyundaki malzemeler N / M": enabled tools and all tools of the mode. */
export function toolCounter(config) {
  const all = toolsForMode(config.mode);
  return { enabled: config.enabledTools.filter((tool) => all.includes(tool)).length, total: all.length };
}

/**
 * Switches one tool on or off. The last enabled tool cannot be switched off (an empty list
 * cannot be stored). Returns a new config, in the engine's tool order (or the same object).
 */
export function toggleTool(config, tool) {
  if (!isToolId(tool) || !toolsForMode(config.mode).includes(tool)) return config;
  const on = config.enabledTools.includes(tool);
  if (on && config.enabledTools.length <= 1) return config;
  const set = new Set(config.enabledTools);
  if (on) set.delete(tool);
  else set.add(tool);
  return { ...config, enabledTools: TOOL_IDS.filter((id) => set.has(id)) };
}

export function canToggleTool(config, tool) {
  return toggleTool(config, tool) !== config;
}

/** True if two configs hold the same settings. */
export function sameSettings(a, b) {
  return JSON.stringify(normalizeSettings(a, a?.mode)) === JSON.stringify(normalizeSettings(b, b?.mode));
}

/** The defaults of the config's mode ("Varsayılanlara dön"). */
export function defaultsFor(config) {
  return defaultConfig(config?.mode ?? 'classic');
}

export function formatPoints(points) {
  return t('lobby.points', Number.isFinite(points) ? points : 0);
}

/**
 * The rows of the player list, in playing order (the host's saved seat order, else seat order),
 * with their labels: "sen", "masa sahibi", "bağlantı yok", "sonraki maçta oynar" (a waiting seat).
 * @param {{ seats: object, presence: object, scores: object, hostSeat: string, mySeat: string,
 *   seatOrder?: object | null }} lobby
 */
export function playerRows({ seats, presence, scores, hostSeat, mySeat, seatOrder = null }) {
  return orderSeats(seats ?? {}, seatOrder).seatIds
    .filter((seatId) => typeof seats[seatId].name === 'string')
    .map((seatId) => {
      const seat = seats[seatId];
      const me = seatId === mySeat;
      const host = seatId === hostSeat;
      const present = isSeatPresent(presence?.[seatId]);
      const waiting = seat.waiting === true;
      const tags = [];
      if (me) tags.push(t('lobby.tagMe'));
      if (host) tags.push(t('lobby.tagHost'));
      if (!present) tags.push(t('lobby.tagAbsent'));
      if (waiting) tags.push(t('lobby.tagWaiting'));
      return {
        seatId,
        name: seat.name,
        me,
        host,
        present,
        waiting,
        points: scores?.[seatId] ?? 0,
        tagLine: tags.join(' · '),
      };
    });
}

/**
 * Moves one entry of the seat order up (delta -1) or down (+1). Returns a new array (the same
 * one if the move would leave the list).
 */
export function moveSeat(order, index, delta) {
  const to = index + Math.sign(delta);
  if (!Number.isInteger(index) || index < 0 || index >= order.length || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * The options of a player's "⋯" menu, for the viewer: the host may rename anyone, hand the host
 * role to another seat and remove another seat; a player may only rename themself. Only in the
 * lobby. Returns [] when there is nothing to offer (then no "⋯" button is shown).
 * @param {{ seatId: string }} row
 * @param {{ mySeat: string, hostSeat: string, inLobby: boolean }} viewer
 * @returns {Array<'rename' | 'handOver' | 'kick'>}
 */
export function playerOptions(row, { mySeat, hostSeat, inLobby }) {
  if (!inLobby) return [];
  const iAmHost = mySeat === hostSeat;
  const own = row.seatId === mySeat;
  if (iAmHost) return own ? ['rename'] : ['rename', 'handOver', 'kick'];
  return own ? ['rename'] : [];
}

/** Can the host start, and who is absent (shown before starting). */
export function startCheck(rows) {
  return { canStart: rows.length >= MIN_PLAYERS, absent: rows.filter((row) => !row.present) };
}

/**
 * "Masayı kapat" (decision Q67): shown to the current host only. Between matches it is always
 * enabled; during a match only while every other seat is absent (othersAbsent), else disabled
 * with a hint that it unlocks when the match ends. This condition is the UI's alone: the rules
 * let the host delete the room at any time.
 * @param {{ mySeat: string, hostSeat: string | null, status: string, seats: object | null,
 *   presence: object | null }} room
 * @returns {{ visible: boolean, enabled: boolean, hint: string | null }}
 */
export function closeRoomState({ mySeat, hostSeat, status, seats, presence }) {
  if (typeof mySeat !== 'string' || mySeat !== hostSeat) return { visible: false, enabled: false, hint: null };
  if (status !== 'playing') return { visible: true, enabled: true, hint: null };
  const free = othersAbsent(seats, presence, mySeat);
  return { visible: true, enabled: free, hint: free ? t('closeRoom.closeRoomAllAbsent') : t('closeRoom.closeRoomLocked') };
}
