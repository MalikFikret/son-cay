// Closing a room (decision Q67): the current host deletes rooms/{CODE} in one write.
//
// Between matches the host may always close the room. During a match the UI allows it only when
// every other seat is absent (othersAbsent in host.js); the rules cannot iterate presence, so
// they let the host delete at any time, and so does this function.
//
// Before writing, deleteRoom stops this database instance's startPresence() and watchHost() for
// the room (stopLiveFor), so their onDisconnect handlers are cancelled while the caller is still
// a member and nothing of this device writes into the deleted room later. Other devices'
// onDisconnect writes are refused by the rules (nothing can exist under rooms/{CODE} without
// meta).

import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { paths } from './schema.js';

/**
 * Builds deleteRoom for createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createCloseFunction(ctx) {
  const { read, writeAll, requireUid, requireCode, currentSeat, stopLiveFor } = ctx;

  /**
   * The current host deletes the whole room (match, results and session included).
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<{ deleted: true }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_MEMBER (no seat here),
   *   WRITE_DENIED (not the host, or the write was refused)
   */
  async function deleteRoom({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    const seatId = await currentSeat(roomCode, uid);
    if (seatId === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    if (meta.hostSeat !== seatId) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the current host can close the room');

    await stopLiveFor(roomCode);
    try {
      await writeAll({ [paths.room(roomCode)]: null });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      throw new RoomError(ROOM_ERR.WRITE_DENIED, `closing room ${roomCode} was refused`, error);
    }
    return { deleted: true };
  }

  return deleteRoom;
}
