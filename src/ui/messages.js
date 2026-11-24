// Error messages (pure, no DOM): a thin layer over the locale (src/ui/i18n/). The room layer and
// the engine only produce stable English codes; this is the one place that turns them into what a
// player reads, through t('errors.room.CODE') / t('errors.form.CODE'). A raw code is never shown.

import { ROOM_ERR } from '../rooms/index.js';
import { hasText, t } from './i18n/i18n.js';

// Codes are looked up as whole keys only (no dots), so "a.b" or "__proto__" can never reach
// another entry.
const isCode = (code) => typeof code === 'string' && /^[A-Za-z_]+$/.test(code);

function looksOffline(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('offline') || text.includes('network') || text.includes('unavailable');
}

/**
 * The message for an error, in the current language: a RoomError (by its code), a bare code
 * string (a room-layer code or a form check such as CODE_EMPTY), or any other error (network
 * problems get the offline message, everything else a generic one).
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (isCode(code) && hasText(`errors.room.${code}`)) return t(`errors.room.${code}`);
  if (isCode(code) && hasText(`errors.form.${code}`)) return t(`errors.form.${code}`);
  if (error && typeof error === 'object' && looksOffline(error)) return t('errors.offline');
  return t('errors.generic');
}

/** Errors after which the recover button waits (the rules allow one claim per seat every 2 s). */
export const RETRY_WAIT_CODES = Object.freeze([ROOM_ERR.WRONG_PIN, ROOM_ERR.RETRY_LATER]);
export const RETRY_WAIT_SECONDS = 2;
