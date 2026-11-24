// Hash routes of the game UI (pure, no DOM). Hash routes need no server configuration, so the
// same files work on GitHub Pages and on the dev server.
//
//   #/                    Giriş (home)
//   #/yeni                create a table
//   #/hakkinda            Hakkında (about)
//   #/nasil               Nasıl oynanır, tab Kurallar (how to play, decision Q73)
//   #/nasil/malzemeler    Nasıl oynanır, tab Malzemeler
//   #/masa/CODE           the table: the seat screen for a member, else "Masaya otur" (join).
//                         This is also the invite link.
//   #/masa/CODE/don       Yerine dön (recover my seat)
//
// Everything in the hash is untrusted input: a table code is used only after isValidRoomCode.

import { isValidRoomCode, normalizeRoomCode } from '../rooms/index.js';

export const ROUTES = Object.freeze({
  HOME: 'home',
  CREATE: 'create',
  ABOUT: 'about',
  HOW_TO: 'howTo',
  TABLE: 'table',
  RECOVER: 'recover',
  /** A hash that names a table with an invalid code (e.g. a mangled invite link). */
  BAD_CODE: 'badCode',
  /** Any other hash. */
  UNKNOWN: 'unknown',
});

const TABLE_SEGMENT = 'masa';
const RECOVER_SEGMENT = 'don';
const HOW_TO_SEGMENT = 'nasil';
const TOOLS_SEGMENT = 'malzemeler';

/** The tabs of Nasıl oynanır. */
export const HOW_TO_TABS = Object.freeze({ RULES: 'rules', TOOLS: 'tools' });

export const hashFor = Object.freeze({
  home: () => '#/',
  create: () => '#/yeni',
  about: () => '#/hakkinda',
  howTo: (tab = HOW_TO_TABS.RULES) => (tab === HOW_TO_TABS.TOOLS ? `#/${HOW_TO_SEGMENT}/${TOOLS_SEGMENT}` : `#/${HOW_TO_SEGMENT}`),
  table: (code) => `#/masa/${checkedCode(code)}`,
  recover: (code) => `#/masa/${checkedCode(code)}/${RECOVER_SEGMENT}`,
});

function checkedCode(code) {
  if (!isValidRoomCode(code)) throw new Error(`not a valid table code: ${String(code)}`);
  return code;
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Parses a location hash ("#/masa/ABC234", "", "#/hakkinda", ...).
 * A table code in the hash is accepted in lower case too (normalizeRoomCode) and is returned
 * only if it is a valid code.
 * @param {unknown} hash
 * @returns {{ name: string, code?: string }}
 */
export function parseRoute(hash) {
  if (typeof hash !== 'string') return { name: ROUTES.HOME };
  let path = hash.startsWith('#') ? hash.slice(1) : hash;
  // Ignore a query part and trailing slashes: "#/masa/ABC234/?x" is the table ABC234.
  const query = path.indexOf('?');
  if (query !== -1) path = path.slice(0, query);
  const parts = path.split('/').filter((part) => part !== '');
  if (parts.length === 0) return { name: ROUTES.HOME };

  if (parts.length === 1 && parts[0] === 'yeni') return { name: ROUTES.CREATE };
  if (parts.length === 1 && parts[0] === 'hakkinda') return { name: ROUTES.ABOUT };
  if (parts[0] === HOW_TO_SEGMENT && parts.length === 1) return { name: ROUTES.HOW_TO, tab: HOW_TO_TABS.RULES };
  if (parts[0] === HOW_TO_SEGMENT && parts.length === 2 && parts[1] === TOOLS_SEGMENT) {
    return { name: ROUTES.HOW_TO, tab: HOW_TO_TABS.TOOLS };
  }

  if (parts[0] === TABLE_SEGMENT && (parts.length === 2 || parts.length === 3)) {
    const raw = safeDecode(parts[1]);
    const code = raw === null ? null : normalizeRoomCode(raw);
    if (code === null) return { name: ROUTES.BAD_CODE };
    if (parts.length === 2) return { name: ROUTES.TABLE, code };
    if (parts[2] === RECOVER_SEGMENT) return { name: ROUTES.RECOVER, code };
  }
  if (parts[0] === TABLE_SEGMENT && parts.length === 1) return { name: ROUTES.BAD_CODE };
  return { name: ROUTES.UNKNOWN };
}

/**
 * The invite link of a table: the page address without query or hash, plus #/masa/CODE.
 * @param {string} pageHref the current page address (location.href)
 * @param {string} code a valid table code
 * @returns {string}
 */
export function inviteLink(pageHref, code) {
  const url = new URL(pageHref);
  url.search = '';
  url.hash = '';
  return `${url.href}${hashFor.table(code)}`;
}

/**
 * A table code from what a player typed or pasted: a bare code ("abc234", " ABC234 ") or a whole
 * invite link ("https://.../#/masa/ABC234"). Untrusted input.
 * @param {unknown} text
 * @returns {string | null} a valid table code, or null
 */
export function codeFromText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const hashAt = trimmed.indexOf('#');
  if (hashAt !== -1) {
    const route = parseRoute(trimmed.slice(hashAt));
    return route.code ?? null;
  }
  return normalizeRoomCode(trimmed);
}
