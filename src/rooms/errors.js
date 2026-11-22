// Stable English error codes of the room layer (like the engine's ERR, no display strings).

export const ROOM_ERR = Object.freeze({
  INVALID_DEPENDENCIES: 'INVALID_DEPENDENCIES',
  INVALID_UID: 'INVALID_UID',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_CODE: 'INVALID_CODE',
  INVALID_VISIBILITY: 'INVALID_VISIBILITY',
  INVALID_MODE: 'INVALID_MODE',
  INVALID_PIN: 'INVALID_PIN',
  INVALID_SEAT: 'INVALID_SEAT',
  INVALID_SEAT_ORDER: 'INVALID_SEAT_ORDER',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  SEAT_EMPTY: 'SEAT_EMPTY',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  RETRY_LATER: 'RETRY_LATER',
  WRONG_PIN: 'WRONG_PIN',
  NOT_MEMBER: 'NOT_MEMBER',
  NOT_IN_LOBBY: 'NOT_IN_LOBBY',
  NAME_TAKEN: 'NAME_TAKEN',
  SEAT_LOST: 'SEAT_LOST',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',
  INVALID_ACTION: 'INVALID_ACTION',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  NO_MATCH: 'NO_MATCH',
  PLAYER_NOT_ALIVE: 'PLAYER_NOT_ALIVE',
  SEAT_PRESENT: 'SEAT_PRESENT',
  CODE_GENERATION_FAILED: 'CODE_GENERATION_FAILED',
  WRITE_DENIED: 'WRITE_DENIED',
});

export class RoomError extends Error {
  /**
   * @param {string} code one of ROOM_ERR
   * @param {string} [message]
   * @param {unknown} [cause] the underlying database error, if any
   */
  constructor(code, message, cause) {
    super(message || code, cause === undefined ? undefined : { cause });
    this.name = 'RoomError';
    this.code = code;
  }
}

// The database rejects a write the security rules deny with a PERMISSION_DENIED error.
export function isPermissionDenied(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toUpperCase();
  return text.includes('PERMISSION_DENIED') || text.includes('PERMISSION DENIED');
}
