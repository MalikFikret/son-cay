// The round intro screen, "Tur girişi" (step 4.4d-b, decision Q79; approved mock: conversation 23,
// model 1). Pure: what the screen shows during the round intro, from this device's view and the
// shared pause window only (src/rooms/clock.js pauseWindow), so every device shows the same and a
// device that arrives mid-intro sees the bar already part-filled.
//
// The numbers are the round's announced counts (public). The bullet dots come in two groups,
// Dolu filled then Boş outlined, never in the cylinder's order (which nobody knows). The first
// turn is the countdown's player (view.turn), "sen" on that player's own device.

import { t } from './i18n/i18n.js';

/**
 * How far the intro has run, 0..1, from the shared pause window and server time. With `stepMs`
 * (Hareketler off) the time is taken in whole steps, so the bar moves once a second.
 * @param {{ introAt: number, end: number } | null} pause
 * @param {number} serverNow
 * @param {{ stepMs?: number }} [options]
 */
export function introFraction(pause, serverNow, { stepMs = 0 } = {}) {
  if (!pause || !(pause.end > pause.introAt)) return 0;
  let elapsed = serverNow - pause.introAt;
  if (stepMs > 0) elapsed = Math.floor(elapsed / stepMs) * stepMs;
  return Math.min(1, Math.max(0, elapsed / (pause.end - pause.introAt)));
}

/**
 * The texts and numbers of the intro screen, or null without a usable round.
 * @param {{ view: object, mySeat: string | null, nameOf: (id: string) => string }} input
 * @returns {{ kicker: string, round: string, liveDots: number, blankDots: number, total: string,
 *   live: string, blank: string, first: string | null, mine: boolean, announce: string } | null}
 */
export function introModel({ view, mySeat, nameOf }) {
  const round = view?.round;
  const counts = round?.announced;
  if (!round || !Number.isInteger(round.index) || !counts || !Number.isInteger(counts.live) || !Number.isInteger(counts.blank)) return null;
  const total = counts.live + counts.blank;
  const firstId = view.turn?.playerId ?? null;
  const mine = firstId !== null && firstId === mySeat;
  const first = firstId === null ? null : (mine ? t('roundIntro.firstTurnYou') : t('roundIntro.firstTurn', nameOf(firstId)));
  const kicker = round.index === 1 ? t('roundIntro.matchStarting') : t('roundIntro.newRound');
  const roundText = t('roundIntro.round', round.index);
  const totalText = t('roundIntro.bullets', total);
  return {
    kicker,
    round: roundText,
    liveDots: counts.live,
    blankDots: counts.blank,
    total: totalText,
    live: t('roundIntro.live', counts.live),
    blank: t('roundIntro.blank', counts.blank),
    first,
    mine,
    announce: t('roundIntro.announce', kicker, roundText, totalText, t('roundIntro.counts', counts.live, counts.blank), first ?? ''),
  };
}
