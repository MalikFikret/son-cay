// Device settings (Ayarlar, step 4.4a, decisions Q43, Q53, Q55): the revolver, sound and motion,
// kept on THIS device only (localStorage "sonCay.settings"), never written to the database.
//
// - Safe defaults: Musul Gravürü, sound on, motion on. Missing, blocked or broken storage, and any
//   bad value (unknown revolver, a non-boolean switch), fall back to the default for that field;
//   the other fields keep their stored values. A change still applies for this page when storage
//   cannot be written.
// - Changes apply at once: listeners (onSettingsChange) hear every real change, and the motion
//   switch is mirrored as the class `motion-off` on <html> (applyMotion), which style.css uses
//   instead of the phone's "reduce motion" setting: animations follow ONLY this switch (Q53).
// - Sound: only stored for now; the sound step reads it with soundOn().
// - Another tab of the same browser that changes a setting is heard through the "storage" event.
//
// Pure except for the storage and the root element, both read lazily, so Node tests can run it.

import { DEFAULT_REVOLVER, isRevolverId } from './revolvers.js';

export const SETTINGS_KEY = 'sonCay.settings';

export const DEFAULT_SETTINGS = Object.freeze({ revolver: DEFAULT_REVOLVER, sound: true, motion: true });

/** The class on <html> while Hareketler is off. */
export const MOTION_OFF_CLASS = 'motion-off';

const VALID = Object.freeze({
  revolver: (value) => isRevolverId(value),
  sound: (value) => typeof value === 'boolean',
  motion: (value) => typeof value === 'boolean',
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
/** Sound on (the later sound step reads this before playing anything). */
export const soundOn = () => getSettings().sound;
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
