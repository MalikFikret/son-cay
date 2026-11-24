// Leaving a room between matches (meta.status === 'lobby').
//
// - An ordinary player deletes, in one atomic update, their seat, its secret, claim, presence
//   entry and names entry, their members entry, and stale members entries of their old devices
//   that still point to this seat (recovery leaves those behind). The seat and the name become
//   free.
// - The host does the same and, in the same update, moves meta.hostSeat to another seat:
//   a present one if any, otherwise any other occupied seat (chooseNewHost, random for now).
// - The only seated player deletes the whole room in one write.
//
// The rules check every write against the data as it is when the write arrives, so a write built
// on a stale picture (someone else left, joined or moved the host meanwhile) is refused; then
// leaveRoom reads again and recomputes, up to LEAVE_ATTEMPTS writes in total.

import { chooseNewHost, isSeatPresent } from './host.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { LOBBY_STATUS, SEAT_IDS, nameKey, paths } from './schema.js';

const LEAVE_ATTEMPTS = 3;

/**
 * Builds leaveRoom for createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createLeaveFunction(ctx) {
  const { deps, read, writeAll, requireUid, requireCode, currentSeat, stopLiveFor } = ctx;
  const random = typeof deps.random === 'function' ? deps.random : Math.random;

  async function readRoomState(roomCode, uid) {
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    if (meta.status !== LOBBY_STATUS) {
      throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a room can only be left between matches');
    }
    const seatId = await currentSeat(roomCode, uid);
    if (seatId === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    return { meta, seatId };
  }

  // The update for one attempt, from the room as just read. Returns the values to write and
  // the result to report if the write succeeds.
  async function planLeave(roomCode, uid, meta, seatId) {
    const seats = (await read(paths.seats(roomCode))) ?? {};
    const others = SEAT_IDS.filter((id) => id !== seatId && seats[id] !== undefined && seats[id] !== null);
    if (others.length === 0) {
      return { values: { [paths.room(roomCode)]: null }, result: { deletedRoom: true, hostSeat: null } };
    }

    const values = {
      [paths.seat(roomCode, seatId)]: null,
      [paths.secret(roomCode, seatId)]: null,
      [paths.claim(roomCode, seatId)]: null,
      [paths.presenceSeat(roomCode, seatId)]: null,
      [paths.press(roomCode, seatId)]: null,
      [paths.member(roomCode, uid)]: null,
      [paths.name(roomCode, nameKey(seats[seatId].name))]: null,
    };
    // Old devices of this seat (after a recovery) keep a stale entry pointing here.
    const members = (await read(paths.members(roomCode))) ?? {};
    for (const [memberUid, memberSeat] of Object.entries(members)) {
      if (memberSeat === seatId) values[paths.member(roomCode, memberUid)] = null;
    }

    let hostSeat = null;
    if (meta.hostSeat === seatId) {
      const presence = (await read(paths.presence(roomCode))) ?? {};
      const present = others.filter((id) => isSeatPresent(presence[id]));
      hostSeat = chooseNewHost(present.length > 0 ? present : others, { random });
      values[paths.hostSeat(roomCode)] = hostSeat;
    }
    return { values, result: { deletedRoom: false, hostSeat } };
  }

  /**
   * Leaves the room between matches. First stops this database instance's startPresence() and
   * watchHost() for the room (their onDisconnect handlers are cancelled while the caller is still
   * a member), then frees the seat in one atomic update. The host hands the role to another seat
   * (a present one if any) in the same update; the last seated player deletes the whole room.
   * A write refused because the room changed meanwhile is retried from a fresh read, up to 3
   * attempts in total.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<{ deletedRoom: boolean, hostSeat: string | null }>} `hostSeat`: the new host
   *   seat, or null if the host did not change or the room was deleted
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_IN_LOBBY (a match is
   *   running), NOT_MEMBER (no seat in this room), WRITE_DENIED (still refused after 3 attempts)
   */
  async function leaveRoom({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    await readRoomState(roomCode, uid);
    await stopLiveFor(roomCode);

    let lastError = null;
    for (let attempt = 1; attempt <= LEAVE_ATTEMPTS; attempt += 1) {
      const { meta, seatId } = await readRoomState(roomCode, uid);
      const { values, result } = await planLeave(roomCode, uid, meta, seatId);
      try {
        await writeAll(values);
        return result;
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        lastError = error;
      }
    }
    throw new RoomError(
      ROOM_ERR.WRITE_DENIED,
      `leaving room ${roomCode} was refused ${LEAVE_ATTEMPTS} times (the room kept changing)`,
      lastError,
    );
  }

  return leaveRoom;
}
