// The tools (malzemeler) as the player sees them: their names, explanations and tags (from the
// locale) and the approved badge icons, for every screen: the waiting room, the hand, the tool
// card; "Nasıl oynanır" will reuse them. The engine only knows the English ids (TOOL_IDS).
//
// Icons: round badges, viewBox 80, background #1E1814, drawing in #EFE6D6 on a 48 grid moved by
// 16. Frame turquoise (#3FB5AC), copper (#D6804A) for the three tools usable at any time (the
// engine's TOOL_INFO timing 'anytime': Mermi Kalkanı, Malzeme Kalkanı, Pansuman).
// - LARGE: double frame, stroke 2.2, for explanations and announcements;
// - SMALL: single frame, stroke 3 (some details left out), for the player's hand and lists.
// The drawings are copied as they are from the approved design (conversation 10, model 1).
// They are built with svg() from these constants only, never from database text.

import { TOOL_IDS, TOOL_INFO } from '../engine/index.js';
import { svg } from './dom.js';
import { t } from './i18n/i18n.js';

// The approved names, explanations ("Nasıl oynanır · Malzemeler" mock, conversation 11 model 2;
// the tool card uses them now, "Nasıl oynanır" will too) and card tags are locale entries keyed by
// tool id: tools.names / tools.help / tools.tags in src/ui/i18n/.

/**
 * The tags of a tool's card in a mode: timing first ("sıranda" / "her an"), then visibility
 * ("gizli" / "herkes görür"; Çal "herkes görür · ne aldığın gizli"). Kaydır is hidden only in
 * Classic (engine TOOL_INFO hidden 'classic').
 */
export function toolTags(tool, mode = 'classic') {
  if (!isTool(tool)) return [];
  const info = TOOL_INFO[tool];
  const hidden = info.hidden === 'always' || (info.hidden === 'classic' && mode === 'classic');
  let visibility = hidden ? t('tools.tags.hidden') : t('tools.tags.announced');
  if (tool === 'steal') visibility = t('tools.tags.stealAnnounced');
  return [info.timing === 'anytime' ? t('tools.tags.anytime') : t('tools.tags.turn'), visibility];
}

/** The explanation of a tool, or '' for anything that is not a tool id. */
export function toolHelp(tool) {
  return isTool(tool) ? t(`tools.help.${tool}`) : '';
}

export const FRAME_TURQUOISE = '#3FB5AC';
export const FRAME_COPPER = '#D6804A';
export const ICON_SIZES = Object.freeze(['large', 'small']);

// The bullet (mermi) outline, used by several drawings.
const BULLET = 'M0 -11 C3 -8.5 4 -5.5 4 -3 V11 H-4 V-3 C-4 -5.5 -3 -8.5 0 -11 Z';

/** tool id -> { large, small }: the children of the drawing group, as [tag, attrs, ...children]. */
export const TOOL_DRAWINGS = Object.freeze({
  detector: {
    large: [
      ['path', { d: 'M5 16 Q13 11.5 21 15 M27 15 Q35 11.5 43 16' }],
      ['path', { d: 'M3 26 C7 19.5 19 19.5 23 26 C19 32.5 7 32.5 3 26 Z M25 26 C29 19.5 41 19.5 45 26 C41 32.5 29 32.5 25 26 Z' }],
      ['circle', { cx: '15', cy: '26', r: '3.2', fill: '#EFE6D6' }],
      ['circle', { cx: '37', cy: '26', r: '3.2', fill: '#EFE6D6' }],
    ],
    small: [
      ['path', { d: 'M5 16 Q13 11.5 21 15 M27 15 Q35 11.5 43 16' }],
      ['path', { d: 'M3 26 C7 19.5 19 19.5 23 26 C19 32.5 7 32.5 3 26 Z M25 26 C29 19.5 41 19.5 45 26 C41 32.5 29 32.5 25 26 Z' }],
      ['circle', { cx: '15', cy: '26', r: '3.2', fill: '#EFE6D6' }],
      ['circle', { cx: '37', cy: '26', r: '3.2', fill: '#EFE6D6' }],
    ],
  },
  probe: {
    large: [
      ['path', { d: 'M6 30 H42 M24 30 L19 40 H29 Z' }],
      ['path', { d: 'M14 12 C16.8 14 17.8 17 17.8 20 V30 H10.2 V20 C10.2 17 11.2 14 14 12 Z' }],
      ['path', { d: 'M34 12 C36.8 14 37.8 17 37.8 20 V30 H30.2 V20 C30.2 17 31.2 14 34 12 Z' }],
    ],
    small: [
      ['path', { d: 'M6 30 H42 M24 30 L19 40 H29 Z' }],
      ['path', { d: 'M14 12 C16.8 14 17.8 17 17.8 20 V30 H10.2 V20 C10.2 17 11.2 14 14 12 Z' }],
      ['path', { d: 'M34 12 C36.8 14 37.8 17 37.8 20 V30 H30.2 V20 C30.2 17 31.2 14 34 12 Z' }],
    ],
  },
  counter: {
    large: [
      ['circle', { cx: '10', cy: '21', r: '5.5' }],
      ['circle', { cx: '24', cy: '21', r: '5.5' }],
      ['circle', { cx: '38', cy: '21', r: '5.5' }],
      ['path', { d: 'M4 32 V35 H44 V32 M24 35 V40' }],
    ],
    small: [
      ['circle', { cx: '10', cy: '21', r: '5.5' }],
      ['circle', { cx: '24', cy: '21', r: '5.5' }],
      ['circle', { cx: '38', cy: '21', r: '5.5' }],
      ['path', { d: 'M4 32 V35 H44 V32 M24 35 V40' }],
    ],
  },
  skip: {
    large: [
      ['path', { d: 'M3 36 H44 M38 31 L44 36 L38 41' }],
      ['g', { transform: 'translate(11 21)', 'stroke-opacity': '0.45', 'stroke-dasharray': '2 3' }, ['path', { d: BULLET }]],
      ['g', { transform: 'translate(27 21)' }, ['path', { d: BULLET }], ['path', { d: 'M-4 6 H4' }]],
    ],
    small: [
      ['path', { d: 'M3 36 H44 M38 31 L44 36 L38 41' }],
      ['g', { transform: 'translate(24 21)' }, ['path', { d: BULLET }]],
    ],
  },
  swap: {
    large: [
      ['path', { transform: 'translate(13 27) rotate(0) scale(0.85)', d: BULLET }],
      ['path', { transform: 'translate(35 27) rotate(0) scale(0.85)', d: BULLET }],
      ['path', { d: 'M12 13 Q24 3 36 13' }],
      ['path', { d: 'M31.5 11.5 L36 13 L36 8.5' }],
      ['path', { d: 'M36 42 Q24 48 12 42' }],
      ['path', { d: 'M16.5 43.5 L12 42 L12 46.5' }],
    ],
    small: [
      ['path', { transform: 'translate(13 27) rotate(0) scale(0.85)', d: BULLET }],
      ['path', { transform: 'translate(35 27) rotate(0) scale(0.85)', d: BULLET }],
      ['path', { d: 'M12 13 Q24 3 36 13' }],
      ['path', { d: 'M31.5 11.5 L36 13 L36 8.5' }],
    ],
  },
  flip: {
    large: [
      ['path', { transform: 'translate(24 24) rotate(180) scale(1)', d: BULLET }],
      ['path', { d: 'M37 11 A18 18 0 0 1 37 37' }],
      ['path', { d: 'M32 36.5 L37 37 L37.5 32' }],
      ['path', { d: 'M11 37 A18 18 0 0 1 11 11' }],
      ['path', { d: 'M16 11.5 L11 11 L10.5 16' }],
    ],
    small: [
      ['path', { transform: 'translate(24 24) rotate(180) scale(1)', d: BULLET }],
      ['path', { d: 'M37 11 A18 18 0 0 1 37 37' }],
      ['path', { d: 'M11 37 A18 18 0 0 1 11 11' }],
    ],
  },
  shuffle: {
    large: [
      ['path', { d: 'M4 16 H12 C20 16 24 32 32 32 H42' }],
      ['path', { d: 'M38 28 L42 32 L38 36' }],
      ['path', { d: 'M4 32 H12 C20 32 24 16 32 16 H42' }],
      ['path', { d: 'M38 12 L42 16 L38 20' }],
    ],
    small: [
      ['path', { d: 'M4 16 H12 C20 16 24 32 32 32 H42' }],
      ['path', { d: 'M38 28 L42 32 L38 36' }],
      ['path', { d: 'M4 32 H12 C20 32 24 16 32 16 H42' }],
      ['path', { d: 'M38 12 L42 16 L38 20' }],
    ],
  },
  double: {
    large: [
      ['path', { d: 'M24.0 4.0 L28.8 12.5 L38.1 9.9 L35.5 19.2 L44.0 24.0 L35.5 28.8 L38.1 38.1 L28.8 35.5 L24.0 44.0 L19.2 35.5 L9.9 38.1 L12.5 28.8 L4.0 24.0 L12.5 19.2 L9.9 9.9 L19.2 12.5 Z' }],
      ['path', { transform: 'translate(20.5 24.5) rotate(0) scale(0.5)', d: BULLET }],
      ['path', { transform: 'translate(27.5 24.5) rotate(0) scale(0.5)', d: BULLET }],
    ],
    small: [
      ['path', { d: 'M24.0 4.0 L28.8 12.5 L38.1 9.9 L35.5 19.2 L44.0 24.0 L35.5 28.8 L38.1 38.1 L28.8 35.5 L24.0 44.0 L19.2 35.5 L9.9 38.1 L12.5 28.8 L4.0 24.0 L12.5 19.2 L9.9 9.9 L19.2 12.5 Z' }],
      ['path', { transform: 'translate(20.5 24.5) rotate(0) scale(0.5)', d: BULLET }],
      ['path', { transform: 'translate(27.5 24.5) rotate(0) scale(0.5)', d: BULLET }],
    ],
  },
  reverse: {
    large: [
      ['path', { d: 'M34 40 V20 C34 11 14 11 14 20 V31' }],
      ['path', { d: 'M9 26 L14 32 L19 26' }],
    ],
    small: [
      ['path', { d: 'M34 40 V20 C34 11 14 11 14 20 V31' }],
      ['path', { d: 'M9 26 L14 32 L19 26' }],
    ],
  },
  link: {
    large: [
      ['rect', { x: '5', y: '17', width: '22', height: '14', rx: '7', transform: 'rotate(-35 16 24)' }],
      ['rect', { x: '21', y: '17', width: '22', height: '14', rx: '7', transform: 'rotate(-35 32 24)' }],
    ],
    small: [
      ['rect', { x: '5', y: '17', width: '22', height: '14', rx: '7', transform: 'rotate(-35 16 24)' }],
      ['rect', { x: '21', y: '17', width: '22', height: '14', rx: '7', transform: 'rotate(-35 32 24)' }],
    ],
  },
  jail: {
    large: [
      ['rect', { x: '8', y: '7', width: '32', height: '34', rx: '2' }],
      ['path', { d: 'M16 7 V41 M24 7 V41 M32 7 V41 M8 22 H40' }],
    ],
    small: [
      ['rect', { x: '8', y: '7', width: '32', height: '34', rx: '2' }],
      ['path', { d: 'M16 7 V41 M24 7 V41 M32 7 V41 M8 22 H40' }],
    ],
  },
  handSwap: {
    large: [
      ['rect', { x: '4', y: '13', width: '13', height: '19', rx: '2' }],
      ['path', { d: 'M7 35 H17 V16' }],
      ['rect', { x: '29', y: '13', width: '13', height: '19', rx: '2' }],
      ['path', { d: 'M32 35 H42 V16' }],
      ['path', { d: 'M20 24 H28 M22.5 21.5 L20 24 L22.5 26.5 M25.5 21.5 L28 24 L25.5 26.5' }],
    ],
    small: [
      ['rect', { x: '4', y: '13', width: '13', height: '19', rx: '2' }],
      ['path', { d: 'M7 35 H17 V16' }],
      ['rect', { x: '29', y: '13', width: '13', height: '19', rx: '2' }],
      ['path', { d: 'M32 35 H42 V16' }],
      ['path', { d: 'M20 24 H28' }],
    ],
  },
  steal: {
    large: [
      ['path', { d: 'M4 20 C8 13 18 14 24 18.5 C30 14 40 13 44 20 C45 28 37 32 30 28.5 C27 26.5 25.5 25.5 24 25.5 C22.5 25.5 21 26.5 18 28.5 C11 32 3 28 4 20 Z' }],
      ['ellipse', { cx: '15', cy: '22', rx: '4.5', ry: '2.6' }],
      ['ellipse', { cx: '33', cy: '22', rx: '4.5', ry: '2.6' }],
    ],
    small: [
      ['path', { d: 'M4 20 C8 13 18 14 24 18.5 C30 14 40 13 44 20 C45 28 37 32 30 28.5 C27 26.5 25.5 25.5 24 25.5 C22.5 25.5 21 26.5 18 28.5 C11 32 3 28 4 20 Z' }],
      ['ellipse', { cx: '15', cy: '22', rx: '4.5', ry: '2.6' }],
      ['ellipse', { cx: '33', cy: '22', rx: '4.5', ry: '2.6' }],
    ],
  },
  shotShield: {
    large: [
      ['path', { d: 'M24 5 L40 11 V23 C40 33 33 40 24 44 C15 40 8 33 8 23 V11 Z' }],
      ['path', { d: 'M24 15 C27 17 28.5 20 28.5 23 V32 H19.5 V23 C19.5 20 21 17 24 15 Z' }],
      ['path', { d: 'M19.5 28 H28.5' }],
    ],
    small: [
      ['path', { d: 'M24 5 L40 11 V23 C40 33 33 40 24 44 C15 40 8 33 8 23 V11 Z' }],
      ['path', { d: 'M24 15 C27 17 28.5 20 28.5 23 V32 H19.5 V23 C19.5 20 21 17 24 15 Z' }],
    ],
  },
  toolShield: {
    large: [
      ['path', { d: 'M24 5 L40 11 V23 C40 33 33 40 24 44 C15 40 8 33 8 23 V11 Z' }],
      ['rect', { x: '18.5', y: '14', width: '11', height: '16', rx: '2' }],
      ['path', { d: 'M21.5 19 H26.5 M21.5 23 H26.5' }],
    ],
    small: [
      ['path', { d: 'M24 5 L40 11 V23 C40 33 33 40 24 44 C15 40 8 33 8 23 V11 Z' }],
      ['rect', { x: '18.5', y: '14', width: '11', height: '16', rx: '2' }],
    ],
  },
  heal: {
    large: [
      ['path', { d: 'M13.5 33 H27.5 L28.5 41 H12.5 Z', fill: '#B4532A', stroke: 'none' }],
      ['path', { d: 'M9 7 H32 L26.5 22 L29.5 41 H11.5 L14.5 22 Z' }],
      ['ellipse', { cx: '20.5', cy: '43.5', rx: '12', ry: '2' }],
      ['path', { d: 'M39 13 V25 M33 19 H45' }],
    ],
    small: [
      ['path', { d: 'M13.5 33 H27.5 L28.5 41 H12.5 Z', fill: '#B4532A', stroke: 'none' }],
      ['path', { d: 'M9 7 H32 L26.5 22 L29.5 41 H11.5 L14.5 22 Z' }],
      ['path', { d: 'M39 13 V25 M33 19 H45' }],
    ],
  },
});

/** True only for an engine tool id (never for inherited keys such as 'constructor'). */
export function isTool(tool) {
  return typeof tool === 'string' && TOOL_IDS.includes(tool);
}

/** The name of a tool in the current language, or '' for anything that is not a tool id. */
export function toolName(tool) {
  return isTool(tool) ? t(`tools.names.${tool}`) : '';
}

/** Copper frame for the tools usable at any time, turquoise for the others. */
export function frameColor(tool) {
  return TOOL_INFO[tool]?.timing === 'anytime' ? FRAME_COPPER : FRAME_TURQUOISE;
}

/**
 * The badge of a tool as a static description for svg(): [tag, attrs, ...children].
 * @param {string} tool an engine tool id
 * @param {'large' | 'small'} size
 */
export function toolIconTree(tool, size = 'small') {
  if (!isTool(tool) || !ICON_SIZES.includes(size)) throw new Error(`no icon for ${String(tool)} (${String(size)})`);
  const color = frameColor(tool);
  const large = size === 'large';
  const frame = large
    ? [
      ['circle', { cx: '40', cy: '40', r: '38', fill: '#1E1814', stroke: color, 'stroke-width': '2' }],
      ['circle', { cx: '40', cy: '40', r: '33', stroke: color, 'stroke-opacity': '0.5', 'stroke-width': '1' }],
    ]
    : [['circle', { cx: '40', cy: '40', r: '38', fill: '#1E1814', stroke: color, 'stroke-width': '2.4' }]];
  return ['svg', {
    viewBox: '0 0 80 80', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: `tool-icon tool-icon-${size}`, 'aria-hidden': 'true', focusable: 'false',
  },
  ...frame,
  ['g', { transform: 'translate(16 16)', stroke: '#EFE6D6', 'stroke-width': large ? '2.2' : '3' }, ...TOOL_DRAWINGS[tool][size]]];
}

/**
 * The badge of a tool as an SVG element (decorative: aria-hidden; show the name next to it).
 * Size it with CSS (.tool-icon-small / .tool-icon-large).
 */
export function toolIcon(tool, size = 'small') {
  return svg(toolIconTree(tool, size));
}
