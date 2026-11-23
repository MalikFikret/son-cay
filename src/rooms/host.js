// Pure host rules of the room layer (no database access): who is present, when the host has
// been absent long enough to lose the role, and who becomes the new host.
// database.rules.json enforces the same 60-second threshold (tests/room-host.test.js checks it).

/** The host role moves after this many milliseconds of continuous absence (server time). */
export const HOST_ABSENCE_MS = 60000;

/**
 * A seat is present while its presence entry has at least one connection.
 * @param {unknown} entry presence/{seatId}: { conns?: { [connId]: true }, lastSeenAt?: number }
 * @returns {boolean}
 */
export function isSeatPresent(entry) {
  if (entry === null || typeof entry !== 'object') return false;
  const conns = entry.conns;
  return conns !== null && typeof conns === 'object' && Object.keys(conns).length > 0;
}

/**
 * When an absent seat went away: presence lastSeenAt, or the seat's joinedAt if it has never
 * been seen. Null if neither is a number.
 * @param {unknown} entry presence/{seatId}
 * @param {unknown} joinedAt seats/{seatId}/joinedAt
 * @returns {number | null}
 */
export function absentSince(entry, joinedAt) {
  const lastSeenAt = entry !== null && typeof entry === 'object' ? entry.lastSeenAt : undefined;
  if (typeof lastSeenAt === 'number') return lastSeenAt;
  return typeof joinedAt === 'number' ? joinedAt : null;
}

/**
 * True if the host seat is absent and has been for more than HOST_ABSENCE_MS at `serverNow`
 * (the same condition as the security rules: now > absentSince + 60000).
 * @param {unknown} entry presence/{hostSeat}
 * @param {unknown} joinedAt seats/{hostSeat}/joinedAt
 * @param {number} serverNow current server time in milliseconds
 * @returns {boolean}
 */
export function isHostAbsentLongEnough(entry, joinedAt, serverNow) {
  if (isSeatPresent(entry)) return false;
  const since = absentSince(entry, joinedAt);
  return since !== null && serverNow > since + HOST_ABSENCE_MS;
}

/**
 * True if every seat other than `mySeat` is absent (no connection), e.g. so the host may close
 * the room during a match (decision Q67). Seats are the room's seats object (seatId -> seat);
 * waiting and eliminated seats count too: closing the room removes everyone in it. With no other
 * seat the answer is true.
 * @param {unknown} seats seats/ of the room
 * @param {unknown} presence presence/ of the room
 * @param {string} mySeat
 * @returns {boolean}
 */
export function othersAbsent(seats, presence, mySeat) {
  if (seats === null || typeof seats !== 'object') return true;
  const entries = presence !== null && typeof presence === 'object' ? presence : {};
  return Object.keys(seats).every((seatId) => {
    if (seatId === mySeat || seats[seatId] === null || seats[seatId] === undefined) return true;
    return !isSeatPresent(Object.prototype.hasOwnProperty.call(entries, seatId) ? entries[seatId] : null);
  });
}

/**
 * Picks the new host among candidate seats. Without scores the choice is uniformly random.
 * With scores (seatId -> number) the highest score wins and ties are broken uniformly at
 * random; a candidate without a numeric score ranks below every scored one.
 * @param {string[]} candidateSeatIds
 * @param {{ scores?: Record<string, number>, random?: () => number }} [options]
 *   `random` returns a number in [0, 1) (default Math.random; injectable for tests)
 * @returns {string | null} the chosen seat, or null for an empty list
 */
export function chooseNewHost(candidateSeatIds, { scores, random = Math.random } = {}) {
  if (!Array.isArray(candidateSeatIds) || candidateSeatIds.length === 0) return null;
  let pool = [...candidateSeatIds];
  if (scores !== undefined && scores !== null) {
    const scoreOf = (seatId) => {
      const value = Object.prototype.hasOwnProperty.call(scores, seatId) ? scores[seatId] : undefined;
      return typeof value === 'number' && Number.isFinite(value) ? value : -Infinity;
    };
    const best = Math.max(...pool.map(scoreOf));
    pool = pool.filter((seatId) => scoreOf(seatId) === best);
  }
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}
