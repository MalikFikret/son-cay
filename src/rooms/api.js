// Room creation, joining and seat recovery on top of the Firebase Realtime Database.
//
// This module never imports Firebase. The caller injects the database functions
// (dependency injection): the browser passes the functions of the SDK loaded from the
// official CDN, the tests pass the ones of the npm `firebase` package. It also never signs in:
// the caller passes the uid of the (anonymous) user the database instance is signed in as.
//
// The security rules in database.rules.json are the real guard; the checks here only give
// clear error codes before a write that the rules would refuse anyway.
//
// A seat belongs to the player, not the device. Each player picks a 4-digit PIN when taking a
// seat; it is stored in secrets/{seatId}, which nobody can read. A player on a new device gets
// the same seat back with recoverSeat: first a claim (claims/{seatId} = { uid, pin, at }),
// throttled by the rules to one per seat every 2 seconds, then the transfer, which the rules
// allow only if the claim is this user's and its PIN equals the secret.

import { defaultConfig } from '../engine/index.js';
import { generateRoomCode, normalizeRoomCode } from './code.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { createPresenceFunctions } from './presence.js';
import { createLeaveFunction } from './leave.js';
import { createManageFunctions } from './manage.js';
import { createSettingsFunctions } from './settings.js';
import { createLobbyFunctions } from './lobby.js';
import { createSeatOrderFunctions } from './seat-order.js';
import { createMatchFunctions } from './match.js';
import { createTrafficCounter } from './match-helpers.js';
import {
  HOST_SEAT,
  LOBBY_STATUS,
  PLAYING_STATUS,
  ROOM_MODES,
  SEAT_IDS,
  VISIBILITIES,
  isSeatId,
  isValidPin,
  isValidUid,
  nameKey,
  normalizeName,
  paths,
  toDbValue,
} from './schema.js';

const DEFAULT_MAX_CODE_ATTEMPTS = 10;

/**
 * @typedef {object} RoomApiDeps
 * @property {unknown} db                       a modular `Database` instance (getDatabase())
 * @property {(db: unknown, path?: string) => unknown} ref       firebase/database `ref`
 * @property {(ref: unknown) => Promise<{ val(): unknown }>} get  firebase/database `get`
 * @property {(ref: unknown, values: object) => Promise<void>} update  firebase/database `update`
 * @property {() => object} serverTimestamp     firebase/database `serverTimestamp`
 * @property {Function} [onValue]               firebase/database `onValue` (presence and host only)
 * @property {Function} [onDisconnect]          firebase/database `onDisconnect` (startPresence only)
 * @property {Function} [runTransaction]        firebase/database `runTransaction` (submitAction only)
 * @property {() => number} [randomSeed]        32-bit match seed source (default: crypto.getRandomValues)
 *   now / random / setTimeout / clearTimeout are also used by runMatchClock
 * @property {() => string} [generateCode]      room code source (default: generateRoomCode)
 * @property {number} [maxCodeAttempts]         codes to try before CODE_GENERATION_FAILED (default 10)
 * @property {() => string} [newConnId]         presence connection id source (default: random)
 * @property {() => number} [now]               local clock in ms (default Date.now)
 * @property {() => number} [random]            [0, 1) source for host choice and jitter (default Math.random)
 * @property {Function} [setTimeout]            timer functions for watchHost (default: global ones)
 * @property {Function} [clearTimeout]
 */

/**
 * Creates the room API bound to one database instance. The original five deps are enough for
 * createRoom, joinRoom, listSeatNames, getRoomSummary, getMySeat, recoverSeat, leaveRoom, renameSeat, kickSeat, updateSettings, setSeatOrder, clearSeatOrder and getLastMatch; presence and host functions also need
 * onValue (and onDisconnect for startPresence) and throw INVALID_DEPENDENCIES without them.
 * @param {RoomApiDeps} deps
 */
export function createRoomApi(deps) {
  if (deps === null || typeof deps !== 'object') {
    throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'createRoomApi needs an object of database functions');
  }
  const { db, ref, get, update, serverTimestamp } = deps;
  for (const [key, fn] of Object.entries({ ref, get, update, serverTimestamp })) {
    if (typeof fn !== 'function') throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, `missing function: ${key}`);
  }
  if (db === undefined || db === null) throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'missing db');
  const generateCode = deps.generateCode ?? (() => generateRoomCode());
  const maxCodeAttempts = deps.maxCodeAttempts ?? DEFAULT_MAX_CODE_ATTEMPTS;
  if (typeof generateCode !== 'function' || !Number.isInteger(maxCodeAttempts) || maxCodeAttempts < 1) {
    throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'invalid generateCode or maxCodeAttempts');
  }

  async function read(path) {
    const snapshot = await get(ref(db, path));
    const value = snapshot.val();
    return value === undefined ? null : value;
  }

  // One atomic multi-path update from the database root: every path is checked by the
  // rules against the same resulting tree, and either all of them are written or none.
  function writeAll(values) {
    return update(ref(db), values);
  }

  function requireUid(uid) {
    if (!isValidUid(uid)) throw new RoomError(ROOM_ERR.INVALID_UID, 'uid must be the signed-in user id');
  }

  function requireCode(code) {
    const roomCode = normalizeRoomCode(code);
    if (roomCode === null) throw new RoomError(ROOM_ERR.INVALID_CODE, 'not a valid room code');
    return roomCode;
  }

  function requireName(name) {
    const trimmed = normalizeName(name);
    if (trimmed === null) throw new RoomError(ROOM_ERR.INVALID_NAME, 'name must be 1-20 characters after trimming');
    return trimmed;
  }

  function requireSeat(seatId) {
    if (!isSeatId(seatId)) throw new RoomError(ROOM_ERR.INVALID_SEAT, 'seatId must be one of s01..s15');
  }

  function requirePin(pin) {
    if (!isValidPin(pin)) throw new RoomError(ROOM_ERR.INVALID_PIN, 'pin must be a string of exactly 4 digits');
  }

  async function requireRoom(code) {
    if ((await read(paths.meta(code))) === null) {
      throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${code}`);
    }
  }

  // The seat, members entry, secret and names entry of a newly taken seat, written in one update.
  // A seat taken while a match runs is a waiting seat (waiting: true) until the next startMatch.
  function seatTakeValues(code, seatId, uid, name, pin, waiting = false) {
    const seat = { uid, name, joinedAt: serverTimestamp() };
    if (waiting) seat.waiting = true;
    return {
      [paths.seat(code, seatId)]: seat,
      [paths.member(code, uid)]: seatId,
      [paths.secret(code, seatId)]: pin,
      [paths.name(code, nameKey(name))]: seatId,
    };
  }

  // True if another seat already holds this name (any case) in the room.
  async function nameTaken(code, name, ownSeatId = null) {
    const holder = await read(paths.name(code, nameKey(name)));
    return holder !== null && holder !== ownSeatId;
  }

  // The seat this uid really holds, or null. A members entry whose seat now belongs to another
  // uid (the seat was recovered on another device) is stale and does not count. Only a real
  // member may read seats/{seatId}/uid, so a refused read means the entry is stale.
  async function currentSeat(code, uid) {
    const seatId = await read(paths.member(code, uid));
    if (!isSeatId(seatId)) return null;
    try {
      return (await read(paths.seatUid(code, seatId))) === uid ? seatId : null;
    } catch (error) {
      if (isPermissionDenied(error)) return null;
      throw error;
    }
  }

  /**
   * Creates a new room in the lobby state. The creator takes seat s01 and is the host.
   * Settings are the engine's default config for the mode.
   * @param {{ uid: string, name: string, pin: string, visibility: 'public' | 'private', mode: 'classic' | 'custom' }} input
   *   `pin`: the creator's personal seat PIN, exactly 4 digits as a string
   * @returns {Promise<{ code: string, seatId: 's01' }>}
   * @throws {RoomError} INVALID_UID, INVALID_NAME, INVALID_PIN, INVALID_VISIBILITY, INVALID_MODE,
   *   CODE_GENERATION_FAILED (every generated code was taken), WRITE_DENIED
   */
  async function createRoom({ uid, name, pin, visibility, mode } = {}) {
    requireUid(uid);
    const playerName = requireName(name);
    requirePin(pin);
    if (!VISIBILITIES.includes(visibility)) {
      throw new RoomError(ROOM_ERR.INVALID_VISIBILITY, `visibility must be one of: ${VISIBILITIES.join(', ')}`);
    }
    if (!ROOM_MODES.includes(mode)) {
      throw new RoomError(ROOM_ERR.INVALID_MODE, `mode must be one of: ${ROOM_MODES.join(', ')}`);
    }

    for (let attempt = 0; attempt < maxCodeAttempts; attempt += 1) {
      const code = generateCode();
      if (normalizeRoomCode(code) !== code) {
        throw new RoomError(ROOM_ERR.INVALID_CODE, `generated code is not a valid room code: ${String(code)}`);
      }
      if ((await read(paths.meta(code))) !== null) continue; // taken: try another code

      try {
        await writeAll({
          [paths.meta(code)]: {
            visibility,
            mode,
            status: LOBBY_STATUS,
            hostSeat: HOST_SEAT,
            createdAt: serverTimestamp(),
          },
          [paths.settings(code)]: toDbValue(defaultConfig(mode)),
          ...seatTakeValues(code, HOST_SEAT, uid, playerName, pin),
        });
        return { code, seatId: HOST_SEAT };
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        // Someone created a room with this code between the check and the write.
        if ((await read(paths.meta(code))) !== null) continue;
        throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused to create the room', error);
      }
    }
    throw new RoomError(
      ROOM_ERR.CODE_GENERATION_FAILED,
      `no free room code found in ${maxCodeAttempts} attempts`,
    );
  }

  /**
   * Joins an existing room, taking the first free seat in the order s01..s15.
   * A user who is already a member gets their existing seat back and nothing is written (the
   * pin is then ignored, but must still be well-formed). A stale members entry (the seat was
   * recovered on another device) counts as not a member: a new free seat is taken.
   * @param {{ uid: string, code: string, name: string, pin: string }} input
   *   `code` may be typed in lower case or with surrounding spaces;
   *   `pin`: the player's personal seat PIN, exactly 4 digits as a string
   * A seat taken while a match is running is a waiting seat (waiting: true, decision Q18): the
   * player watches as a spectator and plays from the next match on. A member still gets their
   * own seat back (also during a match), never a waiting one.
   * @returns {Promise<{ seatId: string, waiting?: true }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_NAME, INVALID_PIN, ROOM_NOT_FOUND
   *   (also when the room was deleted while trying seats), NAME_TAKEN (another seat has this
   *   name, compared case-insensitively; also when another device took it while joining),
   *   ROOM_FULL
   */
  async function joinRoom({ uid, code, name, pin } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const playerName = requireName(name);
    requirePin(pin);
    await requireRoom(roomCode);

    const existing = await currentSeat(roomCode, uid);
    if (existing !== null) return { seatId: existing };
    let waiting = (await read(paths.metaStatus(roomCode))) === PLAYING_STATUS;
    if (await nameTaken(roomCode, playerName)) {
      throw new RoomError(ROOM_ERR.NAME_TAKEN, `the name is already used in room ${roomCode}`);
    }

    // A non-member cannot read who sits where, so try each seat: the rules refuse a seat that
    // is taken, and seat, members entry, secret and names entry are written in one atomic
    // update, so two players can never end up on the same seat or with the same name.
    // The rules require waiting: true exactly while a match runs.
    for (let i = 0; i < SEAT_IDS.length; i += 1) {
      const seatId = SEAT_IDS[i];
      try {
        await writeAll(seatTakeValues(roomCode, seatId, uid, playerName, pin, waiting));
        return waiting ? { seatId, waiting: true } : { seatId };
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        // Refused because another device took the name meanwhile, not because of the seat.
        if (await nameTaken(roomCode, playerName)) {
          throw new RoomError(ROOM_ERR.NAME_TAKEN, `the name is already used in room ${roomCode}`, error);
        }
        // A match started or ended meanwhile: try the same seat again with the right flag.
        const nowWaiting = (await read(paths.metaStatus(roomCode))) === PLAYING_STATUS;
        if (nowWaiting !== waiting) {
          waiting = nowWaiting;
          i -= 1;
        }
      }
    }

    // The same user may have joined from another device while we were trying seats.
    const late = await currentSeat(roomCode, uid);
    if (late !== null) return { seatId: late };
    // The last player may have deleted the room while we were trying seats.
    await requireRoom(roomCode);
    throw new RoomError(ROOM_ERR.ROOM_FULL, `room ${roomCode} has no free seat`);
  }

  /**
   * Lists the names of the occupied seats, in seat order, for any signed-in user (a returning
   * player picks their own name before entering their PIN). Only names are readable to
   * non-members; who holds a seat (uid) stays hidden.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<Array<{ seatId: string, name: string }>>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND
   */
  async function listSeatNames({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    await requireRoom(roomCode);
    return seatNamesOf(roomCode);
  }

  async function seatNamesOf(roomCode) {
    const names = await Promise.all(SEAT_IDS.map((seatId) => read(paths.seatName(roomCode, seatId))));
    const seats = [];
    SEAT_IDS.forEach((seatId, i) => {
      if (typeof names[i] === 'string') seats.push({ seatId, name: names[i] });
    });
    return seats;
  }

  /**
   * What any signed-in visitor may see of a room before sitting down: its mode, whether a
   * match is running, the host seat and the seated names (no uids). Reads only meta and
   * seats/{seatId}/name, which every signed-in user can read.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<{ code: string, mode: string, status: string, hostSeat: string,
   *   seats: Array<{ seatId: string, name: string }> }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND
   */
  async function getRoomSummary({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    const seats = await seatNamesOf(roomCode);
    return { code: roomCode, mode: meta.mode, status: meta.status, hostSeat: meta.hostSeat, seats };
  }

  /**
   * The seat this user really holds in the room, or null when they hold none: no room with this
   * code (any more), no members entry, or a stale one (the seat was recovered on another device
   * or kicked). Used when a page is reloaded to decide whether to go back to the table.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<{ seatId: string, name: string, waiting: boolean, status: string,
   *   hostSeat: string } | null>}  waiting: the seat was taken during a match and plays from
   *   the next one
   * @throws {RoomError} INVALID_UID, INVALID_CODE
   */
  async function getMySeat({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const meta = await read(paths.meta(roomCode));
    if (meta === null) return null;
    const seatId = await currentSeat(roomCode, uid);
    if (seatId === null) return null;
    let seat;
    try {
      seat = await read(paths.seat(roomCode, seatId));
    } catch (error) {
      // The seat was lost between the two reads.
      if (isPermissionDenied(error)) return null;
      throw error;
    }
    if (seat === null || seat.uid !== uid) return null;
    return { seatId, name: seat.name, waiting: seat.waiting === true, status: meta.status, hostSeat: meta.hostSeat };
  }

  /**
   * Gets a seat back on this device with the seat's PIN. The seat keeps its id, name and
   * joinedAt (and stays the host seat if it is meta.hostSeat); the device that held it before
   * loses its membership.
   * @param {{ uid: string, code: string, seatId: string, pin: string }} input
   * @returns {Promise<{ seatId: string }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT, INVALID_PIN, ROOM_NOT_FOUND,
   *   ALREADY_MEMBER (this uid holds another seat in the room), SEAT_EMPTY,
   *   RETRY_LATER (the claim was refused: another attempt on this seat less than 2 s ago),
   *   WRONG_PIN (the transfer was refused)
   * After the transfer, the seat's old presence connections are cleared (the old device can
   * no longer clear them) and lastSeenAt is stamped.
   */
  async function recoverSeat({ uid, code, seatId, pin } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    requirePin(pin);
    await requireRoom(roomCode);

    const existing = await currentSeat(roomCode, uid);
    if (existing === seatId) return { seatId };
    if (existing !== null) {
      // Taking a second seat would leave the first one without a device.
      throw new RoomError(ROOM_ERR.ALREADY_MEMBER, `this user already holds ${existing} in room ${roomCode}`);
    }
    if ((await read(paths.seatName(roomCode, seatId))) === null) {
      throw new RoomError(ROOM_ERR.SEAT_EMPTY, `seat ${seatId} is empty`);
    }

    // Write 1: the claim. The rules allow one claim per seat every 2 seconds (server time).
    try {
      await writeAll({ [paths.claim(roomCode, seatId)]: { uid, pin, at: serverTimestamp() } });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      throw new RoomError(ROOM_ERR.RETRY_LATER, `another attempt on ${seatId} was made too recently`, error);
    }

    // Write 2: the transfer. The rules compare the claimed PIN with the secret.
    try {
      await writeAll({
        [paths.seatUid(roomCode, seatId)]: uid,
        [paths.member(roomCode, uid)]: seatId,
      });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      throw new RoomError(ROOM_ERR.WRONG_PIN, `the PIN for ${seatId} did not match`, error);
    }

    // The old device's connections would keep the seat looking present, and it can no longer
    // remove them itself. The new owner clears them and stamps lastSeenAt (absent from now
    // until this device starts its own presence).
    try {
      await writeAll({
        [paths.presenceConns(roomCode, seatId)]: null,
        [paths.presenceSeen(roomCode, seatId)]: serverTimestamp(),
      });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
    }
    return { seatId };
  }

  const { stopLiveFor, ...presenceFunctions } = createPresenceFunctions({
    deps,
    db,
    ref,
    read,
    writeAll,
    serverTimestamp,
    requireUid,
    requireCode,
    requireSeat,
    requireRoom,
  });

  const { renameSeat, kickSeat } = createManageFunctions({
    read,
    writeAll,
    requireUid,
    requireCode,
    requireSeat,
    requireName,
    currentSeat,
    nameTaken,
  });

  const { updateSettings } = createSettingsFunctions({ read, writeAll, requireUid, requireCode, currentSeat });
  const { watchLobby, getLastMatch } = createLobbyFunctions({ deps, db, ref, read, requireUid, requireCode, currentSeat });
  const { setSeatOrder, clearSeatOrder } = createSeatOrderFunctions({ read, writeAll, serverTimestamp, requireUid, requireCode, currentSeat });

  const traffic = createTrafficCounter();
  const matchFunctions = createMatchFunctions({
    deps,
    db,
    ref,
    read,
    writeAll,
    serverTimestamp,
    requireUid,
    requireCode,
    requireSeat,
    currentSeat,
    traffic,
  });

  const leaveRoom = createLeaveFunction({
    deps,
    read,
    writeAll,
    requireUid,
    requireCode,
    currentSeat,
    stopLiveFor,
  });

  return {
    createRoom,
    joinRoom,
    listSeatNames,
    getRoomSummary,
    getMySeat,
    recoverSeat,
    ...presenceFunctions,
    leaveRoom,
    renameSeat,
    kickSeat,
    updateSettings,
    watchLobby,
    getLastMatch,
    setSeatOrder,
    clearSeatOrder,
    ...matchFunctions,
  };
}
