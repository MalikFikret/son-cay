// Pure helpers for being away from the table (decision Q70): the "Masaya dön" bar on Giriş and
// the one-table-per-player guard. No DOM, no database.

import { isValidRoomCode } from '../rooms/index.js';
import { TEXT } from './messages.js';

export const BAR = Object.freeze({ HIDDEN: 'hidden', NEUTRAL: 'neutral', MY_TURN: 'myTurn' });

/**
 * The "Masaya dön" bar on Giriş.
 * - hidden: this tab holds no seat, or the room is gone / the seat lost;
 * - myTurn (red "Sıra sende"): a running match, I am alive in it and the turn is mine;
 * - neutral: seated anywhere else (waiting room, someone else's turn, an ended match, out).
 * @param {{ held: { code: string, seatId: string } | null, roomGone?: boolean,
 *   seatLost?: boolean, view?: object | null }} input `view`: my watchMatch view, if any
 * @returns {{ kind: string, code: string | null }}
 */
export function homeBarState({ held, roomGone = false, seatLost = false, view = null }) {
  if (!held || !isValidRoomCode(held.code) || typeof held.seatId !== 'string' || roomGone || seatLost) {
    return { kind: BAR.HIDDEN, code: null };
  }
  const myTurn = view !== null && typeof view === 'object'
    && view.status === 'active'
    && view.role === 'alive'
    && view.turn?.playerId === held.seatId;
  return { kind: myTurn ? BAR.MY_TURN : BAR.NEUTRAL, code: held.code };
}

/**
 * One table per player: while seated, creating a table or joining / recovering at another one
 * is refused (no database read or write follows); opening my own table is allowed.
 * @param {{ heldCode: string | null, intent: 'create' | 'join' | 'recover', code?: string | null }} input
 * @returns {{ allowed: boolean, sameTable: boolean, message: string | null }}
 */
export function tableGuard({ heldCode, intent, code = null }) {
  if (!heldCode) return { allowed: true, sameTable: false, message: null };
  if (intent !== 'create' && code === heldCode) return { allowed: true, sameTable: true, message: null };
  return { allowed: false, sameTable: false, message: TEXT.backToYourTableFirst };
}
