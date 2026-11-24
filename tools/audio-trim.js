// Dev only (step 4.4c, decision Q78): makes the two shot sounds the game loads from the raw CC0
// downloads in raw-sounds/ (git-ignored). Plain Node, no dependencies, no re-encoding.
//
// Usage (project root): node tools/audio-trim.js
//
// The downloads are MP3 (MPEG-1/2/2.5 Layer III). Node cannot decode MP3 without a library, so
// this script cuts WHOLE FRAMES only: it drops ID3 tags and the Xing / Info header frame, and keeps
// the audio frames up to a time limit (plus a few frames of margin). MP3 is already small and is
// played by every current browser, Safari included. The exact shaping is done after decoding, in
// the browser (sounds.js `shapeClip`): the mono downmix, leading / trailing silence, the exact
// length and the fade-out. The limits here and there must agree (CLIPS below, CLIP_SHAPES there).
//
// Sources (Freesound, CC0; credited in README.md):
//   loaded: "Heathers Gunshot Effect2" by okieactor, https://freesound.org/people/okieactor/sounds/415912/
//   empty:  "Empty Gun Shot" by KlawyKogut, https://freesound.org/people/KlawyKogut/sounds/154934/

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** keepSeconds: audio kept before the margin (null = the whole file). */
export const CLIPS = Object.freeze([
  { src: 'raw-sounds/Heathers Gunshot Effect2.mp3', out: 'src/ui/audio/shot-loaded.mp3', keepSeconds: 0.6 },
  { src: 'raw-sounds/Empty Gun Shot.mp3', out: 'src/ui/audio/shot-empty.mp3', keepSeconds: null },
]);

/** Extra audio kept after keepSeconds: the decoder's start delay and the fade need it. */
export const MARGIN_SECONDS = 0.15;

const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The Layer III frame header at `offset`, or null. */
export function frameAt(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  const h = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  if (((h >>> 21) & 0x7ff) !== 0x7ff) return null;
  const version = (h >>> 19) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (h >>> 17) & 3; // 1 = Layer III
  const bitrateIndex = (h >>> 12) & 15;
  const rateIndex = (h >>> 10) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = BITRATES[mpeg1 ? 'v1' : 'v2'][bitrateIndex] * 1000;
  const sampleRate = RATES[version][rateIndex];
  const padding = (h >>> 9) & 1;
  const mono = ((h >>> 6) & 3) === 3;
  const samples = mpeg1 ? 1152 : 576;
  const size = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  // The Xing / Info tag sits after the side information.
  const sideInfo = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const tag = String.fromCharCode(...bytes.subarray(offset + 4 + sideInfo, offset + 8 + sideInfo));
  return { size, sampleRate, samples, mono, info: tag === 'Xing' || tag === 'Info' };
}

/**
 * The audio frames of an MP3 up to `keepSeconds` + MARGIN_SECONDS (all of them for null), without
 * ID3 tags or the Xing / Info frame.
 * @returns {{ bytes: Uint8Array, seconds: number, frames: number, sampleRate: number, mono: boolean }}
 */
export function trimMp3(bytes, keepSeconds) {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  const limit = keepSeconds === null ? Infinity : keepSeconds + MARGIN_SECONDS;
  const parts = [];
  let seconds = 0;
  let first = null;
  while (offset < bytes.length && seconds < limit) {
    const frame = frameAt(bytes, offset);
    if (!frame) break; // a trailing tag (ID3v1, APE) or garbage: the audio ends here
    if (first === null) first = frame;
    if (frame.sampleRate !== first.sampleRate) throw new Error('mixed sample rates');
    if (!frame.info) {
      parts.push(bytes.subarray(offset, offset + frame.size));
      seconds += frame.samples / frame.sampleRate;
    }
    offset += frame.size;
  }
  if (!first || parts.length === 0) throw new Error('no MPEG Layer III audio found');
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { bytes: out, seconds, frames: parts.length, sampleRate: first.sampleRate, mono: first.mono };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const clip of CLIPS) {
    const input = readFileSync(join(root, clip.src));
    const result = trimMp3(new Uint8Array(input), clip.keepSeconds);
    const out = join(root, clip.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.bytes);
    console.log(`${clip.out}: ${result.bytes.length} bytes, ${result.frames} frames, `
      + `${result.seconds.toFixed(3)} s, ${result.sampleRate} Hz, ${result.mono ? 'mono' : 'stereo'} (from ${input.length} bytes)`);
  }
}
