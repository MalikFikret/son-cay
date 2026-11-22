// Pure helpers of the match layer (no database access): the player list of a new match, the
// match log, and the traffic counters.
//
// rooms/{CODE}/match = { n, seq, stateJson, log: { [seq]: eventsJson } }
// - n: the match number in this room (the first match is 1);
// - seq: the number of writes to this match (0 when it starts);
// - stateJson: the engine state as ONE JSON string (the Realtime Database drops empty arrays and
//   nulls, which the engine state contains);
// - log/{seq}: the engine events produced by that write, as a JSON string (all of them, public
//   and private: each device filters them for its own seat with the engine's eventsFor);
// - clockAt: the server time the current countdown started.
//
// rooms/{CODE}/results/{n} = { scoreJson, joinedAt: { [seatId]: number } }: the result of match n.

import { DEFAULT_SCORING, addMatchToSession, createSession, eventsFor, listLegalActions, scoreMatch } from '../engine/index.js';
import { isSeatId } from './schema.js';

/**
 * The engine players of a new match: every seated seat (present or absent), sorted by seat id.
 * Player ids are seat ids.
 * @param {Record<string, unknown> | null} seats rooms/{CODE}/seats
 * @returns {Array<{ id: string }>}
 */
export function buildPlayers(seats) {
  if (seats === null || typeof seats !== 'object') return [];
  return Object.keys(seats)
    .filter((seatId) => isSeatId(seatId) && seats[seatId] !== null && typeof seats[seatId] === 'object')
    .sort()
    .map((id) => ({ id }));
}

/**
 * The log entries in seq order. The database returns the log as an object keyed by seq, or as
 * an array when the keys are 0..n; unreadable entries are skipped.
 * @param {unknown} log rooms/{CODE}/match/log
 * @returns {Array<{ seq: number, events: object[] }>}
 */
export function parseLog(log) {
  if (log === null || typeof log !== 'object') return [];
  const entries = [];
  for (const [key, value] of Object.entries(log)) {
    const seq = Number(key);
    if (!Number.isInteger(seq) || seq < 0 || String(seq) !== key || typeof value !== 'string') continue;
    let events;
    try {
      events = JSON.parse(value);
    } catch {
      continue;
    }
    if (Array.isArray(events)) entries.push({ seq, events });
  }
  return entries.sort((a, b) => a.seq - b.seq);
}

/**
 * The events of the entries after `afterSeq` (all entries for afterSeq = -1), in order, as seen
 * by `playerId` (public events plus the private events sent to that seat; null: public only).
 * @param {Array<{ seq: number, events: object[] }>} entries from parseLog
 * @param {number} afterSeq
 * @param {string | null} playerId
 * @returns {object[]}
 */
export function eventsSince(entries, afterSeq, playerId) {
  const out = [];
  for (const entry of entries) {
    if (entry.seq > afterSeq) out.push(...eventsFor(entry.events, playerId));
  }
  return out;
}

/**
 * The engine player id this seat plays as in a match state, or null if the seat is not a player
 * of this match (a member outside the match gets the spectator view).
 * @param {{ players: Array<{ id: string }> }} state
 * @param {string | null} seatId
 * @returns {string | null}
 */
export function playerIdIn(state, seatId) {
  if (seatId === null || !Array.isArray(state?.players)) return null;
  return state.players.some((p) => p.id === seatId) ? seatId : null;
}

// Actions only the layer sends (the clock, the host's removal), never offered to a player.
const SYSTEM_ACTIONS = ['timeout', 'removePlayer'];

/**
 * The legal actions of one seat right now (engine listLegalActions), for a UI to offer. Only
 * actions of that seat: none for a spectator (null) or for another seat, and no system actions.
 * @param {object} state the match state
 * @param {string | null} playerId the caller's player id in this match (playerIdIn)
 * @returns {object[]}
 */
export function legalActionsFor(state, playerId) {
  if (playerId === null || state?.status === 'ended') return [];
  return listLegalActions(state, playerId).filter((a) => a.playerId === playerId && !SYSTEM_ACTIONS.includes(a.type));
}

/** Approximate size of a value as sent or received: the length of its JSON text. */
export function jsonSize(value) {
  if (value === undefined) return 0;
  const text = JSON.stringify(value);
  return text === undefined ? 0 : text.length;
}

/**
 * Traffic counters for the match layer. They are APPROXIMATIONS: they count the JSON length of
 * what startMatch / submitAction hand to the database and of the snapshots watchMatch receives,
 * not the bytes on the wire (no protocol framing, compression, retransmissions or other
 * listeners).
 */
export function createTrafficCounter() {
  let written = 0;
  let received = 0;
  let writes = 0;
  let snapshots = 0;
  return {
    addWritten(value) {
      written += jsonSize(value);
      writes += 1;
    },
    addReceived(value) {
      received += jsonSize(value);
      snapshots += 1;
    },
    /** @returns {{ bytesWritten: number, bytesReceived: number, writes: number, snapshots: number }} */
    stats() {
      return { bytesWritten: written, bytesReceived: received, writes, snapshots };
    },
    reset() {
      written = 0;
      received = 0;
      writes = 0;
      snapshots = 0;
    },
  };
}

/**
 * The readable match results in match order: { n, score (scoreMatch output), joinedAt }.
 * Unreadable entries are skipped.
 * @param {unknown} results rooms/{CODE}/results (an object, or an array when the keys are 1..n)
 * @returns {Array<{ n: number, score: object, joinedAt: Record<string, number> }>}
 */
export function parseResults(results) {
  const entries = [];
  if (results === null || typeof results !== 'object') return entries;
  for (const [key, entry] of Object.entries(results)) {
    const n = Number(key);
    if (!Number.isInteger(n) || entry === null || typeof entry !== 'object' || typeof entry.scoreJson !== 'string') continue;
    let score;
    try {
      score = JSON.parse(entry.scoreJson);
    } catch {
      continue;
    }
    if (score === null || typeof score !== 'object' || score.players === null || typeof score.players !== 'object') continue;
    const joinedAt = entry.joinedAt !== null && typeof entry.joinedAt === 'object' ? entry.joinedAt : {};
    entries.push({ n, score, joinedAt });
  }
  return entries.sort((a, b) => a.n - b.n);
}

/** True if the result's recorded joinedAt of `seatId` is the seat's current one (same person). */
function samePerson(joinedAt, seats, seatId) {
  const seat = seats?.[seatId];
  return seat !== null && typeof seat === 'object' && typeof seat.joinedAt === 'number' && joinedAt[seatId] === seat.joinedAt;
}

/**
 * Session points per seat, summed over the room's match results with the engine's session
 * helpers. Points belong to the person, not the seat: a result counts for a seat only if the
 * joinedAt recorded in that result equals the seat's current joinedAt. A newcomer on a freed
 * seat starts at 0; a player who recovered their seat (same joinedAt) keeps their points.
 * @param {unknown} results rooms/{CODE}/results: { [n]: { scoreJson, joinedAt: { [seatId]: number } } }
 *   (an object, or an array when the keys are 1..n)
 * @param {Record<string, { joinedAt?: number }> | null} seats rooms/{CODE}/seats (current)
 * @returns {Record<string, number>} every current seat, 0 if it has no points
 */
export function computeSessionScores(results, seats) {
  const current = seats !== null && typeof seats === 'object' ? seats : {};
  const entries = parseResults(results);

  let session = createSession();
  for (const { score, joinedAt } of entries) {
    const players = {};
    for (const [seatId, row] of Object.entries(score.players)) {
      const seat = current[seatId];
      if (seat && typeof seat === 'object' && typeof seat.joinedAt === 'number' && joinedAt[seatId] === seat.joinedAt) {
        players[seatId] = row;
      }
    }
    session = addMatchToSession(session, { players });
  }
  const out = {};
  for (const seatId of Object.keys(current).filter(isSeatId).sort()) out[seatId] = session.totals[seatId] ?? 0;
  return out;
}

/**
 * The result entry of an ended match: its score (scoreMatch of all its log events with the
 * default scoring) as a JSON string, and each player's seat joinedAt at the time of the match.
 * @param {{ players: Array<{ id: string }> }} state the ended match state
 * @param {unknown} log rooms/{CODE}/match/log
 * @param {Record<string, { joinedAt?: number }> | null} seats
 * @returns {{ scoreJson: string, joinedAt: Record<string, number> }}
 */
export function buildResult(state, log, seats) {
  const events = parseLog(log).flatMap((entry) => entry.events);
  const score = scoreMatch(events, DEFAULT_SCORING);
  const joinedAt = {};
  for (const p of state.players) {
    const seat = seats?.[p.id];
    if (seat && typeof seat.joinedAt === 'number') joinedAt[p.id] = seat.joinedAt;
  }
  return { scoreJson: JSON.stringify(score), joinedAt };
}

/**
 * The session table of the waiting room's Tablo ("Oturum"): one row per current seat, ranked by
 * session points (ties: more wins, then seat id). As computeSessionScores, a result counts for a
 * seat only if it was the same person (same joinedAt).
 * @param {unknown} results rooms/{CODE}/results
 * @param {Record<string, { joinedAt?: number }> | null} seats rooms/{CODE}/seats (current)
 * @returns {{ matches: number, rows: Array<{ seatId: string, points: number, matches: number,
 *   wins: number, last: number | null }> }}  matches: results in the room; row.matches: matches
 *   this person played; last: what the room's latest match added (null if they did not play it)
 */
export function computeSessionTable(results, seats) {
  const current = seats !== null && typeof seats === 'object' ? seats : {};
  const entries = parseResults(results);
  const latest = entries.at(-1) ?? null;
  const rows = Object.keys(current)
    .filter((seatId) => isSeatId(seatId) && current[seatId] !== null && typeof current[seatId] === 'object')
    .map((seatId) => {
      let points = 0;
      let matches = 0;
      let wins = 0;
      for (const { score, joinedAt } of entries) {
        const row = score.players[seatId];
        if (!row || !samePerson(joinedAt, current, seatId)) continue;
        matches += 1;
        points += Number.isFinite(row.total) ? row.total : 0;
        if (score.result === 'win' && score.winner === seatId) wins += 1;
      }
      const lastRow = latest?.score.players[seatId];
      const last = lastRow && samePerson(latest.joinedAt, current, seatId) && Number.isFinite(lastRow.total) ? lastRow.total : null;
      return { seatId, points, matches, wins, last };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins || (a.seatId < b.seatId ? -1 : 1));
  return { matches: entries.length, rows };
}

/**
 * The host's saved seating order, or null (random order). Accepts what the database returns
 * (seats as an array, or an object keyed by index when there are gaps).
 * @param {unknown} raw rooms/{CODE}/seatOrder
 * @returns {{ seats: string[], savedAt: number } | null}
 */
export function normalizeSeatOrder(raw) {
  if (raw === null || typeof raw !== 'object' || typeof raw.savedAt !== 'number') return null;
  const list = raw.seats;
  if (list === null || typeof list !== 'object') return null;
  const ordered = Array.isArray(list)
    ? list
    : Object.keys(list)
      .filter((key) => /^([0-9]|1[0-4])$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => list[key]);
  const seen = new Set();
  const seatIds = [];
  for (const seatId of ordered) {
    if (!isSeatId(seatId) || seen.has(seatId)) continue;
    seen.add(seatId);
    seatIds.push(seatId);
  }
  return seatIds.length === 0 ? null : { seats: seatIds, savedAt: raw.savedAt };
}

/**
 * The seated seats in playing order. With a saved order: the listed seats that are still taken
 * by someone who sat down before it was saved, in its order, then every other seated seat
 * (newcomers, seats missing from the list) in seat-id order. Without one: seat-id order.
 * @param {Record<string, { joinedAt?: number }> | null} seats rooms/{CODE}/seats
 * @param {unknown} seatOrder rooms/{CODE}/seatOrder (raw or normalized)
 * @returns {{ seatIds: string[], manual: boolean }}  manual: a saved order exists
 */
export function orderSeats(seats, seatOrder) {
  const seated = buildPlayers(seats).map((p) => p.id);
  const order = normalizeSeatOrder(seatOrder);
  if (order === null) return { seatIds: seated, manual: false };
  const placed = order.seats.filter((seatId) => {
    if (!seated.includes(seatId)) return false;
    const joinedAt = seats[seatId].joinedAt;
    return typeof joinedAt !== 'number' || joinedAt <= order.savedAt;
  });
  const rest = seated.filter((seatId) => !placed.includes(seatId));
  return { seatIds: [...placed, ...rest], manual: true };
}
