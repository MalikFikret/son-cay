// Giriş: the table code and "Masaya katıl", "Yeni masa kur", the (not yet built) "Nasıl oynanır"
// and "Ayarlar", the copyright line and the "Hakkında" link.

import { h } from '../dom.js';
import { errorLine, icon, markInvalid, screen, whileBusy } from '../components.js';
import { FORM_MESSAGES, errorMessage } from '../messages.js';
import { codeFromText, hashFor } from '../routes.js';
import { tableGuard } from '../home-model.js';
import { createHomeBar } from '../home-bar.js';
import { CODE_LENGTH } from '../../rooms/index.js';

/**
 * @param {{ message?: string, info?: boolean }} params `info`: the message confirms a successful
 *   action (neutral style, role status), otherwise it is an error
 */
export function homeScreen(ctx, view, { message, info = false } = {}) {
  // Seated at a table (decision Q70): the "Masaya dön" bar, and one table per player.
  const held = ctx.keeper?.current() ?? null;
  const bar = held ? createHomeBar(ctx, view, held) : null;

  const codeInput = h('input', {
    id: 'code', type: 'text', class: 'input input-code', maxlength: CODE_LENGTH, autocomplete: 'off',
    autocapitalize: 'characters', spellcheck: 'false', placeholder: '4KX9QZ', 'aria-describedby': 'code-error',
    enterkeyhint: 'go',
  });
  const error = errorLine('code-error');
  const join = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Masaya katıl' });

  // A pasted invite link becomes its code (the field only holds 6 characters).
  codeInput.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text') ?? '';
    const code = codeFromText(text);
    if (code !== null) {
      event.preventDefault();
      codeInput.value = code;
      clearError();
    }
  });
  codeInput.addEventListener('input', clearError);

  function clearError() {
    error.clear();
    markInvalid(codeInput, false);
  }

  function showError(text) {
    error.show(text);
    markInvalid(codeInput, true);
    codeInput.focus();
  }

  async function onJoin(event) {
    event.preventDefault();
    if (join.disabled) return;
    const typed = codeInput.value.trim();
    if (typed === '') return showError(FORM_MESSAGES.CODE_EMPTY);
    const code = codeFromText(typed);
    if (code === null) return showError(errorMessage('INVALID_CODE'));
    codeInput.value = code;
    // One table per player: my own table opens; another one is refused before any request.
    const guard = tableGuard({ heldCode: ctx.keeper?.current()?.code ?? null, intent: 'join', code });
    if (guard.sameTable) return ctx.go(hashFor.table(code));
    if (!guard.allowed) return showError(guard.message);
    try {
      // Check the table exists before leaving the screen, so a typo is shown right here.
      await whileBusy(join, 'Bir saniye…', () => ctx.api.getRoomSummary({ uid: ctx.uid, code }));
    } catch (failure) {
      if (view.active()) showError(errorMessage(failure));
      return;
    }
    if (view.active()) ctx.go(hashFor.table(code));
  }

  // A confirmation (e.g. "Masayı kapattın.") is not an error: shown in the neutral style.
  const infoLine = h('p', { class: 'field-error status-line', role: 'status', hidden: true });
  function onCreate() {
    const guard = tableGuard({ heldCode: ctx.keeper?.current()?.code ?? null, intent: 'create' });
    if (!guard.allowed) {
      error.show(guard.message);
      infoLine.hidden = true;
      return;
    }
    ctx.go(hashFor.create());
  }

  if (message && info) {
    infoLine.textContent = message;
    infoLine.hidden = false;
  } else if (message) {
    error.show(message);
  }
  codeInput.addEventListener('input', () => { infoLine.hidden = true; });

  const form = h('form', { class: 'home-actions', novalidate: true, on: { submit: onJoin } },
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'code', text: 'Masa kodu' }),
      codeInput,
      error.el,
      infoLine),
    join,
    h('div', { class: 'divider' }, h('span', { class: 'rule' }), h('span', { text: 'ya da' }), h('span', { class: 'rule' })),
    h('button', { type: 'button', class: 'btn btn-outline', text: 'Yeni masa kur', on: { click: onCreate } }),
    h('div', { class: 'tile-row' },
      h('button', { type: 'button', class: 'btn-tile', disabled: true, title: 'Yakında' }, icon('book'), 'Nasıl oynanır'),
      h('button', { type: 'button', class: 'btn-tile', disabled: true, title: 'Yakında' }, icon('gear'), 'Ayarlar')),
    h('p', { class: 'small-note', text: 'Hesap yok, kayıt yok. Davet bağlantısıyla geldiysen kod hazır.' }),
    h('div', { class: 'footer' },
      h('span', { text: '© 2026 Malik Fikret. Tüm hakları saklıdır.' }),
      h('span', { 'aria-hidden': 'true', text: '·' }),
      h('a', { href: hashFor.about(), class: 'footer-link', text: 'Hakkında' })));

  return screen('screen-home',
    bar,
    h('div', { class: 'brand' },
      icon('glass'),
      h('h1', { class: 'brand-title', text: 'Son Çay' }),
      h('p', { class: 'brand-tagline', text: 'Masaya otur, tabancayı çevir. Son çay kimde kalırsa o kazanır.' })),
    form);
}
