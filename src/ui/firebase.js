// Firebase wiring of the game UI: the ONE place that knows which Firebase the game talks to.
// The later "real Firebase" step changes this file only (plus the Content-Security-Policy in
// index.html, see CLAUDE.md).
//
// The official Firebase JS SDK is loaded from the gstatic CDN (same version as the npm
// devDependency used by the tests). Nothing in src/ui/ imports the npm "firebase" package.
//
// For now the game connects ONLY to the local emulators of the demo project: no real project,
// no keys, no secrets.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  connectDatabaseEmulator,
  forceWebSockets,
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  update,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js';
import { createRoomApi } from '../rooms/index.js';

// --- Configuration ---------------------------------------------------------------------------
const PROJECT_ID = 'demo-mosul-roulette';
const EMULATOR_HOST = '127.0.0.1';
const AUTH_EMULATOR_PORT = 9099;
const DATABASE_EMULATOR_PORT = 9000;
// The Firebase CLI applies database.rules.json to the default instance of the demo project.
const DATABASE_URL = `http://${EMULATOR_HOST}:${DATABASE_EMULATOR_PORT}?ns=${PROJECT_ID}-default-rtdb`;

// Anonymous sign-in is kept per TAB (session persistence): on the emulators several tabs of
// one browser are several players, and a refresh keeps the player.
// TODO(real Firebase): production uses browserLocalPersistence (one player per browser, kept
// after closing the tab); switch REMEMBER_PER_TAB below to false at the same time.
const AUTH_PERSISTENCE = browserSessionPersistence;

/**
 * Whether the remembered table code lives per tab (sessionStorage) or per browser
 * (localStorage). It must match AUTH_PERSISTENCE: the code is only useful to the same user.
 */
export const REMEMBER_PER_TAB = true;

if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error('The game only runs against a demo- project on the local emulators for now');
}

const FIREBASE_CONFIG = {
  projectId: PROJECT_ID,
  // The auth emulator needs some API key; this placeholder is not a real key.
  apiKey: 'demo-api-key-for-the-emulator',
  databaseURL: DATABASE_URL,
};

// --- Wiring ----------------------------------------------------------------------------------

/**
 * Starts Firebase, signs in anonymously (or restores this tab's user) and returns the room API.
 * @returns {Promise<{ api: ReturnType<typeof createRoomApi>, uid: string,
 *   watchServerOffset: (onChange: (offset: number) => void) => () => void }>}
 */
export async function connect() {
  // WebSocket only: after one failed WebSocket the SDK would otherwise fall back to
  // long-polling, which loads <script> tags from the database host, and the CSP (script-src
  // 'self' + gstatic) blocks those. The SDK keeps retrying the WebSocket instead.
  forceWebSockets();
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = initializeAuth(app, { persistence: AUTH_PERSISTENCE });
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
  const db = getDatabase(app, DATABASE_URL);
  connectDatabaseEmulator(db, EMULATOR_HOST, DATABASE_EMULATOR_PORT);

  await auth.authStateReady();
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  const api = createRoomApi({ db, ref, get, update, serverTimestamp, onValue, onDisconnect, runTransaction });
  // The server clock offset (server time = local time + offset), for the table's countdown.
  // Reads only; returns the function that stops listening.
  const watchServerOffset = (onChange) => onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
    onChange(Number(snapshot.val()) || 0);
  });
  return { api, uid: user.uid, watchServerOffset };
}
