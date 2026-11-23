// Game UI: which Firebase the page uses (src/ui/firebase-target.js, task 4.5a). Localhost keeps
// the local emulators; every other host (GitHub Pages) uses the real project. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, firebaseTarget } from '../src/ui/firebase-target.js';

test('firebase target: this machine uses the local emulators', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', '::1', 'LOCALHOST', ' localhost ']) {
    assert.equal(firebaseTarget(host), TARGETS.EMULATOR, host);
  }
});

test('firebase target: every other host uses the real project', () => {
  for (const host of [
    'malikfikret.github.io',
    'example.com',
    '192.168.1.20',
    '127.0.0.2',
    'localhost.example.com',
    'mylocalhost',
    '0.0.0.0',
  ]) {
    assert.equal(firebaseTarget(host), TARGETS.PRODUCTION, host);
  }
});

test('firebase target: missing or odd input is never treated as local', () => {
  for (const host of ['', null, undefined, 42, {}]) assert.equal(firebaseTarget(host), TARGETS.PRODUCTION);
});

test('firebase target: the two names are fixed', () => {
  assert.deepEqual({ ...TARGETS }, { EMULATOR: 'emulator', PRODUCTION: 'production' });
  assert.ok(Object.isFrozen(TARGETS));
});
