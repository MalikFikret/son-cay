// The summary of a finished match for the Tablo ("Bu maç"): pure, no database access.
//
// Only PUBLIC information: it reads the public events of the match log (publicEvents) and the
// public view of the final state (viewFor(state, null)), never tools, coins or private events.
// Points come from the engine's scoreMatch; the four shot lines of the breakdown classify the
// same public shot events with the engine's classifyShot, so their sum is scoreMatch's `shots`.

import { DEFAULT_SCORING, classifyShot, publicEvents, scoreMatch, viewFor } from '../engine/index.js';
import { parseLog } from './match-helpers.js';

export const SHOT_KINDS = Object.freeze(['liveOnOther', 'blankOnOther', 'blankOnSelf', 'liveOnSelf']);

function emptyBreakdown() {
  const breakdown = {};
  for (const kind of SHOT_KINDS) breakdown[kind] = { count: 0, points: 0 };
  breakdown.eliminations = { count: 0, points: 0 };
  breakdown.rounds = { count: 0, points: 0 };
  breakdown.win = { points: 0 };
  breakdown.predictions = { count: 0, points: 0 };
  return breakdown;
}

/**
 * @param {{ n: number, state: object, log: unknown, scoring?: object }} input
 *   state: the final engine state of the match; log: rooms/{CODE}/match/log
 * @returns {{ n: number, mode: string, rounds: number, complete: boolean, result: string | null,
 *   winner: string | null, startHp: number, rows: Array<{ seatId: string,
 *   status: 'won' | 'alive' | 'eliminated' | 'removed', outRound: number | null,
 *   roundsSurvived: number, hp: number, points: number, breakdown: object }> }}
 *   rows: living players first (points, then seat id), then the others, last out first
 */
export function summarizeMatch({ n, state, log, scoring = DEFAULT_SCORING }) {
  return summarizeView({ n, view: viewFor(state, null), events: parseLog(log).flatMap((entry) => entry.events), scoring });
}

/**
 * The same summary from what one device sees: any viewFor() view of the match (only its public
 * part is read: config and players) and the events that device received (only the PUBLIC ones
 * are read). Works for a running match too (the live Tablo): living players are 'alive', points
 * are the ones earned so far, `complete` is false and `result` null until the match ended.
 * @param {{ n: number, view: object, events: object[], scoring?: object }} input
 */
export function summarizeView({ n, view, events: seen, scoring = DEFAULT_SCORING }) {
  const events = publicEvents(Array.isArray(seen) ? seen : []);
  const score = scoreMatch(events, scoring);

  const rows = new Map();
  for (const player of view.players) {
    rows.set(player.id, {
      seatId: player.id,
      status: player.alive ? 'alive' : 'eliminated',
      outRound: null,
      outIndex: -1,
      roundsSurvived: 0,
      hp: player.hp,
      points: score.players[player.id]?.total ?? 0,
      breakdown: emptyBreakdown(),
    });
  }

  let round = 1;
  events.forEach((event, index) => {
    switch (event.type) {
      case 'shot': {
        const row = rows.get(event.shooter);
        if (!row || (event.auto && !scoring.scoreAutoShots)) break;
        const kind = classifyShot(event);
        row.breakdown[kind].count += 1;
        row.breakdown[kind].points += scoring[kind];
        break;
      }
      case 'eliminated': {
        const row = rows.get(event.player);
        if (row) {
          row.status = 'eliminated';
          row.outRound = typeof event.round === 'number' ? event.round : round;
          row.outIndex = index;
        }
        const by = event.by === null ? null : rows.get(event.by);
        if (by) {
          by.breakdown.eliminations.count += 1;
          by.breakdown.eliminations.points += scoring.elimination;
        }
        break;
      }
      case 'playerRemoved': {
        const row = rows.get(event.player);
        if (row) {
          row.status = 'removed';
          row.outRound = round;
          row.outIndex = index;
        }
        break;
      }
      case 'roundEnded':
        for (const id of event.survivors) {
          const row = rows.get(id);
          if (!row) continue;
          row.roundsSurvived += 1;
          row.breakdown.rounds.count += 1;
          row.breakdown.rounds.points += event.shots * scoring.roundSurvivalPerShot;
        }
        round += 1;
        break;
      case 'predictionResolved': {
        const row = rows.get(event.player);
        if (!row) break;
        row.breakdown.predictions.count += 1;
        row.breakdown.predictions.points += event.correct ? scoring.predictionCorrect : scoring.predictionWrong;
        break;
      }
      default:
        break;
    }
  });

  // The win bonus is the engine's (it depends on the starting players).
  for (const row of rows.values()) row.breakdown.win.points = score.players[row.seatId]?.win ?? 0;
  if (score.result === 'win' && rows.has(score.winner)) rows.get(score.winner).status = 'won';

  const ordered = orderBySurvival([...rows.values()].map((row) => ({ ...row, outOrder: row.outIndex })));

  return {
    n,
    mode: view.config.mode,
    rounds: round,
    complete: score.complete,
    result: score.result,
    winner: score.winner,
    startHp: view.config.hp,
    rows: ordered.map(({ outIndex, outOrder, ...row }) => row),
  };
}

/**
 * Orders Tablo rows by survival: the winner, the other living players by points (then seat id),
 * then the players who are out, the last one out first. Also for the live table later.
 * @param {Array<{ seatId: string, status: string, points: number, outOrder?: number }>} rows
 *   outOrder: larger = went out later
 */
export function orderBySurvival(rows) {
  const isIn = (row) => row.status === 'won' || row.status === 'alive';
  return [...rows].sort((a, b) => {
    if (isIn(a) !== isIn(b)) return isIn(a) ? -1 : 1;
    if (isIn(a)) {
      if ((a.status === 'won') !== (b.status === 'won')) return a.status === 'won' ? -1 : 1;
      return b.points - a.points || (a.seatId < b.seatId ? -1 : 1);
    }
    return (b.outOrder ?? 0) - (a.outOrder ?? 0);
  });
}
