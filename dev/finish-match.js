// DEV ONLY: plays the running match of a table to its end on the LOCAL emulator, so the Tablo
// can be tried before the table screen exists. Not part of the game; never used by it.
//
// Usage (project root, emulators running):  node dev/finish-match.js CODE [seed]
//
// It reads rooms/CODE with the emulator's admin access (REST, "Authorization: Bearer owner",
// which only the emulator accepts), lets the engine play random legal moves (sometimes a
// timeout) for whoever the clock waits for, and writes what the room layer would write: the
// match node with one log entry per move, results/{n} (buildResult) and meta/status = "lobby".
// Refuses to run against anything but 127.0.0.1 and a demo- project.

import { applyAction, listLegalActions } from '../src/engine/index.js';
import { buildResult, isValidRoomCode } from '../src/rooms/index.js';

const PROJECT_ID = 'demo-mosul-roulette';
const HOST = '127.0.0.1';
const PORT = 9000;
if (!PROJECT_ID.startsWith('demo-')) throw new Error('demo- projects only');
const NS = `${PROJECT_ID}-default-rtdb`;

const code = String(process.argv[2] ?? '').trim().toUpperCase();
const seed = Number(process.argv[3] ?? Date.now()) >>> 0 || 1;
if (!isValidRoomCode(code)) {
  console.error('Usage: node dev/finish-match.js CODE [seed]   (CODE: the 6-character table code)');
  process.exit(1);
}

const url = (path) => `http://${HOST}:${PORT}/${path}.json?ns=${NS}`;
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const response = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

// A seeded random [0, 1) (xorshift), so a run can be repeated with the same seed.
let x = seed;
const random = () => {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 2 ** 32;
};

const room = await call('GET', `rooms/${code}`);
if (room === null) throw new Error(`no table ${code} on the emulator`);
if (room.meta?.status !== 'playing' || !room.match) throw new Error(`table ${code} has no running match`);

let state = JSON.parse(room.match.stateJson);
const log = { ...(room.match.log ?? {}) };
let seq = room.match.seq;
for (let i = 0; i < 10000 && state.status !== 'ended'; i += 1) {
  const pid = state.clock.playerId;
  const actions = pid ? listLegalActions(state, pid).filter((action) => action.type !== 'timeout') : [];
  const action = actions.length === 0 || random() < 0.15
    ? { type: 'timeout', seq: state.clock.seq }
    : actions[Math.floor(random() * actions.length)];
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`the engine refused ${JSON.stringify(action)}: ${result.error.code}`);
  state = result.state;
  seq += 1;
  log[seq] = JSON.stringify(result.events);
}
if (state.status !== 'ended') throw new Error('the match did not end');

const n = room.match.n;
await call('PATCH', `rooms/${code}`, {
  match: { n, seq, stateJson: JSON.stringify(state), log, clockAt: { '.sv': 'timestamp' } },
  [`results/${n}`]: buildResult(state, log, room.seats),
  'meta/status': 'lobby',
});
console.log(`Table ${code}: match ${n} finished after ${seq - room.match.seq} moves (seed ${seed}).`);
