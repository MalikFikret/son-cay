// The revolver in the middle of the table: the player's own choice of the six approved revolvers
// (decision Q43, data in revolvers.js; default "Musul Gravürü"), each split into the parts that
// move: the body (recoil / dry click), the cylinder marks (they slide while the cylinder turns),
// the hammer and the muzzle flash. The same builder draws the small previews of Ayarlar.
//
// The animation follows the approved draft (conversation 8, model 3), sequence and timing only:
// the cylinder turns (~0.36 s), the hammer falls, then a live chamber flashes and recoils, a blank
// one gives a dry click (a small shake, no flame). The CSS classes and keyframes are in style.css;
// SHOT_TIMING mirrors them for the screen's waits.
//
// Pivots are data, not CSS: each moving part sits in a group moved to its pivot, and the part's
// own drawing is moved back by the same amount. The part then turns / scales around its local
// origin (CSS transform-box: view-box, transform-origin 0 0), whatever the revolver. The only
// per-revolver CSS value is the cylinder marks' spacing (--rv-step), set on the element.

import { svg } from './dom.js';
import { DEFAULT_REVOLVER, FLASH, FLASH_ORIGIN, REVOLVERS, isRevolverId } from './revolvers.js';

/** Milliseconds, matching the keyframes in style.css (.revolver.is-live / .is-blank). */
export const SHOT_TIMING = Object.freeze({
  aim: 380, // the revolver turns to the target (transition)
  live: 950, // cylinder 360 + hammer at 380 + flash / recoil until ~950
  blank: 700, // cylinder 360 + hammer at 380 + click until ~650
  reducedAim: 0, // Hareketler off (decision Q53)
  reducedLive: 500, // only the flash and the hammer
  reducedBlank: 300,
  hold: 250, // a short pause before the result shows on the seats
});

/** The classes of the moving parts, which the CSS animations use. */
export const REVOLVER_PARTS = Object.freeze(['rv-flash', 'rv-body', 'rv-flutes', 'rv-hammer']);

let serial = 0; // unique pattern / clip ids for every drawing on the page

const at = ([x, y]) => `translate(${x} ${y})`;
const back = ([x, y]) => `translate(${-x} ${-y})`;

/** A part that turns / scales around `pivot`: [outer group at the pivot, [part, [drawing]]]. */
function pivoted(pivot, className, children) {
  return ['g', { transform: at(pivot) }, ['g', { class: className }, ['g', { transform: back(pivot) }, ...children]]];
}

function withIds(node, ids) {
  if (typeof node === 'string') return node;
  const [tag, attrs, ...children] = node;
  const out = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === 'url(#HATCH)') out[key] = `url(#${ids.hatch})`;
    else if (value === 'url(#GRIP)') out[key] = `url(#${ids.grip})`;
    else if (value === 'GRIP_PATH') out[key] = ids.gripPath;
    else out[key] = value;
  }
  return [tag, out, ...children.map((child) => withIds(child, ids))];
}

/**
 * The static description of a revolver for svg(): [tag, attrs, ...children]. Unknown ids draw
 * the default.
 * @param {string} id a revolver id
 * @param {{ uid?: string, className?: string, width?: number, height?: number }} options
 */
export function revolverTree(id, { uid = `rv${++serial}`, className = 'revolver-svg', width = 180, height = 114 } = {}) {
  const chosen = isRevolverId(id) ? id : DEFAULT_REVOLVER;
  const data = REVOLVERS[chosen];
  const ids = { hatch: `${uid}-k`, grip: `${uid}-g`, flutes: `${uid}-c`, gripPath: data.grip };
  const { flutes, pivots } = data;
  const flutesGroup = ['g', { 'clip-path': `url(#${ids.flutes})` },
    ['g', { class: 'rv-flutes', 'data-step': flutes.step }, ...flutes.marks]];
  const body = data.body.map((node) => (node === 'FLUTES' ? flutesGroup : withIds(node, ids)));
  const defs = ['defs', {},
    data.hatch ? ['pattern', { id: ids.hatch, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      ['path', { d: 'M0 0 H5 M0 0 V5', stroke: data.hatch, 'stroke-width': 1 }]] : null,
    ['clipPath', { id: ids.grip }, ['path', { d: data.grip }]],
    ['clipPath', { id: ids.flutes }, ['rect', { ...flutes.clip }]]].filter(Boolean);
  // The flash drawing is made for FLASH_ORIGIN: move it to this revolver's muzzle.
  const shift = [pivots.muzzle[0] - FLASH_ORIGIN[0], pivots.muzzle[1] - FLASH_ORIGIN[1]];
  const flash = pivoted(pivots.muzzle, 'rv-flash', [['g', { transform: at(shift) }, ...FLASH]]);
  const hammer = pivoted(pivots.hammer, 'rv-hammer', [data.hammer]);
  return ['svg', {
    class: className, width, height, viewBox: '40 0 300 190', 'aria-hidden': 'true', focusable: 'false', 'data-revolver': chosen,
  },
  defs,
  flash,
  pivoted(pivots.body, 'rv-body', [...body, hammer])];
}

/**
 * A new revolver SVG element (decorative; the screen labels the revolver's direction).
 * @param {string} [id] a revolver id (default: Musul Gravürü)
 */
export function revolverSvg(id = DEFAULT_REVOLVER, options = {}) {
  const el = svg(revolverTree(id, options));
  // The cylinder marks' spacing: one slide of the keyframes (rv-spin) is one mark.
  const marks = el.querySelector('.rv-flutes');
  if (marks) marks.style.setProperty('--rv-step', `${marks.getAttribute('data-step')}px`);
  return el;
}
