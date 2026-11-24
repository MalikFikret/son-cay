// The six revolvers (decision Q43; approved drawings: conversation 8, model 2, "Altı tabanca"),
// copied as they are and split into the same moving parts, so the table's animations (cock,
// spin, cylinder turn, hammer fall, Dolu recoil + flash, Boş click + smoke) work on every one:
//
// - body:   everything that recoils, in the drawing's order; the token 'FLUTES' marks where the
//           cylinder marks go, and the hammer is drawn last, on top (as in the drawings).
// - flutes: the cylinder marks that slide while the cylinder turns, clipped to `clip`. They
//           repeat every `step` (one mark spacing): extra marks lie outside the clip at rest, so
//           the drawing at rest is exactly the approved one and the slide loops seamlessly.
//           Eski Asker has no marks, only a dark band: the band and a copy one step above slide
//           inside the band's own box (at rest only the original band shows).
// - hammer: the hammer drawing.
// - pivots: where each part turns or scales, in the drawing's units (viewBox 40 0 300 190):
//           `hammer` (it rotates back when cocked and falls on the shot), `body` (the recoil
//           rotation) and `muzzle` (the flash and the smoke grow from there; both drawings are
//           placed there, inside the body, so they follow the recoil).
//
// Attribute values 'HATCH' and 'GRIP' stand for this drawing's own pattern / clip ids, made
// unique per element by revolver.js (several revolvers can be on one page: the settings grid).
// Display names are locale entries (revolvers.names / revolvers.notes); ids are English.

/** Order of the settings grid (as in the mock); the last one is the default. */
export const REVOLVER_IDS = Object.freeze(['birdHead', 'cowboy', 'detective', 'heavy', 'oldSoldier', 'mosul']);
export const DEFAULT_REVOLVER = 'mosul';

/**
 * The muzzle effects, drawn for a muzzle at FLASH_ORIGIN and moved to each revolver's muzzle.
 * Dolu (decision Q75): a full flame about twice the first draft's size (68 x 44 instead of
 * 34 x 26): an orange outer flame, a yellow one, a white-hot core and three sparks.
 */
export const FLASH_ORIGIN = Object.freeze([280, 50]);
export const FLASH = Object.freeze([
  ['path', { d: 'M280 49 L300 30 L303 42 L326 28 L319 45 L348 50 L319 55 L326 72 L303 58 L300 70 L280 52 Z', fill: '#E8762B' }],
  ['path', { d: 'M280 49 L296 38 L299 46 L317 39 L312 48 L334 50 L312 52 L317 61 L299 54 L296 62 L280 52 Z', fill: '#F2B53A' }],
  ['path', { d: 'M280 49 L292 44 L295 48.5 L312 50 L295 51.5 L292 56 L280 51.5 Z', fill: '#FFF2C4' }],
  ['circle', { cx: 337, cy: 35, r: 1.8, fill: '#F2B53A' }],
  ['circle', { cx: 341, cy: 65, r: 1.6, fill: '#F2B53A' }],
  ['circle', { cx: 355, cy: 47, r: 1.4, fill: '#FFF2C4' }],
]);

/** Boş (decision Q75): a small puff of white smoke at the muzzle (it drifts out and fades). */
export const SMOKE = Object.freeze([
  ['circle', { cx: 288, cy: 49, r: 6.5, fill: '#F2ECDD' }],
  ['circle', { cx: 298, cy: 44, r: 8, fill: '#F2ECDD' }],
  ['circle', { cx: 299, cy: 54, r: 6, fill: '#F2ECDD' }],
  ['circle', { cx: 309, cy: 48, r: 7, fill: '#F2ECDD' }],
]);

const HATCHED = ['rect', { x: 50, y: 36, width: 80, height: 150, fill: 'url(#HATCH)', 'clip-path': 'url(#GRIP)', opacity: 0.55 }];
const FRAME = 'M84 30 H158 V88 H120 C112 88 106 94 104 102 L88 104 C86 80 84 56 84 30 Z';
const GUARD = 'M116 88 C116 120 154 120 154 88';
const TRIGGER = 'M131 88 C128 100 132 107 139 109';
const HAMMER_LONG = 'M92 34 L72 14 C68 10 70 6 76 6 L84 8 C82 12 84 14 88 16 L101 31 Z';
const HAMMER_SPUR = 'M92 34 L76 16 C73 12 79 9 83 13 L101 31 Z';
const GRIP_BONE = 'M86 40 C84 82 74 124 64 158 C60 170 66 179 78 179 L104 179 C115 179 115 170 110 160 C106 134 110 112 118 92 Z';

/** Small marks (8 x 3) on the cylinder's front edge, 14 apart (Musul Gravürü, Kuş Başı). */
const edgeMarks = (fill) => [32, 46, 60, 74, 88].map((y) => ['rect', { x: 142, y, width: 8, height: 3, rx: 1.5, fill }]);
/** Full-width flutes (44 x 6), 12 apart (Kovboy, Dedektif, Ağır Kalibre). */
const flutes = (fill) => [22, 34, 46, 58, 70, 82].map((y) => ['rect', { x: 108, y, width: 44, height: 6, rx: 3, fill }]);
const FLUTE_CLIP = Object.freeze({ x: 104, y: 38, width: 52, height: 44, rx: 8 });

const STANDARD_PIVOTS = Object.freeze({ hammer: [96, 34], body: [80, 139] });

export const REVOLVERS = Object.freeze({
  // 1 · Kuş Başı: curved grip, plain cylinder.
  birdHead: {
    nameKey: 'revolvers.names.birdHead',
    noteKey: 'revolvers.notes.birdHead',
    hatch: '#3A2013',
    grip: 'M86 40 C84 80 74 116 64 142 C57 160 60 176 76 178 C90 180 98 170 102 156 C108 134 112 112 118 92 Z',
    body: [
      ['path', { d: 'GRIP_PATH', fill: '#6B3A22' }],
      HATCHED,
      ['circle', { cx: 86, cy: 130, r: 5.5, fill: '#B08D57' }],
      ['path', { d: GUARD, fill: 'none', stroke: '#24282C', 'stroke-width': 5 }],
      ['path', { d: TRIGGER, fill: 'none', stroke: '#8A939C', 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['path', { d: FRAME, fill: '#33383D' }],
      ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#8A939C' }],
      ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#8A939C' }],
      ['rect', { x: 150, y: 40, width: 130, height: 19, rx: 3, fill: '#3A3F45' }],
      ['rect', { x: 150, y: 35, width: 130, height: 7, rx: 2, fill: '#24282C' }],
      ['path', { d: 'M268 35 L271 28 L277 28 L278 35 Z', fill: '#24282C' }],
      ['rect', { x: 160, y: 59, width: 90, height: 10, rx: 5, fill: '#24282C' }],
      ['path', { d: 'M152 44 H276', stroke: '#8A939C', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }],
      ['rect', { x: 104, y: 38, width: 52, height: 44, rx: 10, fill: '#3A3F45' }],
      'FLUTES',
      ['path', { d: 'M108 42 H152', stroke: '#8A939C', 'stroke-opacity': 0.6, 'stroke-width': 2 }],
    ],
    flutes: { clip: { x: 104, y: 38, width: 52, height: 44, rx: 10 }, step: 14, marks: edgeMarks('#24282C') },
    hammer: ['path', { d: HAMMER_SPUR, fill: '#33383D' }],
    pivots: { ...STANDARD_PIVOTS, muzzle: [280, 50] },
  },

  // 2 · Kovboy: plough grip, long barrel.
  cowboy: {
    nameKey: 'revolvers.names.cowboy',
    noteKey: 'revolvers.notes.cowboy',
    hatch: null, // the approved drawing defines a pattern but does not use it
    grip: GRIP_BONE,
    body: [
      ['path', { d: 'GRIP_PATH', fill: '#3E2416' }],
      ['path', { d: GUARD, fill: 'none', stroke: '#5E666D', 'stroke-width': 5 }],
      ['path', { d: TRIGGER, fill: 'none', stroke: '#E4E8EB', 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['path', { d: FRAME, fill: '#8F979E' }],
      ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#E4E8EB' }],
      ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#E4E8EB' }],
      ['rect', { x: 150, y: 41, width: 168, height: 16, rx: 3, fill: '#A7AFB6' }],
      ['rect', { x: 150, y: 57, width: 132, height: 9, rx: 4.5, fill: '#5E666D' }],
      ['circle', { cx: 282, cy: 61.5, r: 5, fill: '#A7AFB6' }],
      ['path', { d: 'M308 41 L311 32 L316 32 L317 41 Z', fill: '#5E666D' }],
      ['path', { d: 'M152 45 H314', stroke: '#E4E8EB', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }],
      ['rect', { x: 104, y: 38, width: 52, height: 44, rx: 8, fill: '#A7AFB6' }],
      'FLUTES',
    ],
    flutes: { clip: FLUTE_CLIP, step: 12, marks: flutes('#5E666D') },
    hammer: ['path', { d: HAMMER_LONG, fill: '#8F979E' }],
    pivots: { ...STANDARD_PIVOTS, muzzle: [318, 49] },
  },

  // 3 · Dedektif: short barrel, round grip.
  detective: {
    nameKey: 'revolvers.names.detective',
    noteKey: 'revolvers.notes.detective',
    hatch: '#3A3D41',
    grip: 'M86 44 C84 78 78 108 74 130 C71 146 80 156 94 156 C106 156 112 148 112 136 C112 118 114 104 118 92 Z',
    body: [
      ['path', { d: 'GRIP_PATH', fill: '#1B1C1E' }],
      HATCHED,
      ['path', { d: 'M116 88 C116 116 150 116 150 88', fill: 'none', stroke: '#16181B', 'stroke-width': 5 }],
      ['path', { d: TRIGGER, fill: 'none', stroke: '#5E666D', 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['path', { d: FRAME, fill: '#23262A' }],
      ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#5E666D' }],
      ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#5E666D' }],
      ['rect', { x: 150, y: 38, width: 52, height: 22, rx: 4, fill: '#2A2D31' }],
      ['rect', { x: 150, y: 58, width: 40, height: 10, rx: 5, fill: '#16181B' }],
      ['path', { d: 'M190 38 L194 31 L200 31 L201 38 Z', fill: '#16181B' }],
      ['path', { d: 'M152 43 H198', stroke: '#5E666D', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }],
      ['rect', { x: 104, y: 38, width: 52, height: 44, rx: 8, fill: '#2A2D31' }],
      'FLUTES',
    ],
    flutes: { clip: FLUTE_CLIP, step: 12, marks: flutes('#16181B') },
    hammer: ['path', { d: 'M94 34 L88 26 C87 23 90 22 92 24 L101 31 Z', fill: '#23262A' }],
    pivots: { hammer: [97, 33], body: STANDARD_PIVOTS.body, muzzle: [202, 49] },
  },

  // 4 · Ağır Kalibre: heavy barrel with a vented rib and a full underlug.
  heavy: {
    nameKey: 'revolvers.names.heavy',
    noteKey: 'revolvers.notes.heavy',
    hatch: '#333333',
    grip: 'M86 40 C82 84 74 126 66 172 L112 178 C112 170 106 166 108 158 C103 152 106 145 109 140 C105 134 108 128 111 122 C107 116 110 108 114 100 L118 92 Z',
    body: [
      ['path', { d: 'GRIP_PATH', fill: '#1A1A1A' }],
      HATCHED,
      ['path', { d: GUARD, fill: 'none', stroke: '#6F777E', 'stroke-width': 5 }],
      ['path', { d: TRIGGER, fill: 'none', stroke: '#EEF1F3', 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['path', { d: FRAME, fill: '#A3AAB0' }],
      ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#EEF1F3' }],
      ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#EEF1F3' }],
      ['rect', { x: 150, y: 36, width: 142, height: 24, rx: 3, fill: '#B9BFC4' }],
      ['rect', { x: 150, y: 28, width: 142, height: 9, rx: 2, fill: '#6F777E' }],
      ...[164, 178, 192, 206, 220, 234, 248, 262, 276].map((x) => ['rect', { x, y: 30, width: 7, height: 4, rx: 1, fill: '#15100C', opacity: 0.6 }]),
      ['rect', { x: 150, y: 58, width: 142, height: 18, rx: 4, fill: '#B9BFC4' }],
      ['path', { d: 'M152 66 H288', stroke: '#6F777E', 'stroke-width': 2 }],
      ['path', { d: 'M282 28 L285 20 L291 20 L292 28 Z', fill: '#6F777E' }],
      ['path', { d: 'M152 41 H288', stroke: '#EEF1F3', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }],
      ['rect', { x: 104, y: 38, width: 52, height: 44, rx: 8, fill: '#B9BFC4' }],
      'FLUTES',
    ],
    flutes: { clip: FLUTE_CLIP, step: 12, marks: flutes('#6F777E') },
    hammer: ['path', { d: HAMMER_SPUR, fill: '#A3AAB0' }],
    pivots: { ...STANDARD_PIVOTS, muzzle: [292, 48] },
  },

  // 5 · Eski Asker: straight grip with a lanyard ring, long cylinder.
  oldSoldier: {
    nameKey: 'revolvers.names.oldSoldier',
    noteKey: 'revolvers.notes.oldSoldier',
    hatch: '#3A2414',
    grip: 'M86 40 C84 84 80 128 76 170 L108 172 C108 140 112 114 118 92 Z',
    body: [
      ['path', { d: 'GRIP_PATH', fill: '#5A3A22' }],
      HATCHED,
      ['circle', { cx: 92, cy: 180, r: 6, fill: 'none', stroke: '#4A4339', 'stroke-width': 2.5 }],
      ['path', { d: GUARD, fill: 'none', stroke: '#2B2620', 'stroke-width': 5 }],
      ['path', { d: TRIGGER, fill: 'none', stroke: '#857A69', 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['path', { d: 'M84 30 H162 V88 H120 C112 88 106 94 104 102 L88 104 C86 80 84 56 84 30 Z', fill: '#3F392F' }],
      ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#857A69' }],
      ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#857A69' }],
      ['rect', { x: 160, y: 42, width: 146, height: 14, fill: '#4A4339' }],
      ['path', { d: 'M162 46 H304 M162 52 H304', stroke: '#2B2620', 'stroke-width': 1.2 }],
      ['rect', { x: 160, y: 56, width: 36, height: 7, rx: 3.5, fill: '#2B2620' }],
      ['path', { d: 'M298 42 L301 34 L305 34 L306 42 Z', fill: '#2B2620' }],
      ['rect', { x: 100, y: 40, width: 62, height: 40, rx: 6, fill: '#4A4339' }],
      'FLUTES',
      ['path', { d: 'M104 44 H148', stroke: '#857A69', 'stroke-opacity': 0.6, 'stroke-width': 2 }],
    ],
    // The dark band and its copy one step (32 + a 4 gap) above, inside the band's own box.
    flutes: {
      clip: { x: 152, y: 44, width: 8, height: 32, rx: 3 },
      step: 36,
      marks: [8, 44].map((y) => ['rect', { x: 152, y, width: 8, height: 32, rx: 3, fill: '#2B2620' }]),
    },
    hammer: ['path', { d: HAMMER_SPUR, fill: '#3F392F' }],
    pivots: { ...STANDARD_PIVOTS, muzzle: [306, 49] },
  },

  // 6 · Musul Gravürü (default): bone grip, engraved body.
  mosul: {
    nameKey: 'revolvers.names.mosul',
    noteKey: 'revolvers.notes.mosul',
    hatch: '#BFB295',
    grip: GRIP_BONE,
    body: [
      ['path', { d: 'GRIP_PATH', fill: '#E8DFC9' }],
      HATCHED,
      ['circle', { cx: 88, cy: 132, r: 5.5, fill: '#2F8F88' }],
      ['path', { d: GUARD, fill: 'none', stroke: '#8C826C', 'stroke-width': 5 }],
      ['path', { d: TRIGGER, fill: 'none', stroke: '#F2ECDD', 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['path', { d: FRAME, fill: '#BDB49F' }],
      ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#F2ECDD' }],
      ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#F2ECDD' }],
      ['rect', { x: 150, y: 40, width: 130, height: 19, rx: 3, fill: '#C9C1AE' }],
      ['rect', { x: 150, y: 35, width: 130, height: 7, rx: 2, fill: '#8C826C' }],
      ['path', { d: 'M268 35 L271 28 L277 28 L278 35 Z', fill: '#8C826C' }],
      ['rect', { x: 160, y: 59, width: 90, height: 10, rx: 5, fill: '#8C826C' }],
      ['path', { d: 'M152 44 H276', stroke: '#F2ECDD', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }],
      ['rect', { x: 104, y: 38, width: 52, height: 44, rx: 10, fill: '#C9C1AE' }],
      'FLUTES',
      ['path', { d: 'M108 42 H152', stroke: '#F2ECDD', 'stroke-opacity': 0.6, 'stroke-width': 2 }],
      ['g', { fill: 'none', stroke: '#6E5A2E', 'stroke-opacity': 0.75, 'stroke-width': 1 },
        ['path', { d: 'M92 40 C100 34 108 46 116 40 S132 50 140 44' }],
        ['path', { d: 'M94 62 C100 56 106 66 112 60' }],
        ['path', { d: 'M170 50 C178 44 186 56 194 50 S210 56 218 50 S234 56 242 50' }],
        ['rect', { x: 124, y: 54, width: 12, height: 12 }],
        ['rect', { x: 124, y: 54, width: 12, height: 12, transform: 'rotate(45 130 60)' }]],
    ],
    flutes: { clip: { x: 104, y: 38, width: 52, height: 44, rx: 10 }, step: 14, marks: edgeMarks('#8C826C') },
    hammer: ['path', { d: HAMMER_LONG, fill: '#BDB49F' }],
    pivots: { ...STANDARD_PIVOTS, muzzle: [280, 50] },
  },
});

/** True only for a revolver id (never for inherited keys such as 'constructor'). */
export function isRevolverId(id) {
  return typeof id === 'string' && REVOLVER_IDS.includes(id);
}
