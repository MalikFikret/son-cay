// Giriş: the TR / EN switch, the table code and "Masaya katıl", "Yeni masa kur", "Nasıl oynanır"
// (decision Q73), "Ayarlar" (step 4.4a), the copyright line and the "Hakkında" link.

import { h } from '../dom.js';
import { errorLine, icon, languageSwitch, markInvalid, screen, whileBusy } from '../components.js';
import { errorMessage } from '../messages.js';
import { t } from '../i18n/i18n.js';
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
    autocapitalize: 'characters', spellcheck: 'false', placeholder: t('home.codePlaceholder'), 'aria-describedby': 'code-error',
    enterkeyhint: 'go',
  });
  const error = errorLine('code-error');
  const join = h('button', { type: 'submit', class: 'btn btn-primary', text: t('home.join') });

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
    if (typed === '') return showError(errorMessage('CODE_EMPTY'));
    const code = codeFromText(typed);
    if (code === null) return showError(errorMessage('INVALID_CODE'));
    codeInput.value = code;
    // One table per player: my own table opens; another one is refused before any request.
    const guard = tableGuard({ heldCode: ctx.keeper?.current()?.code ?? null, intent: 'join', code });
    if (guard.sameTable) return ctx.go(hashFor.table(code));
    if (!guard.allowed) return showError(guard.message);
    try {
      // Check the table exists before leaving the screen, so a typo is shown right here.
      await whileBusy(join, t('common.oneSecond'), () => ctx.api.getRoomSummary({ uid: ctx.uid, code }));
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
      h('label', { class: 'label', for: 'code', text: t('common.tableCodeLabel') }),
      codeInput,
      error.el,
      infoLine),
    join,
    h('div', { class: 'divider' }, h('span', { class: 'rule' }), h('span', { text: t('home.or') }), h('span', { class: 'rule' })),
    h('button', { type: 'button', class: 'btn btn-outline', text: t('home.create'), on: { click: onCreate } }),
    h('div', { class: 'tile-row' },
      h('button', { type: 'button', class: 'btn-tile', on: { click: () => ctx.go(hashFor.howTo()) } }, icon('book'), t('common.howToPlay')),
      h('button', { type: 'button', class: 'btn-tile', on: { click: () => ctx.go(hashFor.settings()) } }, icon('gear'), t('common.settings'))),
    h('p', { class: 'small-note', text: t('home.note') }),
    h('div', { class: 'footer' },
      h('span', { text: t('common.copyright') }),
      h('span', { 'aria-hidden': 'true', text: '·' }),
      h('a', { href: hashFor.about(), class: 'footer-link', text: t('about.title') })));

  return screen('screen-home',
    bar,
    // The TR / EN switch in the top corner (decision Q71), over the brand's top space.
    h('div', { class: 'home-top' }, languageSwitch({ compact: true })),
    h('div', { class: 'brand' },
      icon('glass'),
      h('h1', { class: 'brand-title', text: t('app.name') }),
      h('p', { class: 'brand-tagline', text: t('home.tagline') })),
    form);
}
