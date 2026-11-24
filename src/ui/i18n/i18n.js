// The UI language (decision Q71): the one way the screens get a text, t(key, ...params).
//
// Language is per device: it is chosen here, stored on the device (localStorage) and never
// written to the database (the engine and the room layer only hold ids and numbers).
// - Choice: a stored language if it exists; else "en" when nothing is stored and the browser's
//   language starts with "en"; else Turkish. A language without a locale falls back to Turkish,
//   and so does any key missing from a locale (the tests require every key in both locales).
// - <html lang> follows the current language; setLanguage() tells the listeners (app.js draws the
//   current screen again).
// - Locale-aware casing / number formatting use the current language (Turkish İ / ı).
//
// Pure apart from the optional browser globals (document, localStorage, navigator), each used
// inside try/catch so the module also loads in Node (tests) and in private windows.

import en from './en.js';
import tr from './tr.js';

export const DEFAULT_LANGUAGE = 'tr';
export const STORAGE_KEY = 'sonCay.language';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** language -> locale, in the order the switchers show them. */
export const LOCALES = deepFreeze({ tr, en });
export const LANGUAGES = Object.freeze(Object.keys(LOCALES));

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

let current = DEFAULT_LANGUAGE;
const listeners = new Set();

/** A known language, or Turkish. */
export function resolveLanguage(lang) {
  return typeof lang === 'string' && hasOwn(LOCALES, lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * The language a device asks for at start (pure): the stored choice; else "en" when the browser's
 * language starts with "en"; else Turkish. It may not exist yet (see chooseLanguage).
 * @param {{ stored?: string | null, browser?: string | null }} sources the stored choice and
 *   navigator.language
 */
export function requestedLanguage({ stored = null, browser = null } = {}) {
  if (typeof stored === 'string' && stored !== '') return stored;
  if (typeof browser === 'string' && browser.toLowerCase().startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
}

/** The language a device starts with: the requested one if it has a locale, else Turkish. */
export function chooseLanguage(sources) {
  return resolveLanguage(requestedLanguage(sources));
}

/** The raw entry at a dotted key ("table.yourTurn") in a locale, or undefined. Own keys only. */
export function lookup(key, lang = current) {
  if (typeof key !== 'string' || key === '') return undefined;
  let node = LOCALES[resolveLanguage(lang)];
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

/** True if the key names a text (a string or a function) in the current language or Turkish. */
export function hasText(key) {
  const entry = lookup(key) ?? lookup(key, DEFAULT_LANGUAGE);
  return typeof entry === 'string' || typeof entry === 'function';
}

/**
 * The text of `key` in the current language (Turkish if the key is missing there). A function
 * entry is called with `params`. An unknown key returns the key itself (never throws; the tests
 * check that every key the UI uses exists).
 * @param {string} key  dotted, e.g. "table.turnOf"
 * @param {...unknown} params
 * @returns {string}
 */
export function t(key, ...params) {
  let entry = lookup(key);
  if (typeof entry !== 'string' && typeof entry !== 'function') entry = lookup(key, DEFAULT_LANGUAGE);
  if (typeof entry === 'function') return String(entry(...params));
  if (typeof entry === 'string') return entry;
  return String(key);
}

/**
 * A language's own name, always in that language, for the switchers: "Türkçe" / "English", or
 * with `short` "TR" / "EN".
 */
export function languageName(lang, { short = false } = {}) {
  const name = lookup(short ? 'meta.shortName' : 'meta.languageName', resolveLanguage(lang));
  return typeof name === 'string' ? name : String(lang);
}

/** The language after the current one, in LANGUAGES order (the ⋮ menu's switch). */
export function nextLanguage() {
  return LANGUAGES[(LANGUAGES.indexOf(current) + 1) % LANGUAGES.length];
}

/** The marker a text puts where its bold word goes (e.g. tableTools.counterResult). */
export const BOLD_SLOT = '{b}';

/**
 * Splits a text at its bold slot: [before, after]. Each language orders its own parts; the
 * screen puts the bold word (an element) between them. A text without the slot is all "before".
 */
export function splitBold(text) {
  const at = text.indexOf(BOLD_SLOT);
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + BOLD_SLOT.length)];
}

export function getLanguage() {
  return current;
}

function applyToDocument(lang) {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('meta.description'));
  } catch {
    // No document (Node) or a restricted one: nothing to update.
  }
}

function readStored() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(lang) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage blocked (private window, settings): the choice lasts for this page only.
  }
}

function browserLanguage() {
  try {
    return globalThis.navigator?.language ?? null;
  } catch {
    return null;
  }
}

/**
 * Picks the device's language at start (stored choice, else the browser's) and applies it to
 * <html lang>. Stores nothing. Returns the language.
 */
export function initLanguage() {
  current = chooseLanguage({ stored: readStored(), browser: browserLanguage() });
  applyToDocument(current);
  return current;
}

/**
 * Switches the language (an unknown one falls back to Turkish), stores the choice on this device
 * and tells the listeners if it changed. Returns the language now in use.
 */
export function setLanguage(lang) {
  const next = resolveLanguage(lang);
  writeStored(next);
  if (next === current) return current;
  current = next;
  applyToDocument(current);
  for (const fn of [...listeners]) {
    try {
      fn(current);
    } catch {
      // One listener's failure must not stop the others.
    }
  }
  return current;
}

/** Calls `fn(lang)` after every language change. Returns a function that stops it. */
export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Lower case by the current language's rules (Turkish: I -> ı, İ -> i). */
export function lowerCase(text) {
  return String(text).toLocaleLowerCase(current);
}

/** Upper case by the current language's rules (Turkish: i -> İ, ı -> I). */
export function upperCase(text) {
  return String(text).toLocaleUpperCase(current);
}

/** A number written the current language's way. */
export function formatNumber(value, options) {
  return new Intl.NumberFormat(current, options).format(value);
}
