// Device settings (Ayarlar, steps 4.4a and 4.4c, decisions Q43, Q53, Q55, Q52, Q76, Q77): the
// revolver, the sound master switch and the five per-sound switches, and motion, kept on THIS
// device only (localStorage "sonCay.settings"), never written to the database.
//
// - Safe defaults: Musul Gravürü, sound on, every sound on, motion on. Missing, blocked or broken storage, and any
//   bad value (unknown revolver, a non-boolean switch), fall back to the default for that field;
//   the other fields keep their stored values. A change still applies for this page when storage
//   cannot be written.
// - Changes apply at once: listeners (onSettingsChange) hear every real change, and the motion
//   switch is mirrored as the class `motion-off` on <html> (applyMotion), which style.css uses
//   instead of the phone's "reduce motion" setting: animations follow ONLY this switch (Q53).
// - Sound (step 4.4c, Q77): `sound` is the master switch ("Ses"); `soundEmpty`, `soundLoaded`,
//   `soundReload`, `soundTurn`, `soundHammer` are the five switches of the "Sesler" group. A
//   sound plays only while the master AND its own switch are on (soundAllowed); sounds.js
//   plays them and follows onSettingsChange to silence a sound at once.
// - Another tab of the same browser that changes a setting is heard through the "storage" event.
//
// Pure except for the storage and the root element, both read lazily, so Node tests can run it.

import { DEFAULT_REVOLVER, isRevolverId } from './revolvers.js';

export const SETTINGS_KEY = 'sonCay.settings';

/** The five sounds (sounds.js), each with its own switch key in the settings. */
export const SOUND_IDS = Object.freeze(['empty', 'loaded', 'reload', 'turn', 'hammer']);
export const SOUND_KEYS = Object.freeze({
  empty: 'soundEmpty', loaded: 'soundLoaded', reload: 'soundReload', turn: 'soundTurn', hammer: 'soundHammer',
});

export const DEFAULT_SETTINGS = Object.freeze({
  revolver: DEFAULT_REVOLVER, sound: true, motion: true,
  soundEmpty: true, soundLoaded: true, soundReload: true, soundTurn: true, soundHammer: true,
});

/** The class on <html> while Hareketler is off. */
export const MOTION_OFF_CLASS = 'motion-off';

const isBoolean = (value) => typeof value === 'boolean';
const VALID = Object.freeze({
  revolver: (value) => isRevolverId(value),
  sound: isBoolean,
  motion: isBoolean,
  ...Object.fromEntries(SOUND_IDS.map((id) => [SOUND_KEYS[id], isBoolean])),
});

let current = null; // the settings in use (read once, then kept in memory)
const listeners = new Set();

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw (blocked site data)
  }
}

/**
 * Settings from any stored value: each known field if valid, else its default. Never throws.
 * @param {unknown} raw the stored text (JSON) or null
 */
export function parseSettings(raw) {
  let stored = null;
  if (typeof raw === 'string') {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const out = { ...DEFAULT_SETTINGS };
  if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(stored, key) && VALID[key](stored[key])) out[key] = stored[key];
    }
  }
  return Object.freeze(out);
}

function readStored() {
  try {
    return parseSettings(storage()?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The settings in use: { revolver, sound, motion }. */
export function getSettings() {
  if (current === null) current = readStored();
  return current;
}

/** The chosen revolver id. */
export const chosenRevolver = () => getSettings().revolver;
/** The sound master switch ("Ses"). */
export const soundOn = () => getSettings().sound;

/**
 * Whether one sound may play: the master switch and that sound's own switch are both on. An
 * unknown sound id never plays.
 * @param {string} id one of SOUND_IDS
 * @param {object} [settings] defaults to the settings in use
 */
export function soundAllowed(id, settings = getSettings()) {
  if (!Object.prototype.hasOwnProperty.call(SOUND_KEYS, id)) return false;
  return settings.sound === true && settings[SOUND_KEYS[id]] === true;
}
/** Motion on (Hareketler): the full animations; off: the short version. */
export const motionOn = () => getSettings().motion;

/**
 * Changes one setting, stores it (if storage works) and tells the listeners. An unknown key or
 * an invalid value changes nothing.
 * @returns {boolean} true if the setting changed
 */
export function setSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(VALID, key) || !VALID[key](value)) return false;
  const before = getSettings();
  if (before[key] === value) return false;
  current = Object.freeze({ ...before, [key]: value });
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Storage full or blocked: the change still applies for this page.
  }
  changed(before);
  return true;
}

function changed(before) {
  applyMotion();
  for (const fn of [...listeners]) {
    try {
      fn(current, before);
    } catch {
      // A listener's failure never stops the others.
    }
  }
}

/** Listens to changes; returns stop(). */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mirrors the motion switch on <html> (class motion-off while off). */
export function applyMotion(root = globalThis.document?.documentElement) {
  if (root?.classList) root.classList.toggle(MOTION_OFF_CLASS, !motionOn());
}

/**
 * At start (app.js): read the stored settings, apply the motion class and follow changes made in
 * another tab of this browser.
 */
export function initDeviceSettings() {
  current = readStored();
  applyMotion();
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== SETTINGS_KEY && event.key !== null) return;
    const before = getSettings();
    current = readStored();
    if (Object.keys(DEFAULT_SETTINGS).some((key) => before[key] !== current[key])) changed(before);
  });
}

/** Tests only: forget the settings in memory (the next read goes to storage again). */
export function resetSettingsCache() {
  current = null;
}
