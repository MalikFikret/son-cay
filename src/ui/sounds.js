// The game's five sounds (step 4.4c, decisions Q52, Q76, Q77, Q78), all played through ONE shared
// Web Audio context. No library.
//
// Two are AUDIO FILES (decision Q78; CC0, credited in README.md), made by tools/audio-trim.js:
// - loaded (src/ui/audio/shot-loaded.mp3): "Heathers Gunshot Effect2" by okieactor (Freesound
//   415912), its first 0.6 s with a short fade-out.
// - empty (src/ui/audio/shot-empty.mp3): "Empty Gun Shot" by KlawyKogut (Freesound 154934),
//   trimmed of silence.
// They are fetched and decoded once, after the first gesture (or lazily on the first play), then
// shaped in code (shapeClip: mono, silence, exact length, fade). A file that fails to load or
// decode makes that sound silent, never an error. A doubled shot (Çift Ateş) plays twice,
// DOUBLE_GAP_MS apart.
//
// Three are SYNTHESIZED (oscillators, filtered noise, gain envelopes):
// - reload: the Mermi pushed into the cylinder one by one, the cylinder closed and spun.
// - turn: a short two-note chime when the turn becomes this player's.
// - hammer (decision Q76, redesigned to stand apart from reload): a heavy two-stage cock,
//   "click-CLACK" (a light, high sear click, then 75 ms later a low, resonant clack), then soft,
//   low, muffled ratchet ticks under the thumb, one per chamber of the spin at a steady rate,
//   while the finger stays down (startHammer / stopHammer). Reload is the opposite: bright,
//   metallic ticks around 2.5-3.8 kHz in an irregular, accelerating / slowing rhythm.
//
// Who hears what is decided by the table (screens/table.js); this module only plays. A sound plays
// only while the "Ses" master switch AND its own switch are on (soundAllowed, device-settings.js);
// a switch turned off silences that sound at once, the master silences everything at once, even
// in the middle of a sound.
//
// Browser rules: ONE shared AudioContext, created or resumed only inside a user gesture (the first
// tap or key press anywhere; initSounds listens for them). A suspended or missing context, or a
// browser without Web Audio, means silence, never an error. Nothing is queued: a sound that cannot
// play now is dropped.
//
// createSoundEngine() takes its dependencies (the AudioContext class, the switch check, the
// file loader, the timers), so Node tests run it with a mock context; the module's default engine
// uses the browser's and device-settings.js.

import { SOUND_IDS, onSettingsChange, soundAllowed } from './device-settings.js';
import { SPIN_TURN_MS } from './press-signal.js';

/** One ratchet tick per chamber while the revolver spins (six chambers per turn). */
export const HAMMER_TICK_MS = Math.round(SPIN_TURN_MS / 6);
/** The first tick comes after the clack has rung out (seconds after the cock starts). */
const HAMMER_FIRST_TICK = 0.24;

const SILENT = 0.0001; // exponential ramps cannot reach 0

// Each sound's output level, measured offline so the gunshot is the loudest, the clicks clear but
// smaller, and the chime soft (narrow band-passed noise loses most of its energy, hence > 1).
const LEVELS = Object.freeze({ empty: 1.0, loaded: 2.6, reload: 1.0, turn: 1.0, hammer: 1.2 });

/** The sounds that are audio files, and where they are (next to this module). */
export const CLIP_IDS = Object.freeze(['loaded', 'empty']);
export const CLIP_URLS = Object.freeze({
  loaded: new URL('./audio/shot-loaded.mp3', import.meta.url).href,
  empty: new URL('./audio/shot-empty.mp3', import.meta.url).href,
});

/**
 * How each file is shaped after decoding (tools/audio-trim.js keeps a little more than this).
 * maxSeconds: the length after the leading silence (null = all); fadeSeconds: the fade-out at the
 * end; threshold: what counts as sound when trimming the silence at both ends.
 */
export const CLIP_SHAPES = Object.freeze({
  loaded: Object.freeze({ maxSeconds: 0.6, fadeSeconds: 0.08, threshold: 0.02 }),
  empty: Object.freeze({ maxSeconds: null, fadeSeconds: 0.015, threshold: 0.02 }),
});

/** Çift Ateş: the second shot sound starts this long after the first. */
export const DOUBLE_GAP_MS = 180;
const DOUBLE_LEVEL = 0.72; // the doubled pair, measured offline to stay below clipping
const DOUBLE_SECOND_LEVEL = 0.85; // the second shot of the pair

const FADE_IN_SECONDS = 0.002; // no click where the leading silence was cut
const KEEP_BEFORE_SECONDS = 0.002; // a hair of the silence before the attack
const TAIL_THRESHOLD = 0.004; // the trailing silence is trimmed below this (keeps the room tail)

/**
 * Shapes decoded audio into one mono channel (pure): the channels averaged, the leading silence
 * cut (below `threshold`), at most `maxSeconds` kept, the trailing silence cut, a 2 ms fade-in
 * and a `fadeSeconds` fade-out. Empty input, or input that never reaches the threshold, gives an
 * empty array.
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {{ maxSeconds: number|null, fadeSeconds: number, threshold: number }} shape
 * @returns {Float32Array}
 */
export function shapeClip(channels, sampleRate, { maxSeconds, fadeSeconds, threshold }) {
  const length = channels.length > 0 ? Math.min(...channels.map((ch) => ch.length)) : 0;
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i += 1) mono[i] += ch[i] / channels.length;
  let start = 0;
  while (start < length && Math.abs(mono[start]) < threshold) start += 1;
  if (start >= length) return new Float32Array(0);
  start = Math.max(0, start - Math.round(KEEP_BEFORE_SECONDS * sampleRate));
  let end = length;
  if (maxSeconds !== null) end = Math.min(end, start + Math.round(maxSeconds * sampleRate));
  let last = end - 1;
  while (last > start && Math.abs(mono[last]) < Math.min(threshold, TAIL_THRESHOLD)) last -= 1;
  end = Math.min(end, last + 1 + Math.round(fadeSeconds * sampleRate));
  const out = mono.slice(start, end);
  const fadeIn = Math.min(out.length, Math.round(FADE_IN_SECONDS * sampleRate));
  for (let i = 0; i < fadeIn; i += 1) out[i] *= i / fadeIn;
  const fadeOut = Math.min(out.length, Math.round(fadeSeconds * sampleRate));
  for (let i = 0; i < fadeOut; i += 1) out[out.length - 1 - i] *= i / fadeOut;
  return out;
}

/** The browser's loader: the file's bytes, or a rejection. */
async function fetchBytes(url) {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new Error(`audio ${response.status}`);
  return response.arrayBuffer();
}

/**
 * @param {object} [deps]
 * @param {() => (Function|null|undefined)} [deps.audioContextClass] the AudioContext constructor
 * @param {(id: string) => boolean} [deps.allowed] whether a sound may play now
 * @param {Function} [deps.setTimeout] @param {Function} [deps.clearTimeout]
 * @param {Function} [deps.setInterval] @param {Function} [deps.clearInterval]
 * @param {() => number} [deps.random]
 * @param {(id: string) => Promise<ArrayBuffer>} [deps.loadClip] a file's bytes (CLIP_IDS)
 */
export function createSoundEngine({
  audioContextClass = () => globalThis.AudioContext ?? globalThis.webkitAudioContext,
  allowed = (id) => soundAllowed(id),
  setTimeout: setT = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: clearT = (id) => globalThis.clearTimeout(id),
  setInterval: setI = (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: clearI = (id) => globalThis.clearInterval(id),
  random = Math.random,
  loadClip = (id) => fetchBytes(CLIP_URLS[id]),
} = {}) {
  let ctx = null;
  const clips = new Map(); // id -> { state: 'loading' | 'ready' | 'failed', buffer }
  let master = null;
  let noiseBuffer = null;
  let roomBuffer = null;
  let ticker = null;
  const voices = new Map(SOUND_IDS.map((id) => [id, new Set()]));

  // --- The context ---------------------------------------------------------------------------
  /** Inside a user gesture: create the context (once) or resume it. Never throws. */
  function unlock() {
    try {
      if (!ctx) {
        const Ctor = audioContextClass();
        if (typeof Ctor !== 'function') return false;
        ctx = new Ctor({ latencyHint: 'interactive' });
        buildMaster();
        // iOS unlocks the output only after something starts inside the gesture.
        const blip = ctx.createBufferSource();
        blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
        blip.connect(ctx.destination);
        blip.start(0);
      }
      loadClips();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const result = ctx.resume();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
      return true;
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }

  function buildMaster() {
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    setParam(comp.threshold, -8);
    setParam(comp.knee, 8);
    setParam(comp.ratio, 4);
    setParam(comp.attack, 0.002);
    setParam(comp.release, 0.18);
    gain.connect(comp);
    comp.connect(ctx.destination);
    master = gain;
  }

  const ready = () => ctx !== null && master !== null && ctx.state === 'running';

  // --- Building blocks -------------------------------------------------------------------------
  function setParam(param, value) {
    if (param && typeof param === 'object') param.value = value;
  }

  /** A gain envelope: silence, linear attack to `peak`, exponential decay to silence. */
  function envelope(param, t, peak, attack, decay) {
    param.setValueAtTime(SILENT, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(SILENT, t + attack + decay);
  }

  function noise() {
    if (!noiseBuffer) {
      const rate = ctx.sampleRate || 44100;
      noiseBuffer = ctx.createBuffer(1, rate * 2, rate); // 2 s: room for a random start
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = random() * 2 - 1;
    }
    return noiseBuffer;
  }

  /** A short generated room response (decaying stereo noise) for the shot's and chime's tails. */
  function room() {
    if (!roomBuffer) {
      const rate = ctx.sampleRate || 44100;
      const length = Math.floor(rate * 0.9);
      roomBuffer = ctx.createBuffer(2, length, rate);
      for (let ch = 0; ch < 2; ch += 1) {
        const data = roomBuffer.getChannelData(ch);
        for (let i = 0; i < length; i += 1) {
          const x = i / length;
          // Early reflections, then a smooth tail.
          data[i] = (random() * 2 - 1) * (1 - x) ** 3.2 * (i < rate * 0.012 ? 0.4 : 1);
        }
      }
    }
    return roomBuffer;
  }

  /** A voice: everything one sound plays, behind one gain, so it can be stopped at once. */
  function voice(id) {
    const out = ctx.createGain();
    out.gain.value = LEVELS[id];
    out.connect(master);
    const item = { id, out, sources: [], timer: null };
    voices.get(id).add(item);
    return item;
  }

  function finish(item, seconds) {
    item.timer = setT(() => release(item), Math.ceil(seconds * 1000) + 120);
  }

  function release(item) {
    if (!voices.get(item.id).delete(item)) return;
    if (item.timer !== null) clearT(item.timer);
    for (const source of item.sources) {
      try {
        source.stop();
      } catch {
        // Not started yet or already stopped.
      }
    }
    try {
      item.out.gain.cancelScheduledValues?.(0);
      item.out.gain.value = 0;
      item.out.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  /** A noise burst through a filter into `dest`, with an envelope. */
  function burst(item, dest, t, { type = 'bandpass', freq, q = 1, peak, attack = 0.001, decay, sweepTo = null }) {
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    setParam(filter.Q, q);
    const gain = ctx.createGain();
    envelope(gain.gain, t, peak, attack, decay);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    const length = attack + decay + 0.02;
    src.start(t, random() * 0.8, length);
    src.stop(t + length);
    item.sources.push(src);
  }

  /** An oscillator note, optionally gliding to `glideTo`, with an envelope. */
  function tone(item, dest, t, { type = 'sine', freq, glideTo = null, glide = 0.1, peak, attack = 0.002, decay }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo !== null) osc.frequency.exponentialRampToValueAtTime(glideTo, t + glide);
    const gain = ctx.createGain();
    envelope(gain.gain, t, peak, attack, decay);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
    item.sources.push(osc);
  }

  /** Dry into `item.out`, plus a wet send through the room. */
  function withRoom(item, wet) {
    const dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(item.out);
    const conv = ctx.createConvolver();
    conv.buffer = room();
    const send = ctx.createGain();
    send.gain.value = wet;
    dry.connect(conv);
    conv.connect(send);
    send.connect(item.out);
    return dry;
  }

  // --- The audio files -------------------------------------------------------------------------
  /** Fetches and decodes every file once (no-op afterwards, also after a failure). */
  function loadClips() {
    if (!ctx) return;
    for (const id of CLIP_IDS) {
      if (clips.has(id)) continue;
      const entry = { state: 'loading', buffer: null };
      clips.set(id, entry);
      const forCtx = ctx;
      Promise.resolve()
        .then(() => loadClip(id))
        .then((bytes) => decode(forCtx, bytes))
        .then((decoded) => {
          const channels = [];
          for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) channels.push(decoded.getChannelData(ch));
          const samples = shapeClip(channels, decoded.sampleRate, CLIP_SHAPES[id]);
          if (samples.length === 0) throw new Error('silent file');
          const buffer = forCtx.createBuffer(1, samples.length, decoded.sampleRate);
          buffer.getChannelData(0).set(samples);
          entry.buffer = buffer;
          entry.state = 'ready';
        })
        .catch(() => {
          entry.state = 'failed'; // that sound stays silent
        });
    }
  }

  /** decodeAudioData in both its forms (promise, and the callbacks of older Safari). */
  function decode(context, bytes) {
    return new Promise((resolve, reject) => {
      const result = context.decodeAudioData(bytes, resolve, reject);
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    });
  }

  /** A decoded file, played `times` times (Çift Ateş: twice), DOUBLE_GAP_MS apart. */
  function clipPlayer(id) {
    return (item, t, { times = 1 } = {}) => {
      const entry = clips.get(id);
      if (entry?.state !== 'ready') throw new Error('not loaded'); // start() drops the voice
      const count = times === 2 ? 2 : 1;
      // Two overlapping shots would clip: the pair plays a little softer, the second one more so.
      if (count === 2) item.out.gain.value *= DOUBLE_LEVEL;
      for (let i = 0; i < count; i += 1) {
        const src = ctx.createBufferSource();
        src.buffer = entry.buffer;
        const gain = ctx.createGain();
        gain.gain.value = i === 0 ? 1 : DOUBLE_SECOND_LEVEL;
        src.connect(gain);
        gain.connect(item.out);
        src.start(t + (i * DOUBLE_GAP_MS) / 1000);
        item.sources.push(src);
      }
      return entry.buffer.duration + ((count - 1) * DOUBLE_GAP_MS) / 1000;
    };
  }

  // --- The five sounds -------------------------------------------------------------------------
  const SOUNDS = {
    loaded: clipPlayer('loaded'),
    empty: clipPlayer('empty'),

    // Reloading: per Mermi a short slide and a metallic seat (with a small random spacing, like a
    // hand), the cylinder snapped shut, then a decelerating ratchet spin and its final lock.
    reload(item, t, { count = 6 } = {}) {
      const dest = item.out;
      const n = Math.max(2, Math.min(8, Math.round(count) || 6));
      let at = t;
      for (let i = 0; i < n; i += 1) {
        burst(item, dest, at, { freq: 1500, q: 1, peak: 0.1, attack: 0.02, decay: 0.045 });
        const seat = at + 0.05;
        burst(item, dest, seat, { freq: 2500, q: 5, peak: 0.42, attack: 0.0006, decay: 0.02 });
        tone(item, dest, seat, { type: 'triangle', freq: 720, glideTo: 520, glide: 0.04, peak: 0.16, attack: 0.001, decay: 0.05 });
        tone(item, dest, seat, { freq: 2250 + random() * 120, peak: 0.045, attack: 0.001, decay: 0.09 });
        at += 0.125 + random() * 0.025;
      }
      const close = at + 0.1;
      burst(item, dest, close, { freq: 1800, q: 2, peak: 0.6, attack: 0.0006, decay: 0.03 });
      tone(item, dest, close, { type: 'triangle', freq: 330, glideTo: 210, glide: 0.04, peak: 0.3, attack: 0.001, decay: 0.05 });
      let tick = close + 0.12;
      const ticks = 14;
      for (let i = 0; i < ticks; i += 1) {
        const last = i === ticks - 1;
        burst(item, dest, tick, { freq: 3800, q: 6, peak: last ? 0.38 : 0.28 - i * 0.011, attack: 0.0004, decay: last ? 0.016 : 0.008 });
        tick += 0.032 + (i / ticks) ** 2 * 0.075;
      }
      return tick - t + 0.1;
    },

    // The turn chime: two soft bell notes rising a fourth (E5, A5), a fundamental with a quiet
    // octave and an inharmonic third partial, lightly in the room.
    turn(item, t) {
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.setValueAtTime(5200, t);
      soft.connect(withRoom(item, 0.22));
      const notes = [659.25, 880];
      notes.forEach((freq, i) => {
        const at = t + i * 0.15;
        tone(item, soft, at, { freq, peak: 0.2, attack: 0.006, decay: 0.85 });
        tone(item, soft, at, { freq: freq * 2, peak: 0.05, attack: 0.004, decay: 0.38 });
        tone(item, soft, at, { freq: freq * 3.01, peak: 0.02, attack: 0.003, decay: 0.18 });
      });
      return 1.3;
    },

    // The hammer drawn back, "click-CLACK": a light, high sear click, then the hammer locking
    // 75 ms later: a heavy, low clack with a body thump, a pitched-down knock and a metallic ring
    // of the frame (around 1.1 / 1.7 kHz), lightly in the room. The signature of the sound.
    hammer(item, t) {
      const dest = withRoom(item, 0.14);
      // The sear: a short, bright, resonant tick (a tone, so it stays audible next to the clack).
      burst(item, dest, t, { freq: 3000, q: 2, peak: 0.8, attack: 0.0005, decay: 0.006 });
      tone(item, dest, t, { freq: 3150, peak: 0.3, attack: 0.0004, decay: 0.012 });
      tone(item, dest, t, { type: 'triangle', freq: 1850, peak: 0.18, attack: 0.0004, decay: 0.01 });
      // The clack: mid-range impact (what a phone speaker plays), a body knock and the frame ring.
      const clack = t + 0.075;
      burst(item, dest, clack, { freq: 950, q: 2.2, peak: 1.0, attack: 0.0007, decay: 0.035 });
      burst(item, dest, clack, { freq: 1600, q: 3, peak: 0.45, attack: 0.0006, decay: 0.02 });
      burst(item, dest, clack, { type: 'lowpass', freq: 600, q: 0.8, peak: 0.45, attack: 0.001, decay: 0.05 });
      tone(item, dest, clack, { type: 'triangle', freq: 300, glideTo: 190, glide: 0.06, peak: 0.4, attack: 0.001, decay: 0.12 });
      tone(item, dest, clack, { freq: 130, glideTo: 85, glide: 0.06, peak: 0.2, attack: 0.0015, decay: 0.09 });
      tone(item, dest, clack, { freq: 1130, peak: 0.16, attack: 0.001, decay: 0.14 });
      tone(item, dest, clack, { freq: 1720, peak: 0.06, attack: 0.001, decay: 0.09 });
      return 0.45;
    },
  };

  /**
   * One soft ratchet tick under the thumb (part of the hammer sound): low-passed noise and a dull
   * low thud, no bright metal; at `at` on the audio clock (the steady grid startHammer keeps).
   */
  function hammerTick(item, t, { at = t } = {}) {
    const when = Math.max(at, t);
    burst(item, item.out, when, { type: 'lowpass', freq: 900, q: 0.7, peak: 0.24 + random() * 0.04, attack: 0.002, decay: 0.014 });
    burst(item, item.out, when, { freq: 520, q: 1.5, peak: 0.14, attack: 0.002, decay: 0.012 });
    tone(item, item.out, when, { freq: 230, glideTo: 170, glide: 0.02, peak: 0.035, attack: 0.002, decay: 0.02 });
    return when - t + 0.05;
  }

  // --- Playing ---------------------------------------------------------------------------------
  function start(id, build, options) {
    if (!allowed(id) || !ready()) return false;
    if (CLIP_IDS.includes(id) && clips.get(id)?.state !== 'ready') {
      loadClips(); // lazily, if the gesture did not load them; this play is dropped, not queued
      return false;
    }
    let item = null;
    try {
      item = voice(id);
      const length = build(item, ctx.currentTime + 0.005, options);
      finish(item, length);
      return true;
    } catch {
      if (item) release(item);
      return false;
    }
  }

  /**
   * Plays one sound now, or nothing (switch off, no context yet, suspended, no Web Audio).
   * @param {string} id one of SOUND_IDS ('hammer' plays only the cock; see startHammer)
   * @param {object} [options] reload: { count } (the chambers loaded); loaded / empty:
   *   { times: 2 } for a doubled shot (Çift Ateş)
   * @returns {boolean} whether it started
   */
  function play(id, options) {
    if (!Object.prototype.hasOwnProperty.call(SOUNDS, id)) return false;
    return start(id, SOUNDS[id], options);
  }

  /**
   * The long press began: the cock, then one tick per chamber of the spin until stopHammer().
   * The ticks sit on a steady grid of the audio clock (cock + HAMMER_FIRST_TICK + k ticks), so a
   * late or early timer never bunches them; one late beyond the grid plays at once.
   */
  function startHammer() {
    stopHammer();
    if (!play('hammer')) return false;
    const base = ctx.currentTime + 0.005 + HAMMER_FIRST_TICK;
    let k = 0;
    ticker = setI(() => {
      const at = base + (k * HAMMER_TICK_MS) / 1000;
      k += 1;
      if (!start('hammer', hammerTick, { at })) stopHammer();
    }, HAMMER_TICK_MS);
    return true;
  }

  /** The press ended (fire, cancel, expiry): the ticks and any hammer sound stop at once. */
  function stopHammer() {
    if (ticker !== null) {
      clearI(ticker);
      ticker = null;
    }
    silence('hammer');
  }

  /** Stops one sound (or every sound) at once. */
  function silence(id = null) {
    for (const [key, set] of voices) {
      if (id !== null && key !== id) continue;
      for (const item of [...set]) release(item);
    }
  }

  /** After a settings change: everything no longer allowed stops now. */
  function enforce() {
    for (const id of SOUND_IDS) {
      if (allowed(id)) continue;
      if (id === 'hammer') stopHammer();
      else silence(id);
    }
  }

  const active = (id) => voices.get(id)?.size ?? 0;
  const hammerRunning = () => ticker !== null;
  /** 'loading' | 'ready' | 'failed', or null before the first load. */
  const clipState = (id) => clips.get(id)?.state ?? null;

  return { unlock, play, startHammer, stopHammer, silence, enforce, active, hammerRunning, clipState };
}

// --- The page's engine -------------------------------------------------------------------------
const engine = createSoundEngine();

export const playSound = (id, options) => engine.play(id, options);
/** A shot's sound: 'loaded' or 'empty', twice when the shot was doubled (Çift Ateş). */
export const playShot = (live, doubled = false) => engine.play(live ? 'loaded' : 'empty', { times: doubled ? 2 : 1 });
export const startHammer = () => engine.startHammer();
export const stopHammer = () => engine.stopHammer();

let started = false;

/**
 * At start (app.js): unlock the shared context on the first gesture (and resume it on later ones,
 * e.g. after the phone suspended it), and silence a sound at once when its switch goes off.
 */
export function initSounds() {
  if (started) return;
  started = true;
  const unlock = () => engine.unlock();
  for (const type of ['pointerdown', 'keydown', 'touchend']) {
    globalThis.addEventListener?.(type, unlock, { capture: true, passive: true });
  }
  onSettingsChange(() => engine.enforce());
}
