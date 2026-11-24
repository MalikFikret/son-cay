// The shot result notice (decision Q68): after every live shot, every device at the table shows
// who fired at whom, Dolu / Boş (with "2×" when Çift Ateş applied) and one row per affected
// player, for SHOT_NOTICE_BASE_MS plus SHOT_NOTICE_ROW_MS per row after the first.
//
// Pure: built ONLY from the PUBLIC events of one update (the `shot` event and the turn that
// follows it). Private and audit events are ignored, so a hidden tool (Mermi Çevir, Hokkabaz,
// Kaydır, ...) can never show up: a flipped chamber looks exactly like a real one of the shown
// kind. The engine's public `shot` event already lists every hit: { player, result: 'damage' |
// 'reflected' | 'absorbed', amount?, hp?, via: 'direct' | 'link' | 'reflect' }.

import { t } from './i18n/i18n.js';

export const SHOT_NOTICE_BASE_MS = 3000;
export const SHOT_NOTICE_ROW_MS = 1000;

const isPublic = (event) => event?.visibility === 'public';

/**
 * The notice of the LAST public shot in one update's events, or null if there is none.
 * @param {object[]} events the events of one update (any visibility; only public ones are read)
 * @param {(id: string) => string} nameOf seat id -> display name
 * @returns {null | {
 *   kind: 'live' | 'blank',
 *   self: boolean, shooter: string, target: string,
 *   word: string, double: boolean,
 *   rows: { player: string, name: string, chain: boolean, value: string, tone: 'damage' | 'shield' }[],
 *   lines: string[],
 *   durationMs: number,
 * }}
 */
export function shotNotice(events, nameOf) {
  const list = (events ?? []).filter(isPublic);
  let index = -1;
  list.forEach((event, i) => { if (event.type === 'shot') index = i; });
  if (index === -1) return null;
  const shot = list[index];
  const after = list.slice(index + 1);
  const live = shot.effect === 'live';
  const self = shot.shooter === shot.target;
  const hits = Array.isArray(shot.hits) ? shot.hits : [];

  const rows = [];
  const lines = [];
  if (live) {
    const damaged = hits.some((hit) => hit.result === 'damage');
    for (const hit of hits) {
      const row = { player: hit.player, name: nameOf(hit.player), chain: hit.via === 'link', value: '', tone: 'damage' };
      if (hit.result === 'damage') {
        row.value = t('shotNotice.shotNoticeDamage', hit.amount) + (hit.hp === 0 ? ` ${t('shotNotice.shotNoticeOut')}` : '');
      } else if (hit.result === 'reflected') {
        row.value = t('shotNotice.shotNoticeReflected');
        row.tone = 'shield';
      } else if (hit.result === 'absorbed') {
        row.value = t('shotNotice.shotNoticeAbsorbed');
        row.tone = 'shield';
      } else {
        continue;
      }
      rows.push(row);
    }
    // The shooter's own shield stopped the reflected shot: two shields, nobody hurt.
    const twoShields = hits.some((hit) => hit.result === 'absorbed' && hit.via === 'reflect');
    if (twoShields && !damaged) lines.push(t('shotNotice.shotNoticeTwoShields'));
  } else {
    // Boş: whose turn it is now (the next public turnStarted; a blank on self keeps the turn).
    const next = after.find((event) => event.type === 'turnStarted');
    const player = next ? next.player : (self ? shot.shooter : null);
    if (player) lines.push(t('shotNotice.shotNoticeTurn', nameOf(player)));
  }

  return {
    kind: live ? 'live' : 'blank',
    self,
    shooter: nameOf(shot.shooter),
    target: nameOf(shot.target),
    word: live ? t('shotNotice.shotNoticeLive') : t('shotNotice.shotNoticeBlank'),
    double: live && shot.doubled === true,
    rows,
    lines,
    durationMs: SHOT_NOTICE_BASE_MS + SHOT_NOTICE_ROW_MS * Math.max(0, rows.length - 1),
  };
}
