// Matches on top of the Realtime Database: start a match, submit engine actions through a
// transaction, and watch the match as one seat sees it.
//
// rooms/{CODE}/match = { n, seq, stateJson, log: { [seq]: eventsJson }, clockAt } and
// rooms/{CODE}/results/{n} = { scoreJson, joinedAt } (see match-helpers.js).
// meta.status is 'lobby' between matches and 'playing' while a match runs. When a committed state
// has ended, one update writes results/{n} and sets the status back to 'lobby'; the match node
// stays (the UI shows the final state) until the next startMatch replaces it.
//
// The security rules cannot see the action inside stateJson. So the checks on system actions
// (only the layer sends timeouts; only the host removes a player, only an absent one) live in
// this layer only; a modified client could bypass them.
//
// Each device runs the pure engine itself: it parses stateJson, applies its own action and writes
// the next state. The engine player ids are seat ids, and this module always acts as the caller's
// own seat. The raw state, the raw log and stateJson never leave this module: callers only get
// viewFor(state, mySeat) and the events eventsFor lets that seat see. (The security rules let
// every member read the match node; hiding the other seats' secrets from a modified client is
// not part of this step.)
//
// Like the rest of src/rooms, this module never imports Firebase: the functions come in deps.

import { MAX_PLAYERS, MIN_PLAYERS, applyAction, createMatch, eventsFor, validateConfig, viewFor } from '../engine/index.js';
import { createClockRunner } from './clock.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { isSeatPresent } from './host.js';
import {
  buildResult,
  computeSessionScores,
  eventsSince,
  legalActionsFor,
  orderSeats,
  parseLog,
  playerIdIn,
} from './match-helpers.js';
import { LOBBY_STATUS, PLAYING_STATUS, paths } from './schema.js';

// Only removeAbsentPlayer (host, absent seat) may send this one; submitAction refuses it.
const LAYER_ONLY = ['removePlayer'];
// A timeout for a countdown that already moved on: normal (another device was faster).
const STALE_TIMEOUT = 'STALE_TIMEOUT';
// Another device that sees an ended match without results writes them after 1-3 s.
const FINISH_DELAY_MS = 1000;
const FINISH_JITTER_MS = 2000;

function defaultRandomSeed() {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
}

function reporter(onError) {
  return (error) => {
    if (typeof onError !== 'function') return;
    try {
      onError(error);
    } catch {
      // An error callback must never break a listener.
    }
  };
}

/**
 * Builds the match functions of createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createMatchFunctions(ctx) {
  const { deps, db, ref, read, writeAll, serverTimestamp, requireUid, requireCode, requireSeat, currentSeat, traffic } = ctx;
  const randomSeed = typeof deps.randomSeed === 'function' ? deps.randomSeed : defaultRandomSeed;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const random = typeof deps.random === 'function' ? deps.random : Math.random;
  const setTimer = typeof deps.setTimeout === 'function' ? deps.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
  const clearTimer = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : (id) => globalThis.clearTimeout(id);

  // The newer database functions are checked only where they are used.
  function requireDeps(...names) {
    for (const name of names) {
      if (typeof deps[name] !== 'function') {
        throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, `missing function: ${name} (needed for matches)`);
      }
    }
  }

  async function readMeta(roomCode) {
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    return meta;
  }

  async function requireOwnSeat(roomCode, uid) {
    const seatId = await currentSeat(roomCode, uid);
    if (seatId === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    return seatId;
  }

  /**
   * The host starts a match between matches. The players are all seated seats (present or
   * absent, waiting ones included: decision Q37): in the host's saved order (seatOrder, then
   * randomizeSeats is off for this match), else sorted by seat id and shuffled by the engine
   * (if the settings say so). The settings are checked with the engine's validateConfig. One update sets meta.status to 'playing', writes
   * match = { n, seq: 0, stateJson, log: { 0 }, clockAt } and clears every waiting flag.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<{ n: number, players: string[] }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_IN_LOBBY (a match is
   *   running), NOT_MEMBER, WRITE_DENIED (not the host, or refused), NOT_ENOUGH_PLAYERS (fewer
   *   than 3 seats), INVALID_SETTINGS (validateConfig failed; `details` holds its errors)
   */
  async function startMatch({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const meta = await readMeta(roomCode);
    if (meta.status !== LOBBY_STATUS) throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a match is already running');
    const mySeat = await requireOwnSeat(roomCode, uid);
    if (meta.hostSeat !== mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can start a match');

    const seats = await read(paths.seats(roomCode));
    // A saved manual order (seatOrder) decides the seating; without one the engine shuffles.
    const { seatIds, manual } = orderSeats(seats, await read(paths.seatOrder(roomCode)));
    const players = seatIds.map((id) => ({ id }));
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new RoomError(ROOM_ERR.NOT_ENOUGH_PLAYERS, `a match needs ${MIN_PLAYERS} to ${MAX_PLAYERS} seated players`);
    }
    const checked = validateConfig((await read(paths.settings(roomCode))) ?? {});
    if (!checked.ok) {
      const error = new RoomError(ROOM_ERR.INVALID_SETTINGS, 'the room settings are not a valid match config');
      error.details = checked.errors;
      throw error;
    }
    const config = manual ? { ...checked.config, randomizeSeats: false } : checked.config;
    const created = createMatch(config, players, randomSeed());
    if (!created.ok) {
      const error = new RoomError(ROOM_ERR.INVALID_SETTINGS, `the engine refused to start: ${created.error.code}`);
      error.details = [created.error];
      throw error;
    }

    const previousN = await read(paths.matchN(roomCode));
    const n = typeof previousN === 'number' ? previousN + 1 : 1;
    const values = {
      [paths.metaStatus(roomCode)]: PLAYING_STATUS,
      [paths.match(roomCode)]: {
        n,
        seq: 0,
        stateJson: JSON.stringify(created.state),
        log: { 0: JSON.stringify(created.events) },
        // The first countdown starts now (server time).
        clockAt: serverTimestamp(),
      },
    };
    // Waiting seats (taken during the last match) play from now on: their flag goes.
    for (const p of players) {
      if (seats[p.id]?.waiting === true) values[paths.seatWaiting(roomCode, p.id)] = null;
    }
    traffic.addWritten(values);
    try {
      await writeAll(values);
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      const now = await read(paths.meta(roomCode));
      if (now !== null && now.status !== LOBBY_STATUS) {
        throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a match was started meanwhile', error);
      }
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused to start the match', error);
    }
    return { n, players: players.map((p) => p.id) };
  }

  // Applies one engine action to the match in a transaction. The update function may run several
  // times (each time on the latest value); the outcome returned is the one of the final attempt.
  // A new countdown (clock.seq changed) stamps clockAt with the server time. If the committed
  // state has ended, this device writes the results.
  async function transact(roomCode, viewerSeat, move) {
    let outcome = null;
    const updateMatch = (current) => {
      // Without a cached value the SDK first calls with null; returning it unchanged makes the
      // server answer with the real value and the SDK call again.
      if (current === null) {
        outcome = null;
        return null;
      }
      let state;
      try {
        state = JSON.parse(current.stateJson);
      } catch {
        outcome = { ok: false, error: { code: 'INVALID_STATE', message: 'the stored match state is unreadable' } };
        return undefined;
      }
      const result = applyAction(state, move);
      if (!result.ok) {
        outcome = { ok: false, error: result.error };
        return undefined; // abort: nothing is written
      }
      const seq = current.seq + 1;
      const next = {
        n: current.n,
        seq,
        stateJson: JSON.stringify(result.state),
        log: { ...(current.log ?? {}), [seq]: JSON.stringify(result.events) },
        clockAt: result.state.clock.seq !== state.clock.seq ? serverTimestamp() : current.clockAt,
      };
      outcome = { ok: true, events: result.events, ended: result.state.status === 'ended' };
      traffic.addWritten(next);
      return next;
    };

    let committed;
    try {
      committed = await deps.runTransaction(ref(db, paths.match(roomCode)), updateMatch, { applyLocally: false });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      const meta = await read(paths.meta(roomCode));
      if (meta === null || meta.status !== PLAYING_STATUS) throw new RoomError(ROOM_ERR.NO_MATCH, 'the match is no longer running', error);
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused the move', error);
    }
    if (outcome === null) throw new RoomError(ROOM_ERR.NO_MATCH, 'no match is running in this room');
    if (!outcome.ok) return outcome;

    const reply = { ok: true, events: eventsFor(outcome.events, viewerSeat) };
    if (outcome.ended) {
      // This transaction ended the match: write the results now. If it fails, the other
      // devices' runMatchClock writes them after a short delay.
      reply.ended = true;
      try {
        await finishMatch(roomCode, committed?.snapshot?.val?.() ?? null);
        reply.finished = true;
      } catch {
        reply.finished = false;
      }
    }
    return reply;
  }

  /**
   * Writes the results of an ended match and sets the status back to 'lobby', in one update:
   * results/{n} = { scoreJson: scoreMatch of all the match's log events (DEFAULT_SCORING),
   * joinedAt: each player's seat joinedAt }. The results are deterministic, so a second writer
   * would write the same thing; the rules refuse it because the entry exists, which counts as
   * success here. Does nothing if the match has not ended.
   * @param {string} roomCode
   * @param {object | null} matchValue the match node as committed (read again if null)
   */
  async function finishMatch(roomCode, matchValue) {
    const value = matchValue ?? (await read(paths.match(roomCode)));
    if (value === null || typeof value !== 'object') return;
    const state = JSON.parse(value.stateJson);
    if (state.status !== 'ended') return;
    if ((await read(paths.result(roomCode, value.n))) !== null) return;
    const entry = buildResult(state, value.log, await read(paths.seats(roomCode)));
    const values = { [paths.result(roomCode, value.n)]: entry, [paths.metaStatus(roomCode)]: LOBBY_STATUS };
    traffic.addWritten(values);
    try {
      await writeAll(values);
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // Another device wrote the same results first.
      if ((await read(paths.result(roomCode, value.n))) !== null) return;
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused the match results', error);
    }
  }

  /**
   * Submits an engine action as the caller's own seat (any playerId in `action` is replaced).
   * The action is applied in a transaction on the match node, so concurrent submissions are
   * serialised: each attempt runs the engine on the latest state, and the result returned is the
   * one of the final attempt. A timeout is sent without a playerId, as { type: 'timeout', seq }
   * (normally by runMatchClock); a STALE_TIMEOUT result just means another device was faster.
   * If this action ends the match, the results are written too (`ended: true`).
   * @param {{ uid: string, code: string, action: { type: string } }} input
   * @returns {Promise<{ ok: true, events: object[], ended?: boolean, finished?: boolean }
   *   | { ok: false, error: { code: string, message?: string } }>}
   *   `events`: the events of this action that the caller's seat may see; `error.code`: the
   *   engine's code (e.g. NOT_YOUR_TURN, STALE_TIMEOUT) when the engine refuses the action
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_ACTION, ACTION_NOT_ALLOWED
   *   (removePlayer: use removeAbsentPlayer), ROOM_NOT_FOUND, NO_MATCH, NOT_MEMBER,
   *   WRITE_DENIED, INVALID_DEPENDENCIES
   */
  async function submitAction({ uid, code, action } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    if (action === null || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') {
      throw new RoomError(ROOM_ERR.INVALID_ACTION, 'an action is an object with a string type');
    }
    if (LAYER_ONLY.includes(action.type)) {
      throw new RoomError(ROOM_ERR.ACTION_NOT_ALLOWED, `${action.type} cannot be submitted by a player`);
    }
    requireDeps('runTransaction');
    const meta = await readMeta(roomCode);
    if (meta.status !== PLAYING_STATUS) throw new RoomError(ROOM_ERR.NO_MATCH, 'no match is running in this room');
    const mySeat = await requireOwnSeat(roomCode, uid);
    // A timeout belongs to the clock, not to a player: no playerId.
    const move = action.type === 'timeout' ? { type: 'timeout', seq: action.seq } : { ...action, playerId: mySeat };
    return transact(roomCode, mySeat, move);
  }

  /**
   * The host removes a disconnected player from the running match (decision Q6): only a seat that
   * is still alive in the match and whose presence is off right now. Sends
   * { type: 'removePlayer', target } through the same transaction as submitAction. These checks
   * live in this layer only: the rules cannot see the action inside stateJson.
   * @param {{ uid: string, code: string, seatId: string }} input
   * @returns {Promise<{ ok: true, events: object[], ended?: boolean } | { ok: false, error: object }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT, ROOM_NOT_FOUND, NO_MATCH,
   *   NOT_MEMBER, WRITE_DENIED (not the host, or the host's own seat), PLAYER_NOT_ALIVE (not a
   *   living player of this match), SEAT_PRESENT (the seat is connected), INVALID_DEPENDENCIES
   */
  async function removeAbsentPlayer({ uid, code, seatId } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    requireDeps('runTransaction');
    const meta = await readMeta(roomCode);
    if (meta.status !== PLAYING_STATUS) throw new RoomError(ROOM_ERR.NO_MATCH, 'no match is running in this room');
    const mySeat = await requireOwnSeat(roomCode, uid);
    if (meta.hostSeat !== mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can remove a player');
    if (seatId === mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the host cannot remove their own seat');
    const match = await read(paths.match(roomCode));
    const state = match === null ? null : JSON.parse(match.stateJson);
    const player = state?.players.find((p) => p.id === seatId);
    if (!player || !player.alive) {
      throw new RoomError(ROOM_ERR.PLAYER_NOT_ALIVE, `${seatId} is not a living player of this match`);
    }
    const presence = (await read(paths.presence(roomCode))) ?? {};
    if (isSeatPresent(presence[seatId])) {
      throw new RoomError(ROOM_ERR.SEAT_PRESENT, `${seatId} is connected; only an absent player can be removed`);
    }
    return transact(roomCode, mySeat, { type: 'removePlayer', target: seatId });
  }

  /**
   * Session points per seat, summed over the room's match results with the engine's session
   * helpers. A result counts for a seat only if the joinedAt it recorded equals the seat's
   * current joinedAt: a newcomer on a freed seat starts at 0, a recovered seat keeps its points.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<Record<string, number>>} every current seat, 0 without points
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_MEMBER
   */
  async function getSessionScores({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    await readMeta(roomCode);
    await requireOwnSeat(roomCode, uid);
    return computeSessionScores(await read(paths.results(roomCode)), await read(paths.seats(roomCode)));
  }

  /**
   * Runs the match clock on this device (decision Q38): on every match update with a running
   * countdown, schedules { type: 'timeout', seq } at the deadline (clockAt + shotTimeSeconds, in
   * server time) if the clock waits for this device's seat, or at deadline + 3 s + 0-2 s
   * otherwise, and only if the countdown has not moved on. A STALE_TIMEOUT answer is normal and
   * is not reported. It also finishes a match that ended without results (after 1-3 s), in case
   * the device that ended it could not. Separate from watchMatch, so a UI can watch without
   * sending, and every device in the room can run the clock without watching.
   * @param {{ uid: string, code: string, onError?: (error: unknown) => void }} input
   * @returns {() => void} stop
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_DEPENDENCIES
   */
  function runMatchClock({ uid, code, onError } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireDeps('onValue', 'runTransaction');
    const report = reporter(onError);

    let stopped = false;
    let offset = 0;
    let seatId = null;
    let finishTimer = null;
    let finishFor = null;
    const unsubscribers = [];

    const runner = createClockRunner({
      setTimeout: setTimer,
      clearTimeout: clearTimer,
      now,
      random,
      onFire(seq) {
        transact(roomCode, seatId, { type: 'timeout', seq })
          .then((result) => {
            if (!result.ok && result.error.code !== STALE_TIMEOUT) report(new RoomError(ROOM_ERR.WRITE_DENIED, `timeout refused: ${result.error.code}`));
          })
          .catch(report);
      },
    });

    function scheduleFinish(value) {
      if (finishFor === value.n) return;
      finishFor = value.n;
      finishTimer = setTimer(() => {
        finishTimer = null;
        if (!stopped) finishMatch(roomCode, null).catch(report);
      }, FINISH_DELAY_MS + random() * FINISH_JITTER_MS);
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      runner.stop();
      if (finishTimer !== null) clearTimer(finishTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    }

    (async () => {
      seatId = await currentSeat(roomCode, uid);
      if (stopped) return;
      unsubscribers.push(
        deps.onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
          offset = Number(snapshot.val()) || 0;
        }, report),
        deps.onValue(
          ref(db, paths.match(roomCode)),
          (snapshot) => {
            const value = snapshot.val();
            traffic.addReceived(value);
            if (stopped || value === null || typeof value !== 'object') return;
            let state;
            try {
              state = JSON.parse(value.stateJson);
            } catch (error) {
              report(error);
              return;
            }
            const ended = state.status === 'ended';
            runner.update(
              { ended, clock: state.clock, clockAt: value.clockAt, shotTimeSeconds: state.config.shotTimeSeconds, mySeat: playerIdIn(state, seatId) },
              offset,
            );
            if (ended) scheduleFinish(value);
          },
          (error) => {
            stop();
            report(new RoomError(ROOM_ERR.NOT_MEMBER, `only a member of room ${roomCode} can run the match clock`, error));
          },
        ),
      );
      if (stopped) for (const unsubscribe of unsubscribers) unsubscribe();
    })().catch(report);

    return stop;
  }

  /**
   * Watches the match as the caller's seat sees it. Every change delivers
   * { n, seq, view, events, legalActions, clockAt, initial }: `view` is viewFor(state, mySeat)
   * (the spectator view for a member who is not a player of this match, e.g. a waiting seat),
   * `events` the new log entries since the previous delivery as eventsFor lets that seat see them,
   * `legalActions` the engine's legal actions of the caller's seat only ([] for a spectator),
   * `clockAt` the server time the current countdown started (deadline: clockAt +
   * view.config.shotTimeSeconds * 1000). The first delivery of a match (the first one,
   * or after a new match started) has initial: true and all of its log entries. Nothing is
   * delivered while the room has no match.
   * @param {{ uid: string, code: string, onUpdate: (update: object) => void, onError?: (error: unknown) => void }} input
   * @returns {() => void} unsubscribe
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_DEPENDENCIES
   */
  function watchMatch({ uid, code, onUpdate, onError } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireDeps('onValue');
    if (typeof onUpdate !== 'function') throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'watchMatch needs onUpdate');
    const report = reporter(onError);

    let stopped = false;
    let unsubscribe = null;
    let lastN = null;
    let lastSeq = -1;

    (async () => {
      const seatId = await currentSeat(roomCode, uid);
      if (stopped) return;
      unsubscribe = deps.onValue(
        ref(db, paths.match(roomCode)),
        (snapshot) => {
          const value = snapshot.val();
          traffic.addReceived(value);
          if (stopped || value === null || typeof value !== 'object') return;
          let state;
          try {
            state = JSON.parse(value.stateJson);
          } catch (error) {
            report(error);
            return;
          }
          const playerId = playerIdIn(state, seatId);
          const initial = value.n !== lastN;
          const update = {
            n: value.n,
            seq: value.seq,
            view: viewFor(state, playerId),
            events: eventsSince(parseLog(value.log), initial ? -1 : lastSeq, playerId),
            legalActions: legalActionsFor(state, playerId),
            clockAt: value.clockAt,
            initial,
          };
          lastN = value.n;
          lastSeq = value.seq;
          try {
            onUpdate(update);
          } catch (error) {
            report(error);
          }
        },
        // The match is members-only: a refused listener means this device has no seat (any more).
        (error) => {
          stopped = true;
          report(new RoomError(ROOM_ERR.NOT_MEMBER, `only a member of room ${roomCode} can watch the match`, error));
        },
      );
      if (stopped) unsubscribe();
    })().catch(report);

    return function stop() {
      stopped = true;
      if (unsubscribe) unsubscribe();
    };
  }

  return {
    startMatch,
    submitAction,
    removeAbsentPlayer,
    getSessionScores,
    runMatchClock,
    watchMatch,
    /** Approximate traffic of startMatch, submitAction and watchMatch (see createTrafficCounter). */
    getTrafficStats: () => traffic.stats(),
    resetTrafficStats: () => traffic.reset(),
  };
}
