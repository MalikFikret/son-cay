// Pure helpers of the match table screen (no DOM, no database): where the seats sit around the
// table, where the revolver points, which seats can be targeted, the countdown, the status line,
// the last-move line and the reload announcement.
//
// Everything here works on what watchMatch gives this device (its own view, its own events and
// its own legal actions), never on the raw match state.

import { TEXT } from './messages.js';
import { toolName } from './tools.js';

/** The table is designed on a 390 px wide stage; positions are in these units. */
export const STAGE_WIDTH = 390;

// Seat box sizes (px), by the number of players: big boxes for few players, small ones for many.
// Heights are the box heights the layout keeps apart (the CSS boxes are at most this tall).
export const SEAT_SIZES = Object.freeze({
  large: Object.freeze({ width: 112, height: 72, stage: 420 }),
  medium: Object.freeze({ width: 96, height: 64, stage: 450 }),
  small: Object.freeze({ width: 70, height: 58, stage: 480 }),
});

const EDGE = 6; // gap between a seat box and the stage edge
const TOP_ROW_Y = 38; // centre line of the top row (and distance of the bottom row from the bottom)

/** The seat size used for this many players. */
export function seatSizeFor(count) {
  if (count <= 6) return 'large';
  if (count <= 10) return 'medium';
  return 'small';
}

/**
 * Seat centres around the table for `count` players, in stage units (x 0..390, y 0..height).
 * Point 0 is the bottom centre (the viewer's own seat); the others follow clockwise on the screen
 * (bottom, left, top, right), spaced evenly along the bottom row, the left column, the top row and
 * the right column. The columns stop one box height short of the rows, so no two boxes overlap.
 * @param {number} count 1..15
 * @returns {{ size: string, width: number, height: number, cx: number, cy: number,
 *   points: Array<{ x: number, y: number }> }}
 */
export function seatLayout(count) {
  const n = Math.max(1, Math.floor(count));
  const size = seatSizeFor(n);
  const box = SEAT_SIZES[size];
  const height = box.stage;
  const left = box.width / 2 + EDGE;
  const right = STAGE_WIDTH - left;
  const top = TOP_ROW_Y;
  const bottom = height - TOP_ROW_Y;
  const row = right - left;
  const column = bottom - top - 2 * box.height;
  // The path, clockwise on screen from the bottom centre.
  const segments = [
    { length: row / 2, at: (d) => ({ x: STAGE_WIDTH / 2 - d, y: bottom }) },
    { length: column, at: (d) => ({ x: left, y: bottom - box.height - d }) },
    { length: row, at: (d) => ({ x: left + d, y: top }) },
    { length: column, at: (d) => ({ x: right, y: top + box.height + d }) },
    { length: row / 2, at: (d) => ({ x: right - d, y: bottom }) },
  ];
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  const points = [];
  for (let i = 0; i < n; i += 1) {
    let d = (total * i) / n;
    let segment = segments[0];
    for (segment of segments) {
      if (d < segment.length || segment === segments[segments.length - 1]) break;
      d -= segment.length;
    }
    const p = segment.at(d);
    points.push({ x: round1(p.x), y: round1(p.y) });
  }
  return { size, width: box.width, height, cx: STAGE_WIDTH / 2, cy: height / 2, points };
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The players in screen order: the viewer first (bottom centre), then the seats that follow in
 * the engine's seat order, which is the clockwise direction on the screen. A spectator (or an
 * unknown viewer) sees seat 0 at the bottom.
 * @param {Array<{ id: string, seat: number }>} players view.players
 * @param {string | null} viewerId
 * @returns {Array<{ id: string, x: number, y: number }>} with seatLayout positions
 */
export function placeSeats(players, viewerId) {
  const list = [...players].sort((a, b) => a.seat - b.seat);
  const start = Math.max(0, list.findIndex((p) => p.id === viewerId));
  const ordered = list.slice(start).concat(list.slice(0, start));
  const { points } = seatLayout(ordered.length);
  return ordered.map((p, i) => ({ id: p.id, x: points[i].x, y: points[i].y }));
}

/** Direction (degrees, 0 = right, 90 = down) from the table centre to a point. */
export function aimAngle(center, point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** `next` moved by whole turns so the revolver turns the short way from `previous`. */
export function nearestAngle(previous, next) {
  if (!Number.isFinite(previous)) return next;
  let angle = next;
  while (angle - previous > 180) angle -= 360;
  while (angle - previous < -180) angle += 360;
  return angle;
}

/** True when the revolver points to the left half (draw it mirrored so the grip stays down). */
export function pointsLeft(angle) {
  const a = ((angle % 360) + 360) % 360;
  return a > 90 && a < 270;
}

// --- Targets ---------------------------------------------------------------------------------

/** The seats this device may shoot at now: the targets of its chooseTarget legal actions. */
export function targetsFrom(legalActions) {
  if (!Array.isArray(legalActions)) return [];
  const out = [];
  for (const action of legalActions) {
    if (action?.type === 'chooseTarget' && typeof action.target === 'string' && !out.includes(action.target)) {
      out.push(action.target);
    }
  }
  return out;
}

/**
 * The target after a tap on a seat: a targetable seat becomes the target, a tap on the current
 * target clears it, anything else changes nothing. There is never a default target.
 */
export function tapTarget(current, tapped, targets) {
  if (!targets.includes(tapped)) return current;
  return current === tapped ? null : tapped;
}

/** The target kept after an update: dropped when it can no longer be shot at. */
export function keepTarget(current, targets) {
  return current !== null && targets.includes(current) ? current : null;
}

/** The seat the revolver points at: my chosen target (my screen only), else the current player. */
export function revolverSeat({ target, view }) {
  if (target) return target;
  if (view?.phase?.type === 'loot' && view.phase.queue?.[0]?.looter) return view.phase.queue[0].looter;
  return view?.turn?.playerId ?? null;
}

// --- Clock -------------------------------------------------------------------------------------

/**
 * Milliseconds left in the current countdown (never below 0), or null when no countdown runs.
 * @param {{ clockAt: number, seconds: number, kind: string, serverNow: number }} info
 */
export function msLeft({ clockAt, seconds, kind, serverNow }) {
  if (kind === 'none' || typeof clockAt !== 'number' || typeof seconds !== 'number') return null;
  return Math.max(0, clockAt + seconds * 1000 - serverNow);
}

/** Whole seconds shown on the countdown (rounded up: 0.2 s left shows 1). */
export const secondsShown = (ms) => (ms === null ? null : Math.ceil(ms / 1000));

/** The last 5 seconds of my turn: the fire button pulses. */
export const URGENT_MS = 5000;

// --- Status line, seats --------------------------------------------------------------------------

/** The big status line under the table. */
export function statusText(view, nameOf) {
  if (!view) return '';
  if (view.status === 'ended') {
    if (view.result?.type === 'win') return view.result.winner === view.viewer ? TEXT.youWon : TEXT.winnerIs(nameOf(view.result.winner));
    return TEXT.drawResult;
  }
  if (view.phase?.type === 'loot' && view.phase.queue?.[0]) return TEXT.lootOf(nameOf(view.phase.queue[0].looter));
  if (view.turn.playerId === view.viewer) return TEXT.yourTurn;
  return TEXT.turnOf(nameOf(view.turn.playerId));
}

/**
 * The round each player went out in, from the events of the match so far (`eliminated` carries
 * the round; `playerRemoved` happens in the round of the last `reloaded`).
 * @returns {Record<string, { round: number, removed: boolean }>}
 */
export function outRounds(events, known = {}, startRound = 0) {
  const out = { ...known };
  let round = startRound;
  for (const e of events) {
    if (e.type === 'reloaded') round = e.round;
    else if (e.type === 'eliminated') out[e.player] = { round: e.round, removed: false };
    else if (e.type === 'playerRemoved' && round > 0) out[e.player] = { round, removed: true };
  }
  return out;
}

/** The current round from the events, for outRounds when updates arrive one by one. */
export function lastRound(events, previous = 0) {
  let round = previous;
  for (const e of events) if (e.type === 'reloaded') round = e.round;
  return round;
}

/**
 * The small tags of a seat, in display order.
 * @param {{ id: string, alive: boolean }} player
 * @param {{ viewerId: string | null, turnId: string | null, target: string | null,
 *   present: boolean, out?: { round: number, removed: boolean } }} info
 */
export function seatTags(player, { viewerId, turnId, target, present, out, ended = false }) {
  const tags = [];
  if (player.id === viewerId) tags.push(TEXT.tagMe);
  if (!player.alive) {
    if (out) tags.push(out.removed ? TEXT.removedInRound(out.round) : TEXT.outInRound(out.round));
    return tags;
  }
  if (player.id === target) tags.push(TEXT.tagTarget);
  else if (!ended && player.id === turnId && player.id !== viewerId) tags.push(TEXT.tagTurn);
  if (!present) tags.push(TEXT.tagAbsent);
  return tags;
}

// --- Last move -----------------------------------------------------------------------------------

const MOVE_TYPES = ['shot', 'playerRemoved', 'toolUsed', 'turnSkipped'];

/**
 * The last move as one line, from public information only: the latest shot (with the players it
 * eliminated), removal, announced tool use or jail skip. Private events are ignored.
 * @param {object[]} events the events seen so far (oldest first)
 * @param {(id: string) => string} nameOf
 * @returns {{ lead: string, effect: 'live' | 'blank' | null, tail: string } | null}
 */
export function lastMove(events, nameOf) {
  const list = events.filter((e) => e && e.visibility === 'public');
  let index = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (MOVE_TYPES.includes(list[i].type)) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    return list.some((e) => e.type === 'matchStarted') ? { lead: TEXT.matchBegan, effect: null, tail: '' } : null;
  }
  const e = list[index];
  if (e.type === 'playerRemoved') return { lead: TEXT.playerRemovedLine(nameOf(e.player)), effect: null, tail: '' };
  if (e.type === 'toolUsed') return { lead: TEXT.toolUsedLine(nameOf(e.by), toolName(e.tool)), effect: null, tail: '' };
  if (e.type === 'turnSkipped') return { lead: TEXT.turnSkippedLine(nameOf(e.player)), effect: null, tail: '' };
  let lead;
  if (e.auto) lead = TEXT.shotOnTimeout(nameOf(e.shooter));
  else if (e.target === e.shooter) lead = TEXT.shotAtSelf(nameOf(e.shooter));
  else lead = TEXT.shotAtOther(nameOf(e.shooter), nameOf(e.target));
  const out = [];
  for (let i = index + 1; i < list.length && !MOVE_TYPES.includes(list[i].type); i += 1) {
    if (list[i].type === 'eliminated') out.push(TEXT.playerOut(nameOf(list[i].player)));
  }
  return { lead, effect: e.effect === 'live' ? 'live' : 'blank', tail: out.join(' ') };
}

// --- Reload announcement -----------------------------------------------------------------------

/**
 * The announcement of a (re)load: "3 Dolu · 3 Boş". Only the two announced counts; never the
 * number of chambers left or what has been fired.
 * @param {{ live: number, blank: number }} counts a `reloaded` event or view.round.announced
 */
export function reloadText(counts) {
  if (!counts || !Number.isInteger(counts.live) || !Number.isInteger(counts.blank)) return null;
  return { live: TEXT.reloadLive(counts.live), blank: TEXT.reloadBlank(counts.blank), text: `${TEXT.reloadLive(counts.live)} · ${TEXT.reloadBlank(counts.blank)}` };
}

/**
 * The announcement to show for an update, if any: the last `reloaded` event of a new update; on
 * the first update (match start or a reloaded page) the announced counts while nothing has been
 * fired yet this round.
 */
export function reloadFor(update) {
  if (!update?.view || update.view.status !== 'active') return null;
  if (update.initial) return update.view.round.shots === 0 ? reloadText(update.view.round.announced) : null;
  let last = null;
  for (const e of update.events ?? []) if (e.type === 'reloaded') last = e;
  return last ? reloadText(last) : null;
}

/** The public shots of an update, in order (what every screen animates). */
export function shotsIn(events) {
  return (events ?? []).filter((e) => e.type === 'shot' && e.visibility === 'public');
}

// --- Turn direction arrows -----------------------------------------------------------------------

/**
 * Two arcs left and right of the table with arrow heads in the turn direction (1 = clockwise on
 * the screen, -1 = counter-clockwise), as SVG path data in stage units.
 */
export function directionArrows(cx, cy, r, direction) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const at = (deg) => ({ x: round1(cx + r * Math.cos(rad(deg))), y: round1(cy + r * Math.sin(rad(deg))) });
  const arcs = [[151, 209], [331, 389]]; // left side (going up), right side (going down), clockwise
  return arcs.map(([from, to]) => {
    const [a, b] = direction === -1 ? [to, from] : [from, to];
    const start = at(a);
    const end = at(b);
    const sweep = direction === -1 ? 0 : 1;
    // Arrow head at the end, along the tangent.
    const tangent = rad(b + (direction === -1 ? -90 : 90));
    const back = { x: end.x - 9 * Math.cos(tangent), y: end.y - 9 * Math.sin(tangent) };
    const normal = tangent + Math.PI / 2;
    const h1 = { x: round1(back.x + 5 * Math.cos(normal)), y: round1(back.y + 5 * Math.sin(normal)) };
    const h2 = { x: round1(back.x - 5 * Math.cos(normal)), y: round1(back.y - 5 * Math.sin(normal)) };
    return {
      arc: `M${start.x} ${start.y} A${r} ${r} 0 0 ${sweep} ${end.x} ${end.y}`,
      head: `M${h1.x} ${h1.y} L${end.x} ${end.y} L${h2.x} ${h2.y}`,
    };
  });
}
