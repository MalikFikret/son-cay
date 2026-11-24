// The fire button's press, as a pure state machine (no DOM, no timers: the screen feeds it the
// pointer events and the time).
//
// - A quick press (released inside the button before LONG_PRESS_MS) fires at once.
// - A long press cocks the hammer (phase 'cocked'): it stays cocked and the revolver spins on
//   every screen (step 4.4b, decisions Q55 / Q74; no tremble) until the finger is released.
//   Released INSIDE the button: fire. Slid OUT of the button: uncock and cancel (the hint
//   "Vazgeçmek için dışarı kaydır" is shown while pressing).
// - When the time runs out, the turn is lost or the button is disabled during a press, the press
//   is cancelled ('expire'): the engine's timeout rule applies as it is.
// The only thing that leaves this device is THAT a long press is going on (the press signal,
// written on 'cock', removed after the shot or on 'cancel'), never the target (Q56).

export const LONG_PRESS_MS = 350;

export const PRESS = Object.freeze({ IDLE: 'idle', DOWN: 'down', COCKED: 'cocked' });

/** @returns {{ phase: string, since: number | null }} */
export function initialPress() {
  return { phase: PRESS.IDLE, since: null };
}

/** True while a finger (or key) is on the button. */
export const isPressing = (state) => state.phase !== PRESS.IDLE;

/**
 * One step of the press.
 * @param {{ phase: string, since: number | null }} state
 * @param {{ type: 'down', at: number, enabled: boolean } | { type: 'hold', at: number }
 *   | { type: 'leave' } | { type: 'up', at: number, inside: boolean } | { type: 'expire' }} event
 *   'hold': the long-press timer ran (the screen schedules it LONG_PRESS_MS after 'down');
 *   'leave': the finger left the button; 'expire': time ran out / turn lost / disabled;
 *   pointercancel is an 'expire' too.
 * @returns {{ state: object, effect: null | 'cock' | 'cancel' | { fire: 'quick' | 'long' } }}
 *   'cock': cock the hammer, start the spin, send the press signal; 'cancel': uncock, stop
 *   the spin, remove the signal.
 */
export function pressStep(state, event) {
  const idle = initialPress();
  switch (event?.type) {
    case 'down':
      if (state.phase !== PRESS.IDLE || !event.enabled) return { state, effect: null };
      return { state: { phase: PRESS.DOWN, since: event.at }, effect: null };
    case 'hold':
      if (state.phase !== PRESS.DOWN || event.at - state.since < LONG_PRESS_MS) return { state, effect: null };
      return { state: { phase: PRESS.COCKED, since: state.since }, effect: 'cock' };
    case 'leave':
    case 'expire':
      if (state.phase === PRESS.IDLE) return { state, effect: null };
      return { state: idle, effect: 'cancel' };
    case 'up': {
      if (state.phase === PRESS.IDLE) return { state, effect: null };
      if (!event.inside) return { state: idle, effect: 'cancel' };
      const long = state.phase === PRESS.COCKED || event.at - state.since >= LONG_PRESS_MS;
      return { state: idle, effect: { fire: long ? 'long' : 'quick' } };
    }
    default:
      return { state, effect: null };
  }
}
