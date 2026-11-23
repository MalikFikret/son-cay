// Firebase wiring of the game UI: the ONE place that knows which Firebase the game talks to, and
// the ONLY file in the repository with the real project's web config (task 4.5a).
//
// The target comes from the page's hostname (src/ui/firebase-target.js):
// - "emulator" (localhost, 127.0.0.1, [::1]): the local Emulator Suite of the demo project
//   demo-mosul-roulette, exactly as during development: auth on 127.0.0.1:9099, database on
//   127.0.0.1:9000, sign-in kept per tab (several tabs = several players).
// - "production" (any other host, e.g. GitHub Pages): the real project "son-cay", its Realtime
//   Database in europe-west1, sign-in kept per browser (local persistence).
//
// A Firebase web config (apiKey included) is a public identifier of the project, not a secret:
// the data is protected by the security rules (database.rules.json) and the API key is restricted
// to the site's domain. With no build step it lives here and nowhere else (not in .env, docs or
// tests). Tests never use it: they run only on the emulators.
//
// The official Firebase JS SDK is loaded from the gstatic CDN (same version as the npm
// devDependency used by the tests). Nothing in src/ui/ imports the npm "firebase" package. The
// hosts each target contacts are allowed by the Content-Security-Policy in index.html.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  browserLocalPersistence,
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
import { TARGETS, firebaseTarget } from './firebase-target.js';

// --- Target ----------------------------------------------------------------------------------

/** Which Firebase this page uses: 'emulator' on this machine, 'production' anywhere else. */
export const TARGET = firebaseTarget(globalThis.location?.hostname);
const IS_EMULATOR = TARGET === TARGETS.EMULATOR;

// --- Emulator (localhost): unchanged since the first game screens ----------------------------
const EMULATOR_PROJECT_ID = 'demo-mosul-roulette';
const EMULATOR_HOST = '127.0.0.1';
const AUTH_EMULATOR_PORT = 9099;
const DATABASE_EMULATOR_PORT = 9000;
// The Firebase CLI applies database.rules.json to the default instance of the demo project.
const EMULATOR_DATABASE_URL = `http://${EMULATOR_HOST}:${DATABASE_EMULATOR_PORT}?ns=${EMULATOR_PROJECT_ID}-default-rtdb`;
const EMULATOR_CONFIG = {
  projectId: EMULATOR_PROJECT_ID,
  // The auth emulator needs some API key; this placeholder is not a real key.
  apiKey: 'demo-api-key-for-the-emulator',
  databaseURL: EMULATOR_DATABASE_URL,
};

// --- Production (GitHub Pages): the real project "son-cay" -----------------------------------
const PRODUCTION_PROJECT_ID = 'son-cay';
const PRODUCTION_DATABASE_URL = 'https://son-cay-default-rtdb.europe-west1.firebasedatabase.app';
// The web app "son-cay-web" as registered in the Firebase console (a public identifier).
const PRODUCTION_CONFIG = {
  apiKey: 'AIzaSyDlr2Ve4ML76dCdl3GGFn2pe_Us-e5ow4U',
  authDomain: 'son-cay.firebaseapp.com',
  databaseURL: 'https://son-cay-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'son-cay',
  storageBucket: 'son-cay.firebasestorage.app',
  messagingSenderId: '936459764502',
  appId: '1:936459764502:web:a4fc745a8ac53e670d0637',
};

const FIREBASE_CONFIG = IS_EMULATOR ? EMULATOR_CONFIG : PRODUCTION_CONFIG;
const DATABASE_URL = IS_EMULATOR ? EMULATOR_DATABASE_URL : PRODUCTION_DATABASE_URL;

// Guard: the emulator target must use a demo- project (which can never reach a real project), and
// production must use exactly the real project and its database. Anything else stops the game.
if (IS_EMULATOR) {
  if (typeof FIREBASE_CONFIG.projectId !== 'string' || !FIREBASE_CONFIG.projectId.startsWith('demo-')) {
    throw new Error('On localhost the game only runs against a demo- project on the local emulators');
  }
} else if (FIREBASE_CONFIG.projectId !== PRODUCTION_PROJECT_ID || FIREBASE_CONFIG.databaseURL !== PRODUCTION_DATABASE_URL) {
  throw new Error(`Outside localhost the game only runs against the Firebase project ${PRODUCTION_PROJECT_ID} and its database ${PRODUCTION_DATABASE_URL}`);
}

// Anonymous sign-in: per TAB on the emulators (several tabs of one browser are several players,
// a refresh keeps the player); per BROWSER in production (one player per browser, kept after
// closing the tab).
const AUTH_PERSISTENCE = IS_EMULATOR ? browserSessionPersistence : browserLocalPersistence;

/**
 * Whether the remembered table code lives per tab (sessionStorage) or per browser
 * (localStorage). It must match AUTH_PERSISTENCE: the code is only useful to the same user.
 */
export const REMEMBER_PER_TAB = IS_EMULATOR;

// --- Wiring ----------------------------------------------------------------------------------

/**
 * Starts Firebase, signs in anonymously (or restores the remembered user) and returns the room API.
 * @returns {Promise<{ api: ReturnType<typeof createRoomApi>, uid: string,
 *   watchServerOffset: (onChange: (offset: number) => void) => () => void }>}
 */
export async function connect() {
  // WebSocket only (both targets): after one failed WebSocket the SDK would otherwise fall back
  // to long-polling, which loads <script> tags from the database host, and the CSP (script-src
  // 'self' + gstatic) blocks those. The SDK keeps retrying the WebSocket instead.
  forceWebSockets();
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = initializeAuth(app, { persistence: AUTH_PERSISTENCE });
  if (IS_EMULATOR) connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
  const db = getDatabase(app, DATABASE_URL);
  if (IS_EMULATOR) connectDatabaseEmulator(db, EMULATOR_HOST, DATABASE_EMULATOR_PORT);

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
