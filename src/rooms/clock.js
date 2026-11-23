// The match clock on the devices (decision Q38). Pure scheduling: no database access, timers and
// time come in as functions so tests can use fake ones.
//
// The engine's clock is state.clock = { seq, kind: 'shot' | 'none', playerId }; seq changes
// whenever a new countdown starts. match/clockAt is the server time the current countdown started;
// it lasts shotTimeSeconds. When it runs out, somebody sends { type: 'timeout', seq }:
// - the device of the seat the clock is waiting for sends it at the deadline;
// - every other device sends it at deadline + 3 s + a random 0-2 s, in case that device is gone.
// The engine accepts the first timeout for a seq and refuses the others (STALE_TIMEOUT).
//
// Loot (decision 63) is NOT on this clock: it is a private offer held by the looter, lasting
// LOOT_SECONDS from the countdown that started in the same write as the kill (offer.clockSeq).
// Only the looter's own device knows about it and sends its expiry
// ({ type: 'lootChoice', victim, choice: { kind: 'none' }, expired: true }); no other device
// ever schedules or sends anything for a loot (that would reveal it). See createLootRunner.

import { LOOT_SECONDS } from '../engine/index.js';

/** Other devices wait this long after the deadline before sending the timeout themselves. */
export const BACKUP_DELAY_MS = 3000;
/** ... plus a random delay of up to this much, so they do not all send at once. */
export const BACKUP_JITTER_MS = 2000;

/**
 * When this device should send the timeout for the current countdown, or null if it should not
 * (no countdown, the match is over, or the data is incomplete).
 * @param {{ ended: boolean, clock: { seq: number, kind: string, playerId: string | null },
 *   clockAt: number, shotTimeSeconds: number, mySeat: string | null }} info
 * @param {number} jitter a number in [0, 1)
 * @returns {{ seq: number, fireAtServerMs: number, own: boolean } | null}
 */
export function planTimeout(info, jitter) {
  if (!info || info.ended || !info.clock || info.clock.kind === 'none') return null;
  if (typeof info.clockAt !== 'number' || typeof info.shotTimeSeconds !== 'number') return null;
  const deadline = info.clockAt + info.shotTimeSeconds * 1000;
  const own = info.mySeat !== null && info.clock.playerId === info.mySeat;
  const fireAtServerMs = own ? deadline : deadline + BACKUP_DELAY_MS + jitter * BACKUP_JITTER_MS;
  return { seq: info.clock.seq, fireAtServerMs, own };
}

/**
 * Keeps at most one pending timeout timer and moves it with the match.
 * @param {{ setTimeout: Function, clearTimeout: Function, now: () => number, random: () => number,
 *   onFire: (seq: number) => void }} deps
 *   `now` is local time; update() takes the server time offset (server = local + offset)
 */
export function createClockRunner({ setTimeout, clearTimeout, now, random, onFire }) {
  let pending = null; // { seq, timer }
  let currentSeq = null;
  let ended = false;
  let stopped = false;

  function cancel() {
    if (pending !== null) clearTimeout(pending.timer);
    pending = null;
  }

  return {
    /**
     * Call on every match update.
     * @param {{ ended: boolean, clock: object, clockAt: number, shotTimeSeconds: number,
     *   mySeat: string | null }} info
     * @param {number} offset server time offset in ms
     */
    update(info, offset = 0) {
      if (stopped) return;
      ended = Boolean(info?.ended);
      currentSeq = info?.clock ? info.clock.seq : null;
      if (ended || !info?.clock || info.clock.kind === 'none') {
        cancel();
        return;
      }
      // Same countdown as the one already scheduled: keep it (and its jitter).
      if (pending !== null && pending.seq === info.clock.seq) return;
      cancel();
      const plan = planTimeout(info, random());
      if (plan === null) return;
      const delay = Math.max(0, plan.fireAtServerMs - (now() + offset));
      const seq = plan.seq;
      pending = {
        seq,
        timer: setTimeout(() => {
          pending = null;
          // Only if the countdown is still the same one (the seq did not change meanwhile).
          if (!stopped && !ended && currentSeq === seq) onFire(seq);
        }, delay),
      };
    },
    /** The scheduled countdown seq, or null (for tests and diagnostics). */
    pendingSeq() {
      return pending === null ? null : pending.seq;
    },
    stop() {
      stopped = true;
      cancel();
    },
  };
}

// --- Loot expiry (decision 63) -----------------------------------------------------------------

/** How many countdown start times a device remembers (one per clock.seq it saw). */
export const CLOCK_MEMORY_SIZE = 64;

/**
 * Remembers when the countdown `seq` started (match/clockAt, server time). Returns a new memory
 * object ({ [seq]: clockAt }), keeping only the latest CLOCK_MEMORY_SIZE countdowns.
 * A later value for the same seq replaces the earlier one (the SDK may first deliver an estimate).
 */
export function rememberClockAt(memory, seq, clockAt) {
  if (!Number.isInteger(seq) || typeof clockAt !== 'number') return memory;
  const next = { ...memory, [seq]: clockAt };
  const keys = Object.keys(next).map(Number).sort((a, b) => a - b);
  for (const key of keys.slice(0, Math.max(0, keys.length - CLOCK_MEMORY_SIZE))) delete next[key];
  return next;
}

/**
 * The server time a loot expires: the start of the countdown it was opened with (offer.clockSeq)
 * + LOOT_SECONDS. If this device never saw that countdown (page reloaded, offline, or two quick
 * updates merged), its start is unknown: the earliest later countdown it knows stands in for it,
 * so the loot lasts at most LOOT_SECONDS from the moment this device learnt of it. Null if
 * nothing usable is known.
 * @param {{ clockSeq: number }} loot an entry of view.self.loots (or the state's player.loots)
 * @param {Record<number, number>} memory from rememberClockAt
 * @returns {number | null}
 */
export function lootDeadline(loot, memory) {
  if (!loot || !Number.isInteger(loot.clockSeq) || !memory) return null;
  let start = typeof memory[loot.clockSeq] === 'number' ? memory[loot.clockSeq] : null;
  if (start === null) {
    const later = Object.keys(memory).map(Number).filter((seq) => seq > loot.clockSeq).sort((a, b) => a - b);
    if (later.length > 0) start = memory[later[0]];
  }
  return start === null ? null : start + LOOT_SECONDS * 1000;
}

/**
 * Keeps one expiry timer per open loot of THIS device's seat and nothing else: other devices
 * have no loots in their own data and so never schedule anything (decision 63).
 * @param {{ setTimeout: Function, clearTimeout: Function, now: () => number,
 *   onExpire: (victim: string) => void }} deps  `now` is local time
 */
export function createLootRunner({ setTimeout, clearTimeout, now, onExpire }) {
  const timers = new Map(); // `${victim}:${clockSeq}` -> { timer, deadline }
  let stopped = false;
  const keyOf = (loot) => `${loot.victim}:${loot.clockSeq}`;

  function cancel(key) {
    const entry = timers.get(key);
    if (entry) clearTimeout(entry.timer);
    timers.delete(key);
  }

  return {
    /**
     * Call on every match update.
     * @param {{ ended: boolean, loots: Array<{ victim: string, clockSeq: number }>,
     *   memory: Record<number, number> }} info  loots: my own open loots only
     * @param {number} offset server time offset in ms (server = local + offset)
     */
    update({ ended, loots, memory }, offset = 0) {
      if (stopped) return;
      const open = ended || !Array.isArray(loots) ? [] : loots;
      const keys = open.map(keyOf);
      for (const key of [...timers.keys()]) if (!keys.includes(key)) cancel(key);
      for (const loot of open) {
        const key = keyOf(loot);
        const deadline = lootDeadline(loot, memory);
        if (deadline === null) continue;
        const entry = timers.get(key);
        if (entry && entry.deadline === deadline) continue;
        cancel(key);
        const delay = Math.max(0, deadline - (now() + offset));
        timers.set(key, {
          deadline,
          timer: setTimeout(() => {
            timers.delete(key);
            if (!stopped) onExpire(loot.victim);
          }, delay),
        });
      }
    },
    /** The victims with a scheduled expiry (tests and diagnostics). */
    pending() {
      return [...timers.keys()].map((key) => key.split(':')[0]);
    },
    stop() {
      stopped = true;
      for (const key of [...timers.keys()]) cancel(key);
    },
  };
}
