// Which Firebase the game talks to, decided from the page's hostname only (task 4.5a). Pure: no
// DOM, no Firebase; Node tests load it (tests/ui-firebase-target.test.js).
//
// - "emulator": the page is served from this machine (localhost, 127.0.0.1, [::1]): the local
//   Emulator Suite of the demo project, exactly as during development.
// - "production": anything else (GitHub Pages): the real Firebase project "son-cay".

/** The two targets. */
export const TARGETS = Object.freeze({ EMULATOR: 'emulator', PRODUCTION: 'production' });

// location.hostname gives "[::1]" for the IPv6 loopback; "::1" is accepted too.
const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * @param {string} hostname e.g. location.hostname
 * @returns {'emulator' | 'production'}
 */
export function firebaseTarget(hostname) {
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
  return LOCAL_HOSTS.includes(host) ? TARGETS.EMULATOR : TARGETS.PRODUCTION;
}
