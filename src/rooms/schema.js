// Shape of a room in the Realtime Database, shared by the client module and its tests.
//
// rooms/{CODE}/
//   meta:     { visibility, mode, status: "lobby" | "playing", hostSeat: "s01", createdAt: <server time> }
//   settings: the engine's default config for the mode (stored without null fields)
//   seats/{seatId}:  { uid, name, joinedAt: <server time>, waiting?: true }   waiting: taken during
//                      a match; a spectator until the next startMatch clears it
//   members/{uid}:   seatId
//   secrets/{seatId}: "1234"   the seat's 4-digit PIN, readable by nobody
//   claims/{seatId}:  { uid, pin, at: <server time> }   latest recovery attempt, readable by nobody
//   presence/{seatId}: { conns: { [connId]: true }, lastSeenAt: <server time> }   members read;
//                      present <=> conns has a child; written only by the seat's own member
//   names/{key}:      seatId   unique-name index, key = the seat's name in lower case; readable
//                      by any signed-in user. A seat's name exists only if names/{its key} is that
//                      seat, an entry exists only for a seat whose name has that key, and an entry
//                      is never overwritten with another seat: names are unique per room,
//                      case-insensitive. Written / deleted in the same update as the seat or name.
//
// A user is a member only if members/{uid} exists AND seats/{that seat}/uid is that uid. After a
// recovery moves a seat to a new device, the old device's members entry is stale and grants
// nothing. A kicked seat is deleted together with its members entries.
//
//   match:    { n, seq, stateJson, log: { [seq]: eventsJson }, clockAt }   members read; see match-helpers.js
//   results/{n}: { scoreJson, joinedAt: { [seatId]: number } }   write-once result of match n, members read
//   seatOrder: { seats: [seatId, ...], savedAt: <server time> }   the host's manual seating order
//              (absent = random); written only by the current host between matches, members read
//
// Seat ids are exactly s01..s15. The fixed set enforces the player limit, because security
// rules cannot count children. Later steps add more children of rooms/{CODE} (waiting
// flag, ...) next to these ones.

import { MAX_PLAYERS, MODES } from '../engine/index.js';

export const VISIBILITIES = Object.freeze(['public', 'private']);
export const ROOM_MODES = MODES;
export const HOST_SEAT = 's01';
export const LOBBY_STATUS = 'lobby';
export const PLAYING_STATUS = 'playing';

/** Seat ids in join order: s01, s02, ..., s15. */
export const SEAT_IDS = Object.freeze(
  Array.from({ length: MAX_PLAYERS }, (_, i) => `s${String(i + 1).padStart(2, '0')}`),
);

export const NAME_MIN = 1;
export const NAME_MAX = 20;

// Firebase anonymous uids are short alphanumeric strings. The uid is also used as a database
// key, so characters that are illegal in keys or would change the path are refused.
const UID_PATTERN = /^[^.#$[\]/\s]{1,128}$/;

// A seat PIN is exactly 4 ASCII digits, as a string. Weak PINs (0000, 1234) are allowed on
// purpose. No trimming: " 1234" is not a PIN.
const PIN_PATTERN = /^[0-9]{4}$/;

/**
 * @param {unknown} pin
 * @returns {boolean} true if `pin` is a string of exactly 4 digits 0-9
 */
export function isValidPin(pin) {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

export function isValidUid(uid) {
  return typeof uid === 'string' && UID_PATTERN.test(uid);
}

export function isSeatId(seatId) {
  return typeof seatId === 'string' && SEAT_IDS.includes(seatId);
}

// Characters that are illegal in database keys: a name is also a key in names/, so they are
// refused in names (the rules refuse them too).
const NAME_FORBIDDEN = /[.$#[\]/]/;

/**
 * Trims a display name and checks the same limits as the security rules
 * (1-20 characters after trimming; length counted in UTF-16 units, as the rules do; none of
 * . $ # [ ] / ; no control characters).
 * @param {unknown} name
 * @returns {string | null} the trimmed name, or null if it is not allowed
 */
export function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) return null;
  // The rules refuse line breaks and other control characters anywhere in a name.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (NAME_FORBIDDEN.test(trimmed)) return null;
  return trimmed;
}

/**
 * The key of a (normalized) name in names/: the name in lower case. The rules compute the same
 * key with their own toLowerCase(); an emulator test checks that both agree for Turkish, Arabic,
 * accented Latin and emoji names.
 * @param {string} name a name returned by normalizeName
 * @returns {string}
 */
export function nameKey(name) {
  return name.toLowerCase();
}

// The Realtime Database does not store null: a null field is simply absent. Settings are
// written without null fields so that what is read back equals what was written.
export function toDbValue(value) {
  if (Array.isArray(value)) return value.map(toDbValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && item !== undefined) out[key] = toDbValue(item);
    }
    return out;
  }
  return value;
}

export const paths = Object.freeze({
  room: (code) => `rooms/${code}`,
  meta: (code) => `rooms/${code}/meta`,
  settings: (code) => `rooms/${code}/settings`,
  seats: (code) => `rooms/${code}/seats`,
  seat: (code, seatId) => `rooms/${code}/seats/${seatId}`,
  seatName: (code, seatId) => `rooms/${code}/seats/${seatId}/name`,
  seatUid: (code, seatId) => `rooms/${code}/seats/${seatId}/uid`,
  seatJoinedAt: (code, seatId) => `rooms/${code}/seats/${seatId}/joinedAt`,
  seatWaiting: (code, seatId) => `rooms/${code}/seats/${seatId}/waiting`,
  hostSeat: (code) => `rooms/${code}/meta/hostSeat`,
  metaStatus: (code) => `rooms/${code}/meta/status`,
  match: (code) => `rooms/${code}/match`,
  matchN: (code) => `rooms/${code}/match/n`,
  results: (code) => `rooms/${code}/results`,
  seatOrder: (code) => `rooms/${code}/seatOrder`,
  result: (code, n) => `rooms/${code}/results/${n}`,
  presence: (code) => `rooms/${code}/presence`,
  presenceSeat: (code, seatId) => `rooms/${code}/presence/${seatId}`,
  presenceConns: (code, seatId) => `rooms/${code}/presence/${seatId}/conns`,
  presenceConn: (code, seatId, connId) => `rooms/${code}/presence/${seatId}/conns/${connId}`,
  presenceSeen: (code, seatId) => `rooms/${code}/presence/${seatId}/lastSeenAt`,
  pressAll: (code) => `rooms/${code}/press`,
  press: (code, seatId) => `rooms/${code}/press/${seatId}`,
  members: (code) => `rooms/${code}/members`,
  member: (code, uid) => `rooms/${code}/members/${uid}`,
  secret: (code, seatId) => `rooms/${code}/secrets/${seatId}`,
  claim: (code, seatId) => `rooms/${code}/claims/${seatId}`,
  names: (code) => `rooms/${code}/names`,
  name: (code, key) => `rooms/${code}/names/${key}`,
});
