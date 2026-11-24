// The press signal (step 4.4b, decisions Q55 as changed by Q74, Q56):
//
//   rooms/{CODE}/press/{seatId} = { n, seq, at }
//
// "This seat's player is holding the fire button" (a long press, from the moment the hammer is
// cocked), so every screen can spin the revolver. n is the match number, seq the countdown
// (the engine's clock.seq) the press belongs to, at the server time of the write. Nothing about
// the target: the target leaves the device only inside the shot (Q56).
//
// - setPress writes it (and registers an onDisconnect removal first, so a tab closed mid-press
//   never leaves it behind); clearPress removes it (and cancels that removal). No other writes.
// - watchPress delivers every seat's entry; the CLIENT decides whether to believe one
//   (src/ui/press-signal.js): the rules cannot read whose turn it is.
// - Rules (tools/rules/press.js): members read; only the valid member on that seat writes or
//   removes it; writes only while a match runs; strict shape; at === server time. Leaving and
//   kicking remove it with the seat.

import { ROOM_ERR, RoomError } from './errors.js';
import { isSeatId, paths } from './schema.js';

function safeCall(fn, value) {
  if (typeof fn !== 'function') return;
  try {
    fn(value);
  } catch {
    // A caller's failure never breaks the listener.
  }
}

const isCount = (value) => Number.isInteger(value) && value >= 0 && value <= 1e9;

/**
 * Keeps only well-formed entries of the press branch: { seatId: { n, seq, at } }.
 * @param {unknown} raw the press node as read
 * @returns {Record<string, { n: number, seq: number, at: number }>}
 */
export function normalizePress(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [seatId, entry] of Object.entries(raw)) {
    if (!isSeatId(seatId) || entry === null || typeof entry !== 'object') continue;
    const { n, seq, at } = entry;
    if (isCount(n) && isCount(seq) && Number.isFinite(at)) out[seatId] = { n, seq, at };
  }
  return out;
}

/**
 * Builds setPress, clearPress and watchPress for createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createPressFunctions(ctx) {
  const { deps, db, ref, writeAll, serverTimestamp, requireUid, requireCode, requireSeat } = ctx;

  function requireDisconnect() {
    if (typeof deps.onDisconnect !== 'function') {
      throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'missing function: onDisconnect (needed for the press signal)');
    }
  }

  /**
   * "I am holding the fire button" for my seat, in match n, countdown seq.
   * @param {{ uid: string, code: string, seatId: string, n: number, seq: number }} input
   */
  async function setPress({ uid, code, seatId, n, seq } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    if (!isCount(n) || !isCount(seq)) throw new RoomError(ROOM_ERR.INVALID_ACTION, 'n and seq must be whole numbers');
    requireDisconnect();
    const path = paths.press(roomCode, seatId);
    // The removal is registered before the write: a tab that disappears mid-press cleans up.
    await deps.onDisconnect(ref(db, path)).remove();
    await writeAll({ [path]: { n, seq, at: serverTimestamp() } });
  }

  /**
   * The press ended (released, cancelled, expired, or the screen was left): remove my entry.
   * @param {{ uid: string, code: string, seatId: string }} input
   */
  async function clearPress({ uid, code, seatId } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    const path = paths.press(roomCode, seatId);
    await writeAll({ [path]: null });
    if (typeof deps.onDisconnect === 'function') await deps.onDisconnect(ref(db, path)).cancel();
  }

  /**
   * Listens to the press branch: onUpdate({ [seatId]: { n, seq, at } }) after every change.
   * @returns {() => void} stop
   */
  function watchPress({ uid, code, onUpdate, onError } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    if (typeof deps.onValue !== 'function') {
      throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'missing function: onValue (needed for watchPress)');
    }
    if (typeof onUpdate !== 'function') throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'watchPress needs onUpdate');
    let stopped = false;
    const unsubscribe = deps.onValue(
      ref(db, paths.pressAll(roomCode)),
      (snapshot) => {
        if (!stopped) safeCall(onUpdate, normalizePress(snapshot.val()));
      },
      (error) => {
        if (stopped) return;
        stopped = true;
        safeCall(onError, new RoomError(ROOM_ERR.SEAT_LOST, `this device can no longer watch room ${roomCode}`, error));
      },
    );
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        unsubscribe();
      } catch {
        // Already gone.
      }
    };
  }

  return { setPress, clearPress, watchPress };
}
