// The revolver in the middle of the table: the default "Musul Gravürü" (Mosul engraving) from
// the approved designs (conversation 8, model 2), copied as it is, split into parts that move:
// the body (recoil / dry click), the cylinder marks (they slide while the cylinder turns), the
// hammer and the muzzle flash. Choosing another revolver comes in a later step.
//
// The animation follows the approved draft (conversation 8, model 3), sequence and timing only:
// the cylinder turns (~0.36 s), the hammer falls, then a live chamber flashes and recoils, a blank
// one gives a dry click (a small shake, no flame). The CSS classes and keyframes are in style.css;
// SHOT_TIMING mirrors them for the screen's waits.

import { svg } from './dom.js';

/** Milliseconds, matching the keyframes in style.css (.revolver.is-live / .is-blank). */
export const SHOT_TIMING = Object.freeze({
  aim: 380, // the revolver turns to the target (transition)
  live: 950, // cylinder 360 + hammer at 380 + flash / recoil until ~950
  blank: 700, // cylinder 360 + hammer at 380 + click until ~650
  reducedAim: 0,
  reducedLive: 500, // only the flash and the hammer
  reducedBlank: 300,
  hold: 250, // a short pause before the result shows on the seats
});

const GRIP = 'M86 40 C84 82 74 124 64 158 C60 170 66 179 78 179 L104 179 C115 179 115 170 110 160 C106 134 110 112 118 92 Z';
const CYLINDER = { x: 104, y: 38, width: 52, height: 44 };

const mark = (y) => ['rect', { x: 142, y, width: 8, height: 3, rx: 1.5, fill: '#8C826C' }];

const TREE = ['svg', {
  class: 'revolver-svg', width: 180, height: 114, viewBox: '40 0 300 190', 'aria-hidden': 'true', focusable: 'false',
},
['defs', {},
  ['pattern', { id: 'rv-k', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    ['path', { d: 'M0 0 H5 M0 0 V5', stroke: '#BFB295', 'stroke-width': 1 }]],
  ['clipPath', { id: 'rv-g' }, ['path', { d: GRIP }]],
  ['clipPath', { id: 'rv-c' }, ['rect', { ...CYLINDER, rx: 10 }]]],
['g', { class: 'rv-flash' },
  ['path', { d: 'M280 50 L298 38 L294 48 L314 50 L294 53 L300 64 L280 54 Z', fill: '#F2B53A' }],
  ['path', { d: 'M280 50 L290 45 L288 50 L298 51 L288 52 L290 57 Z', fill: '#FFF2C4' }]],
['g', { class: 'rv-body' },
  ['path', { d: GRIP, fill: '#E8DFC9' }],
  ['rect', { x: 50, y: 36, width: 80, height: 150, fill: 'url(#rv-k)', 'clip-path': 'url(#rv-g)', opacity: 0.55 }],
  ['circle', { cx: 88, cy: 132, r: 5.5, fill: '#2F8F88' }],
  ['path', { d: 'M116 88 C116 120 154 120 154 88', fill: 'none', stroke: '#8C826C', 'stroke-width': 5 }],
  ['path', { d: 'M131 88 C128 100 132 107 139 109', fill: 'none', stroke: '#F2ECDD', 'stroke-width': 4, 'stroke-linecap': 'round' }],
  ['path', { d: 'M84 30 H158 V88 H120 C112 88 106 94 104 102 L88 104 C86 80 84 56 84 30 Z', fill: '#BDB49F' }],
  ['circle', { cx: 96, cy: 72, r: 2.5, fill: '#F2ECDD' }],
  ['circle', { cx: 146, cy: 80, r: 2.5, fill: '#F2ECDD' }],
  ['rect', { x: 150, y: 40, width: 130, height: 19, rx: 3, fill: '#C9C1AE' }],
  ['rect', { x: 150, y: 35, width: 130, height: 7, rx: 2, fill: '#8C826C' }],
  ['path', { d: 'M268 35 L271 28 L277 28 L278 35 Z', fill: '#8C826C' }],
  ['rect', { x: 160, y: 59, width: 90, height: 10, rx: 5, fill: '#8C826C' }],
  ['path', { d: 'M152 44 H276', stroke: '#F2ECDD', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }],
  ['rect', { ...CYLINDER, rx: 10, fill: '#C9C1AE' }],
  // The cylinder marks, one spacing (14) apart; two extra ones so the slide loops seamlessly.
  ['g', { 'clip-path': 'url(#rv-c)' },
    ['g', { class: 'rv-flutes' }, mark(32), mark(46), mark(60), mark(74), mark(88)]],
  ['path', { d: 'M108 42 H152', stroke: '#F2ECDD', 'stroke-opacity': 0.6, 'stroke-width': 2 }],
  ['g', { fill: 'none', stroke: '#6E5A2E', 'stroke-opacity': 0.75, 'stroke-width': 1 },
    ['path', { d: 'M92 40 C100 34 108 46 116 40 S132 50 140 44' }],
    ['path', { d: 'M94 62 C100 56 106 66 112 60' }],
    ['path', { d: 'M170 50 C178 44 186 56 194 50 S210 56 218 50 S234 56 242 50' }],
    ['rect', { x: 124, y: 54, width: 12, height: 12 }],
    ['rect', { x: 124, y: 54, width: 12, height: 12, transform: 'rotate(45 130 60)' }]],
  ['g', { class: 'rv-hammer' },
    ['path', { d: 'M92 34 L72 14 C68 10 70 6 76 6 L84 8 C82 12 84 14 88 16 L101 31 Z', fill: '#BDB49F' }]]]];

/** A new revolver SVG element (decorative; the screen labels the revolver's direction). */
export function revolverSvg() {
  return svg(TREE);
}
