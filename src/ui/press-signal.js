// The spinning revolver during a fire press (step 4.4b, decisions Q55 as changed by Q74, Q56):
// pure helpers, no DOM, no timers.
//
// - Which press signal to believe (activePress): rooms/{CODE}/press/{seatId} = { n, seq, at }
//   counts only for the seat the current countdown waits for, in this match (n) and this
//   countdown (seq = the engine's clock.seq), and only while it is not older than the shot time
//   (plus a small grace). Anything else is ignored, so a stale signal (the turn moved on, the
//   presser went offline and the removal is late, an old match) never spins a revolver.
//   The countdown's seq is used rather than the match's write count: an "any time" item used by
//   someone else during the press moves the write count but not the countdown, and must not stop
//   the spin.
// - The shot always wins: the screen ignores the signal while it plays a shot, and the shot moves
//   the countdown on, which makes the signal stale anyway.
// - The spin: constant speed, clockwise (the angle grows), never slowing near anything, so it
//   gives nothing away. On the shot it keeps going the same way and stops ON the target (stopPlan);
//   a quick press (no signal) is one short spin, then the stop.

/** Milliseconds for one full turn of the spin (constant speed). */
export const SPIN_TURN_MS = 700;
export const SPIN_DEG_PER_MS = 360 / SPIN_TURN_MS;

/** After the last spinning frame: the short final stop (only the mirror flip, if any, moves). */
export const SPIN_SETTLE_MS = 120;

/** The least turning before the stop: a long press (already spinning) and a quick press. */
export const STOP_MIN_DEG = 30;
export const QUICK_SPIN_MIN_DEG = 300;

/** Extra time a signal is believed past the shot time (clock skew, the write's own delay). */
export const PRESS_GRACE_MS = 1000;

/**
 * The seat whose press signal counts now, or null.
 * @param {{ press: object, view: object, n: number, serverNow: number }} input
 *   press: { seatId: { n, seq, at } } (normalizePress); view: this device's view; n: match number
 */
export function activePress({ press, view, n, serverNow }) {
  if (!press || !view || view.status !== 'active') return null;
  const clock = view.clock;
  if (!clock || clock.kind !== 'shot' || typeof clock.playerId !== 'string') return null;
  if (view.phase?.type !== 'turn') return null;
  if (!Object.prototype.hasOwnProperty.call(press, clock.playerId)) return null;
  const entry = press[clock.playerId];
  if (!entry || entry.n !== n || entry.seq !== clock.seq) return null;
  if (!Number.isFinite(serverNow) || serverNow > pressExpiresAt(entry, view)) return null;
  return clock.playerId;
}

/** Server time after which a signal no longer counts (the shot time limit plus the grace). */
export function pressExpiresAt(entry, view) {
  const seconds = view?.config?.shotTimeSeconds;
  return entry.at + (Number.isFinite(seconds) ? seconds * 1000 : 0) + PRESS_GRACE_MS;
}

/**
 * What the screen does with the signal now.
 * @param {{ spinning: 'none' | 'signal' | 'local', shotPlaying: boolean, active: string | null }} s
 *   spinning: not spinning, spinning because of a signal, or because of my own press
 * @returns {'start' | 'stop' | 'keep'}
 */
export function signalStep({ spinning, shotPlaying, active }) {
  if (shotPlaying) return 'keep'; // the shot wins
  if (spinning === 'local') return 'keep'; // my own press runs the spin on my screen
  if (active !== null && spinning === 'none') return 'start';
  if (active === null && spinning === 'signal') return 'stop';
  return 'keep';
}

/** The spin's angle at `now` (constant speed from `from` at `startedAt`). */
export function spinAngle({ from, startedAt }, now) {
  return from + Math.max(0, now - startedAt) * SPIN_DEG_PER_MS;
}

/**
 * Where and when the spin stops: the first angle at least `minDeg` ahead of `current`, in the
 * same direction, that points at `target` (an angle in degrees, any turn).
 * @returns {{ final: number, travel: number, ms: number }}
 */
export function stopPlan({ current, target, minDeg = STOP_MIN_DEG }) {
  let final = target;
  const least = current + minDeg;
  final += Math.ceil((least - final) / 360) * 360;
  const travel = final - current;
  return { final, travel, ms: travel / SPIN_DEG_PER_MS };
}
