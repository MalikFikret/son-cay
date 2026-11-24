// Game UI: the sounds (step 4.4c, decisions Q52, Q76, Q77, Q78). The settings part: the five
// per-sound switches (defaults, bad values), the master switch blocking every sound, a sound's own
// switch blocking only that sound, and the browser rules (no context before a gesture, a suspended
// or missing Web Audio means silence, never an error; a switch turned off stops a sound at once).
// The two audio files (Q78): loaded and decoded once, a failed load or decode is silent, a doubled
// shot (Çift Ateş) plays twice and a normal one once, shapeClip's trimming and fades, and the
// files themselves (small MP3s the trimming tool can parse).
// The AudioContext, fetch and decode are mocks; the waveforms are not tested.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, SOUND_IDS, SOUND_KEYS, getSettings, parseSettings, resetSettingsCache,
  setSetting, soundAllowed,
} from '../src/ui/device-settings.js';
import { readFileSync, statSync } from 'node:fs';
import {
  CLIP_IDS, CLIP_SHAPES, CLIP_URLS, DOUBLE_GAP_MS, HAMMER_TICK_MS, createSoundEngine, shapeClip,
} from '../src/ui/sounds.js';
import { CLIPS, trimMp3 } from '../tools/audio-trim.js';
import tr from '../src/ui/i18n/tr.js';
import en from '../src/ui/i18n/en.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** A minimal Web Audio mock: every node connects; sources record start / stop. */
function mockAudio({ state = 'running' } = {}) {
  const log = { contexts: 0, started: 0, stopped: 0, resumed: 0, decoded: 0, starts: [] };
  const param = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const source = (extra) => node({
    started: false,
    start(at = 0) { this.started = true; log.started += 1; if (this.buffer?.clip) log.starts.push(at); },
    stop() { if (this.started && !this.done) { this.done = true; log.stopped += 1; } },
    ...extra,
  });
  class FakeContext {
    constructor() {
      log.contexts += 1;
      this.state = state;
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.destination = node();
    }
    resume() { log.resumed += 1; this.state = 'running'; return Promise.resolve(); }
    createGain() { return node({ gain: param() }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createBiquadFilter() { return node({ frequency: param(), Q: param(), type: '' }); }
    createWaveShaper() { return node({ curve: null }); }
    createConvolver() { return node({ buffer: null }); }
    createBuffer(channels, length, rate = 8000) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      // A mono buffer of 2..1000 samples can only be a shaped clip (not the unlock blip or the noise).
      const clip = channels === 1 && length > 1 && length <= 1000;
      return { numberOfChannels: channels, sampleRate: rate, duration: length / rate, clip, getChannelData: (ch) => data[ch] };
    }
    // A "file" decodes to one stereo click; bytes [0] mean a broken file.
    decodeAudioData(bytes) {
      log.decoded += 1;
      if (bytes.byteLength === 1) return Promise.reject(new Error('EncodingError'));
      const buffer = this.createBuffer(2, 800);
      for (let ch = 0; ch < 2; ch += 1) buffer.getChannelData(ch).fill(0.5, 100, 400);
      return Promise.resolve(buffer);
    }
    createBufferSource() { return source({ buffer: null }); }
    createOscillator() { return source({ frequency: param(), type: '' }); }
  }
  return { FakeContext, log };
}

/** Lets the file loads (promises) finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** An engine on the mock, with manual timers; `load` gives a file's bytes (default: fine). */
function engineFor({ state, allowed, noAudio = false, load } = {}) {
  const audio = mockAudio({ state });
  const intervals = new Map();
  const loads = [];
  let next = 1;
  const engine = createSoundEngine({
    loadClip: (id) => {
      loads.push(id);
      return load ? load(id) : Promise.resolve(new ArrayBuffer(16));
    },
    audioContextClass: () => (noAudio ? undefined : audio.FakeContext),
    allowed: allowed ?? ((id) => soundAllowed(id)),
    setTimeout: () => next++,
    clearTimeout: () => {},
    setInterval: (fn) => { const id = next++; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    random: () => 0.5,
  });
  return { engine, audio, intervals, loads };
}

/** An unlocked engine whose files are loaded. */
async function readyEngine(options) {
  const made = engineFor(options);
  made.engine.unlock();
  await settle();
  return made;
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  resetSettingsCache();
});

afterEach(() => {
  delete globalThis.localStorage;
  resetSettingsCache();
});

describe('sound settings', () => {
  test('defaults: the master and all five sounds on', () => {
    assert.deepEqual([...SOUND_IDS], ['empty', 'loaded', 'reload', 'turn', 'hammer']);
    for (const id of SOUND_IDS) {
      assert.equal(DEFAULT_SETTINGS[SOUND_KEYS[id]], true, id);
      assert.equal(soundAllowed(id), true, id);
    }
    assert.equal(getSettings().sound, true);
  });

  test('bad or missing values fall back to on; the other fields keep their stored values', () => {
    const parsed = parseSettings(JSON.stringify({
      revolver: 'cowboy', motion: false, sound: false,
      soundEmpty: 'no', soundLoaded: 0, soundReload: null, soundTurn: false,
    }));
    assert.equal(parsed.revolver, 'cowboy');
    assert.equal(parsed.motion, false);
    assert.equal(parsed.sound, false);
    assert.equal(parsed.soundEmpty, true);
    assert.equal(parsed.soundLoaded, true);
    assert.equal(parsed.soundReload, true);
    assert.equal(parsed.soundTurn, false);
    assert.equal(parsed.soundHammer, true, 'missing');
    assert.deepEqual({ ...parseSettings('{broken') }, { ...DEFAULT_SETTINGS });
    assert.equal(setSetting('soundTurn', 'off'), false, 'invalid value refused');
    assert.equal(setSetting('soundBang', false), false, 'unknown key refused');
  });

  test('a sound switch is stored in the same settings object', () => {
    assert.equal(setSetting('soundReload', false), true);
    const stored = JSON.parse(globalThis.localStorage.data.get(SETTINGS_KEY));
    assert.equal(stored.soundReload, false);
    assert.equal(stored.revolver, DEFAULT_SETTINGS.revolver);
    resetSettingsCache();
    assert.equal(getSettings().soundReload, false, 'read back after a reload');
  });

  test('the master off blocks every sound', async () => {
    setSetting('sound', false);
    for (const id of SOUND_IDS) assert.equal(soundAllowed(id), false, id);
    const { engine, audio } = await readyEngine();
    for (const id of SOUND_IDS) assert.equal(engine.play(id), false, id);
    assert.equal(engine.startHammer(), false);
    assert.equal(audio.log.started, 1, 'only the silent unlock blip');
  });

  test('a sound off blocks only that sound', async () => {
    for (const off of SOUND_IDS) {
      resetSettingsCache();
      globalThis.localStorage = fakeStorage();
      setSetting(SOUND_KEYS[off], false);
      for (const id of SOUND_IDS) assert.equal(soundAllowed(id), id !== off, `${off} off, ${id}`);
      const { engine } = await readyEngine();
      for (const id of SOUND_IDS) assert.equal(engine.play(id), id !== off, `${off} off, play ${id}`);
    }
  });

  test('an unknown sound never plays', () => {
    assert.equal(soundAllowed('constructor'), false);
    const { engine } = engineFor();
    engine.unlock();
    assert.equal(engine.play('constructor'), false);
  });
});

describe('sound engine (mock Web Audio)', () => {
  test('nothing plays before a gesture; one shared context after it', async () => {
    const { engine, audio } = engineFor();
    assert.equal(engine.play('loaded'), false);
    assert.equal(audio.log.contexts, 0);
    engine.unlock();
    engine.unlock();
    await settle();
    assert.equal(audio.log.contexts, 1);
    assert.equal(engine.play('loaded'), true);
    assert.equal(engine.play('reload', { count: 6 }), true);
  });

  test('a suspended context is resumed on the gesture and plays nothing meanwhile', () => {
    const { engine, audio } = engineFor({ state: 'suspended' });
    const ctxState = { resumedBefore: audio.log.resumed };
    engine.unlock();
    assert.equal(audio.log.resumed, ctxState.resumedBefore + 1);
    // The mock resumes at once; a still-suspended context is silence, not an error.
    const stuck = engineFor({ state: 'suspended' });
    stuck.audio.FakeContext.prototype.resume = function resume() { return Promise.reject(new Error('no')); };
    stuck.engine.unlock();
    assert.equal(stuck.engine.play('turn'), false);
  });

  test('no Web Audio: silence, never an error', () => {
    const { engine } = engineFor({ noAudio: true });
    assert.equal(engine.unlock(), false);
    for (const id of SOUND_IDS) assert.equal(engine.play(id), false);
    assert.equal(engine.startHammer(), false);
    assert.doesNotThrow(() => engine.stopHammer());
  });

  test('a throwing context constructor is swallowed', () => {
    const engine = createSoundEngine({ audioContextClass: () => function Broken() { throw new Error('x'); } });
    assert.equal(engine.unlock(), false);
    assert.equal(engine.play('empty'), false);
  });

  test('the master turned off mid-sound stops everything at once', async () => {
    const { engine, audio } = await readyEngine();
    engine.play('loaded');
    engine.play('reload');
    engine.startHammer();
    assert.ok(engine.active('loaded') > 0 && engine.active('reload') > 0 && engine.hammerRunning());
    setSetting('sound', false);
    engine.enforce();
    for (const id of SOUND_IDS) assert.equal(engine.active(id), 0, id);
    assert.equal(engine.hammerRunning(), false);
    assert.ok(audio.log.stopped > 0);
  });

  test('one switch turned off stops only that sound', async () => {
    const { engine } = await readyEngine();
    engine.play('loaded');
    engine.play('turn');
    setSetting('soundLoaded', false);
    engine.enforce();
    assert.equal(engine.active('loaded'), 0);
    assert.equal(engine.active('turn'), 1);
  });

  test('hammer: the cock, ticks while pressed, everything stops at once on release', () => {
    const { engine, intervals } = engineFor();
    engine.unlock();
    assert.equal(engine.startHammer(), true);
    assert.equal(intervals.size, 1);
    assert.ok(HAMMER_TICK_MS > 50 && HAMMER_TICK_MS < 200);
    for (const fn of intervals.values()) { fn(); fn(); }
    assert.equal(engine.active('hammer'), 3, 'the cock and two ticks');
    engine.stopHammer();
    assert.equal(intervals.size, 0);
    assert.equal(engine.active('hammer'), 0);
  });

  test('hammer switch off while pressing stops the ticks', () => {
    const { engine, intervals } = engineFor();
    engine.unlock();
    engine.startHammer();
    setSetting('soundHammer', false);
    engine.enforce();
    assert.equal(intervals.size, 0);
    assert.equal(engine.hammerRunning(), false);
  });
});

describe('the shot sounds are files (Q78)', () => {
  test('both files load and decode once, after the gesture', async () => {
    const { engine, audio, loads } = engineFor();
    assert.deepEqual(loads, [], 'nothing before the gesture');
    engine.unlock();
    engine.unlock();
    await settle();
    engine.unlock();
    assert.deepEqual([...loads].sort(), [...CLIP_IDS].sort());
    assert.equal(audio.log.decoded, 2);
    for (const id of CLIP_IDS) assert.equal(engine.clipState(id), 'ready');
    assert.equal(engine.play('loaded'), true);
    assert.equal(engine.play('empty'), true);
    await settle();
    assert.equal(loads.length, 2, 'playing loads nothing again');
  });

  test('a play before the files are ready is dropped, not queued', async () => {
    const { engine, audio } = engineFor();
    engine.unlock();
    assert.equal(engine.play('loaded'), false, 'still loading');
    await settle();
    assert.equal(audio.log.starts.length, 0, 'nothing started later');
    assert.equal(engine.play('loaded'), true);
  });

  test('a failed fetch or decode makes that sound silent, never an error', async () => {
    const { engine, loads } = await readyEngine({
      load: (id) => (id === 'loaded' ? Promise.reject(new Error('404')) : Promise.resolve(new ArrayBuffer(1))),
    });
    assert.equal(engine.clipState('loaded'), 'failed');
    assert.equal(engine.clipState('empty'), 'failed', 'decode refused');
    assert.doesNotThrow(() => engine.play('loaded'));
    assert.equal(engine.play('loaded'), false);
    assert.equal(engine.play('empty'), false);
    assert.equal(engine.play('turn'), true, 'the synthesized sounds still play');
    await settle();
    assert.equal(loads.length, 2, 'a failed file is not fetched again and again');
    const throwing = await readyEngine({ load: () => { throw new Error('no fetch'); } });
    assert.equal(throwing.engine.play('empty'), false);
  });

  test('the switches gate both file sounds', async () => {
    const { engine } = await readyEngine();
    setSetting('soundLoaded', false);
    assert.equal(engine.play('loaded'), false);
    assert.equal(engine.play('empty'), true);
    setSetting('soundEmpty', false);
    assert.equal(engine.play('empty'), false);
    setSetting('soundLoaded', true);
    setSetting('soundEmpty', true);
    setSetting('sound', false);
    assert.equal(engine.play('loaded', { times: 2 }), false);
    assert.equal(engine.play('empty'), false);
  });

  test('a doubled shot plays its sound twice, DOUBLE_GAP_MS apart; a normal shot once', async () => {
    assert.ok(DOUBLE_GAP_MS >= 150 && DOUBLE_GAP_MS <= 200);
    for (const id of CLIP_IDS) {
      const { engine, audio } = await readyEngine();
      engine.play(id);
      assert.equal(audio.log.starts.length, 1, `${id} once`);
      engine.play(id, { times: 2 });
      const [, first, second] = audio.log.starts;
      assert.equal(audio.log.starts.length, 3, `${id} twice`);
      assert.ok(Math.abs(second - first - DOUBLE_GAP_MS / 1000) < 1e-9, `${id} gap`);
    }
  });

  test('shapeClip: mono, silence trimmed, at most maxSeconds, fades at both ends', () => {
    const rate = 1000;
    const left = new Float32Array(2000);
    const right = new Float32Array(2000);
    left.fill(1, 300, 1800);
    right.fill(0.6, 300, 1800);
    const out = shapeClip([left, right], rate, { maxSeconds: 0.6, fadeSeconds: 0.1, threshold: 0.02 });
    assert.equal(out.length, 600, 'from the first sound (minus 2 ms), 0.6 s');
    assert.equal(out[0], 0, 'fade-in from silence');
    assert.ok(Math.abs(out[300] - 0.8) < 1e-6, 'the channels averaged');
    assert.equal(out[out.length - 1], 0, 'faded out');
    assert.ok(out[out.length - 50] < 0.8 && out[out.length - 50] > 0, 'inside the fade');
    const whole = shapeClip([left], rate, { maxSeconds: null, fadeSeconds: 0.01, threshold: 0.02 });
    assert.equal(whole.length, 1500 + 2 + 10, 'trailing silence trimmed, fade kept');
    assert.equal(shapeClip([new Float32Array(100)], rate, CLIP_SHAPES.loaded).length, 0, 'all silence');
    assert.equal(shapeClip([], rate, CLIP_SHAPES.empty).length, 0);
  });

  test('the processed files: small MPEG audio, the lengths the shapes need', () => {
    for (const { out, keepSeconds } of CLIPS) {
      const path = new URL(`../${out}`, import.meta.url);
      assert.ok(statSync(path).size < 50 * 1024, `${out} under 50 KB`);
      const parsed = trimMp3(new Uint8Array(readFileSync(path)), null);
      assert.ok(parsed.frames > 0, `${out} has audio frames`);
      if (keepSeconds !== null) assert.ok(parsed.seconds >= keepSeconds, `${out} long enough`);
    }
    assert.ok(CLIP_URLS.loaded.endsWith('/src/ui/audio/shot-loaded.mp3'));
    assert.ok(CLIP_URLS.empty.endsWith('/src/ui/audio/shot-empty.mp3'));
    assert.equal(CLIP_SHAPES.loaded.maxSeconds, 0.6);
  });
});

describe('sound texts', () => {
  test('labels in both languages', () => {
    assert.deepEqual({ ...tr.deviceSettings.soundNames }, {
      empty: 'Boş mermi', loaded: 'Dolu mermi', reload: 'Doldurma', turn: 'Sıra sende', hammer: 'Horoz',
    });
    assert.deepEqual({ ...en.deviceSettings.soundNames }, {
      empty: 'Empty shot', loaded: 'Loaded shot', reload: 'Reload', turn: 'Your turn', hammer: 'Hammer',
    });
    assert.equal(tr.deviceSettings.soundsTitle, 'Sesler');
    assert.equal(en.deviceSettings.soundsTitle, 'Sounds');
  });
});
