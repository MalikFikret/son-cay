// "Masaya otur": sit at an existing table (join) or at a new one (create). The create screen is
// the join screen without the seated list (and without the running-match notice and the "Bu
// masada zaten yerim var" link). A new table is private and Classic; its settings are chosen
// later in the lobby.

import { h } from '../dom.js';
import { errorLine, header, icon, markInvalid, modeLabel, nameField, pinField, screen, whileBusy } from '../components.js';
import { FORM_MESSAGES, errorMessage } from '../messages.js';
import { hashFor } from '../routes.js';
import { ROOM_ERR, isValidPin, normalizeName } from '../../rooms/index.js';

const PIN_HINT = '4 rakamlı şifreni kendin seç. Başka bir cihazdan yerine dönmek için gerekir, kimseye söyleme.';

/**
 * @param {object} ctx
 * @param {object} view
 * @param {{ summary?: { code, mode, status, seats } }} params  summary: join; none: create
 */
export function sitScreen(ctx, view, { summary } = {}) {
  const joining = summary !== undefined;
  const name = nameField('name');
  const pin = pinField('pin', PIN_HINT, 'pin-error');
  const nameError = errorLine('name-error');
  const pinError = errorLine('pin-error');
  const formError = errorLine('form-error');
  name.input.setAttribute('aria-describedby', 'name-error');
  name.el.append(nameError.el);
  pin.el.append(pinError.el);

  const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: joining ? 'Masaya otur' : 'Masayı kur' });

  name.input.addEventListener('input', () => {
    nameError.clear();
    markInvalid(name.input, false);
    formError.clear();
  });
  pin.input.addEventListener('input', () => {
    pinError.clear();
    markInvalid(pin.input, false);
    formError.clear();
  });

  function fail(line, input, text) {
    line.show(text);
    if (input) {
      markInvalid(input, true);
      input.focus();
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submit.disabled) return;
    formError.clear();
    const playerName = normalizeName(name.input.value);
    if (name.input.value.trim() === '') return fail(nameError, name.input, FORM_MESSAGES.NAME_EMPTY);
    if (playerName === null) return fail(nameError, name.input, errorMessage(ROOM_ERR.INVALID_NAME));
    if (!isValidPin(pin.input.value)) return fail(pinError, pin.input, errorMessage(ROOM_ERR.INVALID_PIN));

    let code;
    try {
      code = await whileBusy(submit, 'Bir saniye…', async () => {
        if (joining) {
          await ctx.api.joinRoom({ uid: ctx.uid, code: summary.code, name: playerName, pin: pin.input.value });
          return summary.code;
        }
        const created = await ctx.api.createRoom({
          uid: ctx.uid, name: playerName, pin: pin.input.value, visibility: 'private', mode: 'classic',
        });
        return created.code;
      });
    } catch (failure) {
      if (!view.active()) return;
      if (joining && failure?.code === ROOM_ERR.ROOM_NOT_FOUND) {
        // The table was closed meanwhile.
        pin.input.value = '';
        ctx.roomClosed(summary.code);
        return;
      }
      if (failure?.code === ROOM_ERR.NAME_TAKEN || failure?.code === ROOM_ERR.INVALID_NAME) {
        fail(nameError, name.input, errorMessage(failure));
      } else if (failure?.code === ROOM_ERR.INVALID_PIN) {
        fail(pinError, pin.input, errorMessage(failure));
      } else {
        fail(formError, null, errorMessage(failure));
      }
      return;
    }
    // The Şifre is never kept: clear the field before leaving the screen.
    pin.input.value = '';
    if (view.active()) ctx.enterTable(code);
  }

  const top = joining
    ? header({
      title: `Masa ${summary.code}`,
      subtitle: [modeLabel(summary.mode), `${summary.seats.length} oyuncu`].filter(Boolean).join(' · '),
      onBack: () => ctx.go(hashFor.home()),
    })
    : header({ title: 'Yeni masa', subtitle: 'Klasik · ayarlar bekleme salonunda', onBack: () => ctx.go(hashFor.home()) });

  const body = h('div', { class: 'stack' });
  if (joining) {
    body.append(
      h('div', { class: 'field' },
        h('span', { class: 'label', id: 'seated-label', text: 'Masada oturanlar' }),
        h('ul', { class: 'chips', 'aria-labelledby': 'seated-label' },
          summary.seats.map((seat) => h('li', { class: 'chip', text: seat.name })))),
    );
    if (summary.status === 'playing') {
      body.append(h('div', { class: 'notice', role: 'note' },
        icon('info'),
        h('span', { text: 'Şu an bir maç sürüyor. Oturursan izlersin, sonraki maça otomatik katılırsın.' })));
    }
  }
  body.append(name.el, pin.el);

  const bottom = h('div', { class: 'bottom' }, formError.el, submit);
  if (joining) {
    bottom.append(h('a', { class: 'text-link', href: hashFor.recover(summary.code), text: 'Bu masada zaten yerim var' }));
  }

  const form = h('form', { class: 'screen-form', novalidate: true, on: { submit: onSubmit } }, body, bottom);
  return screen('screen-sit', top.el, form);
}
