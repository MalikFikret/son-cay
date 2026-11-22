// setSeatOrder / clearSeatOrder: the host's manual seating order for the next matches.
//
// rooms/{CODE}/seatOrder = { seats: [seatId, ...], savedAt: <server time> }; absent = random
// order. Only the current host, only between matches (the security rules check the same).
// startMatch reads it (orderSeats in match-helpers.js).

import { MAX_PLAYERS } from '../engine/index.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { LOBBY_STATUS, isSeatId, paths } from './schema.js';

/**
 * @param {object} ctx shared helpers from api.js
 */
export function createSeatOrderFunctions({ read, writeAll, serverTimestamp, requireUid, requireCode, currentSeat }) {
  // Room, lobby and host checks shared by both functions.
  async function requireHostInLobby(roomCode, uid) {
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    if (meta.status !== LOBBY_STATUS) throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'the seat order changes only between matches');
    const mySeat = await currentSeat(roomCode, uid);
    if (mySeat === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    if (meta.hostSeat !== mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can set the seat order');
  }

  async function write(roomCode, value) {
    try {
      await writeAll({ [paths.seatOrder(roomCode)]: value });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      const meta = await read(paths.meta(roomCode));
      if (meta !== null && meta.status !== LOBBY_STATUS) throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a match was started meanwhile', error);
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused the seat order', error);
    }
  }

  /**
   * Saves a manual seating order. Seats that are not taken when a match starts are skipped;
   * seated players missing from the list, or who sit down after it was saved, play after the
   * listed ones.
   * @param {{ uid: string, code: string, order: string[] }} input  1-15 distinct seat ids
   * @returns {Promise<{ seats: string[] }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT_ORDER (not 1-15 distinct seat
   *   ids; nothing written), ROOM_NOT_FOUND, NOT_IN_LOBBY, NOT_MEMBER, WRITE_DENIED (not the host)
   */
  async function setSeatOrder({ uid, code, order } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    if (!Array.isArray(order) || order.length < 1 || order.length > MAX_PLAYERS
      || !order.every(isSeatId) || new Set(order).size !== order.length) {
      throw new RoomError(ROOM_ERR.INVALID_SEAT_ORDER, `the order must be 1 to ${MAX_PLAYERS} distinct seat ids`);
    }
    await requireHostInLobby(roomCode, uid);
    await write(roomCode, { seats: [...order], savedAt: serverTimestamp() });
    return { seats: [...order] };
  }

  /**
   * Removes the manual order: the next matches seat the players at random again.
   * @param {{ uid: string, code: string }} input
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_IN_LOBBY, NOT_MEMBER,
   *   WRITE_DENIED (not the host)
   */
  async function clearSeatOrder({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    await requireHostInLobby(roomCode, uid);
    await write(roomCode, null);
  }

  return { setSeatOrder, clearSeatOrder };
}
