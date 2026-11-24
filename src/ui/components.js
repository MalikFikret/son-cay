// Pieces shared by several screens: icons, the screen frame, the header with its back button,
// form fields and the error line.

import { NAME_MAX } from '../rooms/index.js';
import { h, svg } from './dom.js';
import { LANGUAGES, getLanguage, hasText, languageName, setLanguage, t } from './i18n/i18n.js';

export const ICONS = Object.freeze({
  back: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['path', { d: 'M11 3 L5 9 L11 15', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
  book: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['path', { d: 'M3 3.5 H8 C8.6 3.5 9 3.9 9 4.5 V15 C9 14.2 8.4 13.6 7.6 13.6 H3 Z M15 3.5 H10 C9.4 3.5 9 3.9 9 4.5 V15 C9 14.2 9.6 13.6 10.4 13.6 H15 Z', fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }]],
  gear: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['circle', { cx: 9, cy: 9, r: 2.6, fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5 }],
    ['path', { d: 'M9 1.8 V4 M9 14 V16.2 M1.8 9 H4 M14 9 H16.2 M3.9 3.9 L5.5 5.5 M12.5 12.5 L14.1 14.1 M3.9 14.1 L5.5 12.5 M12.5 5.5 L14.1 3.9', stroke: '#3FB5AC', 'stroke-width': 1.5, 'stroke-linecap': 'round' }]],
  info: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true', class: 'notice-icon' },
    ['circle', { cx: 9, cy: 9, r: 7.5, fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5 }],
    ['path', { d: 'M9 8 V13 M9 5 V5.5', stroke: '#3FB5AC', 'stroke-width': 1.8, 'stroke-linecap': 'round' }]],
  table: ['svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
    ['rect', { x: 1.5, y: 2, width: 13, height: 12, rx: 2, fill: 'none', stroke: '#3FB5AC', 'stroke-width': 1.5 }],
    ['path', { d: 'M1.5 6 H14.5 M1.5 10 H14.5 M6 6 V14', stroke: '#3FB5AC', 'stroke-width': 1.5 }]],
  link: ['svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
    ['path', { d: 'M6.5 9.5 L9.5 6.5 M7 4.5 L8.5 3 C9.9 1.6 12.1 1.6 13.5 3 C14.9 4.4 14.9 6.6 13.5 8 L12 9.5 M9 11.5 L7.5 13 C6.1 14.4 3.9 14.4 2.5 13 C1.1 11.6 1.1 9.4 2.5 8 L4 6.5', fill: 'none', stroke: '#15100C', 'stroke-width': 1.6, 'stroke-linecap': 'round' }]],
  dots: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['circle', { cx: 4, cy: 9, r: 1.6, fill: '#EFE6D6' }],
    ['circle', { cx: 9, cy: 9, r: 1.6, fill: '#EFE6D6' }],
    ['circle', { cx: 14, cy: 9, r: 1.6, fill: '#EFE6D6' }]],
  minus: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
    ['path', { d: 'M2 7 H12', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round' }]],
  plus: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
    ['path', { d: 'M2 7 H12 M7 2 V12', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round' }]],
  chevron: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true', class: 'chevron' },
    ['path', { d: 'M5 2 L10 7 L5 12', fill: 'none', stroke: '#B8AD9C', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
  close: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
    ['path', { d: 'M2 2 L12 12 M12 2 L2 12', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round' }]],
  up: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
    ['path', { d: 'M2 9 L7 4 L12 9', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
  down: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
    ['path', { d: 'M2 5 L7 10 L12 5', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
  expand: ['svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true', class: 'expand-icon' },
    ['path', { d: 'M2 5 L7 10 L12 5', fill: 'none', stroke: '#B8AD9C', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]],
  crown: ['svg', { width: 14, height: 12, viewBox: '0 0 14 12', 'aria-hidden': 'true' },
    ['path', { d: 'M1 10 L2 3 L5 6 L7 1 L9 6 L12 3 L13 10 Z', fill: '#3FB5AC' }]],
  glassFull: ['svg', { width: 8, height: 12, viewBox: '0 0 10 15', 'aria-hidden': 'true' },
    ['path', { d: 'M0.5 0.5 H9.5 L7 6 L8.5 14.5 H1.5 L3 6 Z', fill: '#B4532A', stroke: '#EFE6D6', 'stroke-opacity': 0.55, 'stroke-width': 1 }]],
  glassEmpty: ['svg', { width: 8, height: 12, viewBox: '0 0 10 15', 'aria-hidden': 'true' },
    ['path', { d: 'M0.5 0.5 H9.5 L7 6 L8.5 14.5 H1.5 L3 6 Z', fill: 'none', stroke: '#EFE6D6', 'stroke-opacity': 0.55, 'stroke-width': 1 }]],
  clock: ['svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
    ['circle', { cx: 9, cy: 9, r: 7.5, fill: 'none', stroke: '#B8AD9C', 'stroke-width': 1.5 }],
    ['path', { d: 'M9 4.5 V9 L12 11', fill: 'none', stroke: '#B8AD9C', 'stroke-width': 1.5, 'stroke-linecap': 'round' }]],
  // The glass is the only icon with a name (aria-label, added by icon() in the current language).
  glass: ['svg', { role: 'img', width: 70, height: 104, viewBox: '0 0 70 104' },
    ['ellipse', { cx: 35, cy: 98, rx: 30, ry: 5, fill: 'none', stroke: '#2F8F88', 'stroke-width': 2 }],
    ['path', { d: 'M6 6 H64 L50 44 L58 94 H12 L20 44 Z', fill: 'none', stroke: '#EFE6D6', 'stroke-opacity': 0.8, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }],
    ['path', { d: 'M14 74 H56 L58 92 H12 Z', fill: '#B4532A' }],
    ['path', { d: 'M27 14 C26 24 30 28 34 30', fill: 'none', stroke: '#F2ECDD', 'stroke-opacity': 0.5, 'stroke-width': 2, 'stroke-linecap': 'round' }]],
});

const ICON_LABELS = Object.freeze({ glass: 'common.teaGlass' });

export function icon(name) {
  const el = svg(ICONS[name]);
  if (Object.prototype.hasOwnProperty.call(ICON_LABELS, name)) el.setAttribute('aria-label', t(ICON_LABELS[name]));
  return el;
}

/** The full-height column every screen lives in. */
export function screen(className, ...children) {
  return h('div', { class: `screen ${className}` }, ...children);
}

/** Header with the back button, a title (Rakkas) and a small subtitle. */
export function header({ title, subtitle, onBack }) {
  const subtitleEl = h('span', { class: 'header-sub', text: subtitle ?? '' });
  const el = h('header', { class: 'header' },
    h('button', { type: 'button', class: 'back', 'aria-label': t('common.back'), on: { click: onBack } }, icon('back')),
    h('div', { class: 'header-text' },
      h('h1', { class: 'header-title', text: title }),
      subtitleEl));
  return { el, setSubtitle: (text) => { subtitleEl.textContent = text; } };
}

/** An error line under a field (role=alert so screen readers announce it). */
export function errorLine(id) {
  const el = h('p', { class: 'field-error', id, role: 'alert', hidden: true });
  return {
    el,
    show(text) {
      el.textContent = text;
      el.hidden = false;
    },
    clear() {
      el.textContent = '';
      el.hidden = true;
    },
  };
}

/** The name field ("Adın"). */
export function nameField(id) {
  const input = h('input', {
    id, type: 'text', class: 'input input-name', maxlength: NAME_MAX, autocomplete: 'nickname',
    autocapitalize: 'words', spellcheck: 'false',
  });
  const el = h('div', { class: 'field' },
    h('label', { class: 'label', for: id, text: t('fields.name') }),
    input,
    h('span', { class: 'hint', text: t('fields.nameHint') }));
  return { el, input };
}

/**
 * The PIN field ("Şifren"): 4 digits, masked, never stored. Non-digits are dropped as they are typed.
 * @param {string} id
 * @param {string | null} hint
 */
export function pinField(id, hint, describedBy) {
  const input = h('input', {
    id, type: 'password', class: 'input input-pin', inputmode: 'numeric', maxlength: 4,
    autocomplete: 'off', pattern: '[0-9]{4}', 'aria-describedby': describedBy,
  });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (digits !== input.value) input.value = digits;
  });
  const el = h('div', { class: 'field' },
    h('label', { class: 'label', for: id, text: t('fields.pin') }),
    input,
    hint ? h('span', { class: 'hint', text: hint }) : null);
  return { el, input };
}

/** Marks a field as wrong (red border) until it is typed in again. */
export function markInvalid(input, invalid) {
  input.classList.toggle('is-invalid', invalid);
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** A primary button that shows `busyText` while `task` runs. Returns the task's result. */
export async function whileBusy(button, busyText, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await task();
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

/**
 * The language switch (decision Q71): one button per language, each named in its own language
 * ("Türkçe" / "English"; `compact`: "TR" / "EN" with the full name as its label), the current one
 * highlighted. A tap calls setLanguage(); app.js then draws the current screen again. Nothing is
 * written to the database.
 */
export function languageSwitch({ compact = false } = {}) {
  const current = getLanguage();
  return h('div', { class: compact ? 'lang-switch is-compact' : 'lang-switch', role: 'group', 'aria-label': t('common.language') },
    LANGUAGES.map((lang) => h('button', {
      type: 'button',
      class: lang === current ? 'lang-option is-current' : 'lang-option',
      lang,
      'aria-pressed': String(lang === current),
      'aria-label': compact ? languageName(lang) : null,
      text: languageName(lang, { short: compact }),
      on: { click: () => { if (lang !== getLanguage()) setLanguage(lang); } },
    })));
}

/** A short centered "loading" placeholder for screens that read before they can draw. */
export function loading(text = t('common.loading')) {
  return h('p', { class: 'loading', role: 'status', text });
}

/**
 * Copies text to the clipboard: the Clipboard API, else the older copy command on a hidden,
 * temporary text field. Never throws.
 * @returns {Promise<boolean>} true if copied
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = h('textarea', { class: 'offscreen', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
    field.value = text;
    document.body.append(field);
    try {
      field.select();
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }
}

/** The name of a game mode ("Klasik" / "Özel") in the current language, '' for anything else. */
export function modeLabel(mode) {
  return typeof mode === 'string' && /^[a-z]+$/.test(mode) && hasText(`modes.${mode}`) ? t(`modes.${mode}`) : '';
}

/** The one-line explanation of a game mode, '' for anything else. */
export function modeHint(mode) {
  return typeof mode === 'string' && /^[a-z]+$/.test(mode) && hasText(`modeHints.${mode}`) ? t(`modeHints.${mode}`) : '';
}
