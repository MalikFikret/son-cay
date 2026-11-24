// Renaming and kicking seats between matches (meta.status === 'lobby').
//
// - renameSeat: the host renames any seat, a player their own. The seat name and the names index
//   change in one atomic update: the old names entry goes, the new one comes (a change of case
//   only keeps the same key, so the index is left alone).
// - kickSeat: the host deletes another player's seat, and in the same update its secret, claim,
//   presence entry, names entry and every members entry that points to it (the current device's
//   and stale ones of older devices). There is no ban: the kicked player may join again.
//
// The security rules are the real guard (tools/rules/); these checks only give clear errors.

import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { LOBBY_STATUS, nameKey, paths } from './schema.js';

/**
 * Builds renameSeat and kickSeat for createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createManageFunctions(ctx) {
  const { read, writeAll, requireUid, requireCode, requireSeat, requireName, currentSeat, nameTaken } = ctx;

  // The room's meta and the caller's own seat, or the matching error.
  async function lobbyMember(roomCode, uid) {
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    if (meta.status !== LOBBY_STATUS) {
      throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'seats can only be renamed or kicked between matches');
    }
    const mySeat = await currentSeat(roomCode, uid);
    if (mySeat === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    return { meta, mySeat };
  }

  /**
   * Renames a seat between matches: the host may rename any seat, a player their own. Names are
   * unique per room, compared case-insensitively; changing only the case of a name is allowed.
   * @param {{ uid: string, code: string, seatId: string, name: string }} input
   * @returns {Promise<{ seatId: string, name: string }>} the stored (trimmed) name
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT, INVALID_NAME, ROOM_NOT_FOUND,
   *   NOT_IN_LOBBY, NOT_MEMBER, SEAT_EMPTY, NAME_TAKEN (also when another device took the name
   *   meanwhile), WRITE_DENIED (not the host and not the caller's own seat, or refused)
   */
  async function renameSeat({ uid, code, seatId, name } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    const newName = requireName(name);
    const { meta, mySeat } = await lobbyMember(roomCode, uid);
    if (seatId !== mySeat && meta.hostSeat !== mySeat) {
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can rename another player\'s seat');
    }
    const oldName = await read(paths.seatName(roomCode, seatId));
    if (oldName === null) throw new RoomError(ROOM_ERR.SEAT_EMPTY, `seat ${seatId} is empty`);
    if (oldName === newName) return { seatId, name: newName };

    const oldKey = nameKey(oldName);
    const newKey = nameKey(newName);
    if (newKey !== oldKey && (await nameTaken(roomCode, newName, seatId))) {
      throw new RoomError(ROOM_ERR.NAME_TAKEN, `the name is already used in room ${roomCode}`);
    }
    const values = { [paths.seatName(roomCode, seatId)]: newName };
    if (newKey !== oldKey) {
      values[paths.name(roomCode, oldKey)] = null;
      values[paths.name(roomCode, newKey)] = seatId;
    }
    try {
      await writeAll(values);
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // Another device may have taken the name between the check and the write.
      if (newKey !== oldKey && (await nameTaken(roomCode, newName, seatId))) {
        throw new RoomError(ROOM_ERR.NAME_TAKEN, `the name is already used in room ${roomCode}`, error);
      }
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused the rename', error);
    }
    return { seatId, name: newName };
  }

  /**
   * The host removes another player's seat between matches. The seat becomes free, its PIN and
   * name with it; the kicked player may join again with the room code (no ban). Their device
   * sees SEAT_LOST from its running startPresence / watchHost.
   * @param {{ uid: string, code: string, seatId: string }} input
   * @returns {Promise<{ seatId: string }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT, ROOM_NOT_FOUND, NOT_IN_LOBBY,
   *   NOT_MEMBER, SEAT_EMPTY, WRITE_DENIED (not the host, the host's own seat, or refused)
   */
  async function kickSeat({ uid, code, seatId } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    const { meta, mySeat } = await lobbyMember(roomCode, uid);
    if (meta.hostSeat !== mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can kick a seat');
    if (seatId === mySeat) {
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the host cannot kick their own seat (use leaveRoom)');
    }
    const seat = await read(paths.seat(roomCode, seatId));
    if (seat === null) throw new RoomError(ROOM_ERR.SEAT_EMPTY, `seat ${seatId} is empty`);

    const values = {
      [paths.seat(roomCode, seatId)]: null,
      [paths.secret(roomCode, seatId)]: null,
      [paths.claim(roomCode, seatId)]: null,
      [paths.presenceSeat(roomCode, seatId)]: null,
      [paths.press(roomCode, seatId)]: null,
      [paths.name(roomCode, nameKey(seat.name))]: null,
      [paths.member(roomCode, seat.uid)]: null,
    };
    // Stale entries of older devices of this seat (after a recovery) go too.
    const members = (await read(paths.members(roomCode))) ?? {};
    for (const [memberUid, memberSeat] of Object.entries(members)) {
      if (memberSeat === seatId) values[paths.member(roomCode, memberUid)] = null;
    }
    try {
      await writeAll(values);
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // The player may have left (or been recovered and renamed) meanwhile.
      if ((await read(paths.seat(roomCode, seatId))) === null) {
        throw new RoomError(ROOM_ERR.SEAT_EMPTY, `seat ${seatId} is empty`, error);
      }
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused to kick the seat', error);
    }
    return { seatId };
  }

  return { renameSeat, kickSeat };
}
