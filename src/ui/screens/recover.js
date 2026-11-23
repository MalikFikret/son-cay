// "Yerine dön": a player on another device (or another tab) picks their name, then types their
// Şifre. After a wrong Şifre (or a refused claim) the button waits 2 seconds, mirroring the
// server-side limit of one attempt per seat every 2 seconds.

import { h } from '../dom.js';
import { errorLine, header, markInvalid, pinField, screen } from '../components.js';
import { RETRY_WAIT_CODES, RETRY_WAIT_SECONDS, errorMessage } from '../messages.js';
import { hashFor } from '../routes.js';
import { ROOM_ERR, isValidPin } from '../../rooms/index.js';

const BUTTON_TEXT = 'Yerine dön';

/**
 * @param {{ summary: { code, hostSeat, seats } }} params
 */
export function recoverScreen(ctx, view, { summary }) {
  const pin = pinField('rpin', null, 'rerr');
  const pinError = errorLine('rerr');
  const seatError = errorLine('seat-error');
  pin.el.append(pinError.el);
  const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: BUTTON_TEXT });
  let waitTimer = null;
  view.onLeave(() => clearInterval(waitTimer));

  const options = summary.seats.map((seat) => {
    const radio = h('input', { type: 'radio', name: 'seat', value: seat.seatId, class: 'seat-radio' });
    radio.addEventListener('change', () => {
      seatError.clear();
      for (const other of grid.querySelectorAll('.seat-option')) {
        other.classList.toggle('is-selected', other.contains(radio) && radio.checked);
      }
    });
    return h('label', { class: 'seat-option' },
      radio,
      h('span', { class: 'seat-text' },
        h('span', { class: 'seat-name', text: seat.name }),
        seat.seatId === summary.hostSeat ? h('span', { class: 'seat-tag', text: 'masa sahibi' }) : null));
  });
  const grid = h('div', { class: 'seat-grid' }, options);

  pin.input.addEventListener('input', () => {
    pinError.clear();
    markInvalid(pin.input, false);
  });

  function selectedSeat() {
    return grid.querySelector('input[name="seat"]:checked')?.value ?? null;
  }

  // Disable the button and count down: "Bekle… 2", "Bekle… 1", then enabled again.
  function waitBeforeRetry() {
    let left = RETRY_WAIT_SECONDS;
    submit.disabled = true;
    submit.textContent = `Bekle… ${left}`;
    clearInterval(waitTimer);
    waitTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        submit.textContent = `Bekle… ${left}`;
        return;
      }
      clearInterval(waitTimer);
      waitTimer = null;
      submit.textContent = BUTTON_TEXT;
      submit.disabled = false;
    }, 1000);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submit.disabled) return;
    const seatId = selectedSeat();
    if (seatId === null) return seatError.show(errorMessage(ROOM_ERR.INVALID_SEAT));
    if (!isValidPin(pin.input.value)) {
      pinError.show(errorMessage(ROOM_ERR.INVALID_PIN));
      markInvalid(pin.input, true);
      pin.input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Bir saniye…';
    try {
      await ctx.api.recoverSeat({ uid: ctx.uid, code: summary.code, seatId, pin: pin.input.value });
    } catch (failure) {
      if (!view.active()) return;
      if (failure?.code === ROOM_ERR.ROOM_NOT_FOUND) {
        // The table was closed meanwhile.
        pin.input.value = '';
        ctx.roomClosed(summary.code);
        return;
      }
      pinError.show(errorMessage(failure));
      if (RETRY_WAIT_CODES.includes(failure?.code)) {
        markInvalid(pin.input, failure.code === ROOM_ERR.WRONG_PIN);
        waitBeforeRetry();
      } else {
        submit.textContent = BUTTON_TEXT;
        submit.disabled = false;
      }
      return;
    }
    pin.input.value = '';
    if (view.active()) ctx.enterTable(summary.code);
  }

  const top = header({ title: 'Yerine dön', subtitle: `Masa ${summary.code}`, onBack: () => ctx.go(hashFor.table(summary.code)) });
  const form = h('form', { class: 'screen-form', novalidate: true, on: { submit: onSubmit } },
    h('div', { class: 'stack' },
      h('fieldset', { class: 'seat-fieldset', 'aria-describedby': 'seat-error' },
        h('legend', { class: 'label', text: 'Adını seç' }),
        grid,
        seatError.el),
      pin.el),
    h('div', { class: 'bottom' }, submit));
  return screen('screen-recover', top.el, form);
}
