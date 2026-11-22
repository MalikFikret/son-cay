// The waiting room's bottom sheets: a player's options ("⋯"), the manual seat order, and the
// absent players check before a match starts. Each controller is created once per waiting-room
// screen, follows the live room through sync(), and is destroyed with the screen.

import { h } from './dom.js';
import { errorLine, icon, markInvalid } from './components.js';
import { moveSeat, startCheck } from './lobby-model.js';
import { TEXT, errorMessage } from './messages.js';
import { createSheet } from './sheet.js';
import { NAME_MAX, ROOM_ERR, normalizeName } from '../rooms/index.js';

// Runs an async action from a button: the button is disabled meanwhile, errors go to `error`.
async function run(button, error, task) {
  if (button.disabled) return false;
  button.disabled = true;
  error.clear();
  try {
    await task();
    return true;
  } catch (failure) {
    error.show(errorMessage(failure));
    return false;
  } finally {
    button.disabled = false;
  }
}

const actionButton = (text, className = 'sheet-action') => h('button', { type: 'button', class: className, text });

/**
 * "⋯" next to a player: rename (anyone they may rename), hand the host role over, remove from the
 * table. Which options are shown is decided by playerOptions (lobby-model.js).
 * @param {{ api, uid, code }} ctx
 */
export function createOptionsSheet({ api, uid, code }) {
  const sheet = createSheet();
  const error = errorLine('options-error');
  let current = null; // { row, options }

  function showMenu() {
    const { row, options } = current;
    sheet.setTitle(row.name);
    error.clear();
    const items = [];
    if (options.includes('rename')) items.push(menuItem(TEXT.rename, showRename));
    if (options.includes('handOver')) items.push(menuItem(TEXT.handOver, () => showConfirm(TEXT.handOverConfirm(row.name), TEXT.handOverYes, () => api.handOverHost({ uid, code, seatId: row.seatId }))));
    if (options.includes('kick')) items.push(menuItem(TEXT.kick, () => showConfirm(TEXT.kickConfirm(row.name), TEXT.kickYes, () => api.kickSeat({ uid, code, seatId: row.seatId })), true));
    sheet.body.replaceChildren(h('div', { class: 'sheet-menu' }, items), error.el);
  }

  function menuItem(text, onClick, danger = false) {
    return h('button', { type: 'button', class: danger ? 'sheet-action is-danger' : 'sheet-action', text, on: { click: onClick } });
  }

  function showRename() {
    const { row } = current;
    const input = h('input', {
      id: 'rename-input', type: 'text', class: 'input', maxlength: NAME_MAX, autocomplete: 'off',
      spellcheck: 'false', value: row.name, 'aria-describedby': 'options-error',
    });
    input.addEventListener('input', () => {
      error.clear();
      markInvalid(input, false);
    });
    const save = actionButton(TEXT.save, 'btn btn-primary');
    const cancel = actionButton(TEXT.cancel, 'btn btn-outline');
    const form = h('form', { class: 'sheet-form', novalidate: true },
      h('label', { class: 'label', for: 'rename-input', text: TEXT.newName }),
      input,
      error.el,
      h('div', { class: 'dialog-actions' }, cancel, save));
    cancel.addEventListener('click', showMenu);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = normalizeName(input.value);
      if (name === null) {
        error.show(errorMessage(ROOM_ERR.INVALID_NAME));
        markInvalid(input, true);
        return;
      }
      if (name === row.name) {
        sheet.close();
        return;
      }
      const ok = await run(save, error, () => api.renameSeat({ uid, code, seatId: row.seatId, name }));
      if (ok) sheet.close();
      else markInvalid(input, true);
    });
    save.type = 'submit';
    sheet.body.replaceChildren(form);
    input.focus();
    input.select();
  }

  function showConfirm(question, yesText, action) {
    const yes = actionButton(yesText, 'btn btn-primary');
    const no = actionButton(TEXT.cancel, 'btn btn-outline');
    no.addEventListener('click', showMenu);
    yes.addEventListener('click', async () => {
      if (await run(yes, error, action)) sheet.close();
    });
    sheet.body.replaceChildren(h('p', { class: 'sheet-text', text: question }), error.el, h('div', { class: 'dialog-actions' }, no, yes));
  }

  return {
    /** Opens the menu of a row with the given options (from playerOptions). */
    open(row, options) {
      current = { row, options };
      showMenu();
      sheet.open();
    },
    /** Follows the room: closes if the row is gone or its options changed (role, match). */
    sync(rows, optionsOf) {
      if (!current || !sheet.isOpen()) return;
      const row = rows.find((r) => r.seatId === current.row.seatId);
      const options = row ? optionsOf(row) : [];
      if (!row || options.join() !== current.options.join()) sheet.close();
      else current.row = row;
    },
    destroy: () => sheet.destroy(),
  };
}

/**
 * "Oturma sırasını elle düzenle": a list of the seated players with ↑ / ↓, "Rastgele" (clear the
 * saved order), "Kaydet" and "Vazgeç". The draft follows the room: players who leave disappear,
 * players who sit down are added at the end.
 */
export function createSeatOrderSheet({ api, uid, code }) {
  const sheet = createSheet({ title: TEXT.seatOrderTitle });
  const error = errorLine('seat-order-error');
  const list = h('ol', { class: 'order-list' });
  const save = actionButton(TEXT.save, 'btn btn-primary');
  const cancel = actionButton(TEXT.cancel, 'btn btn-outline');
  const random = h('button', { type: 'button', class: 'link-button', text: TEXT.randomOrder });
  let draft = []; // seat ids
  let names = {};

  sheet.body.append(
    h('p', { class: 'hint', text: TEXT.seatOrderHint }),
    list,
    random,
    error.el,
    h('div', { class: 'dialog-actions' }, cancel, save));

  cancel.addEventListener('click', () => sheet.close());
  save.addEventListener('click', async () => {
    if (await run(save, error, () => api.setSeatOrder({ uid, code, order: draft }))) sheet.close();
  });
  random.addEventListener('click', async () => {
    if (await run(random, error, () => api.clearSeatOrder({ uid, code }))) sheet.close();
  });

  function render(focus) {
    list.replaceChildren(...draft.map((seatId, i) => {
      const name = names[seatId] ?? '';
      const up = h('button', { type: 'button', class: 'stepper-button', 'aria-label': TEXT.moveUp(name), disabled: i === 0 }, icon('up'));
      const down = h('button', { type: 'button', class: 'stepper-button', 'aria-label': TEXT.moveDown(name), disabled: i === draft.length - 1 }, icon('down'));
      up.addEventListener('click', () => move(i, -1));
      down.addEventListener('click', () => move(i, +1));
      return h('li', { class: 'order-row', 'data-seat': seatId },
        h('span', { class: 'order-rank', text: String(i + 1) }),
        h('span', { class: 'order-name', text: name }),
        up, down);
    }));
    // Keep the focus on the moved player's button, so repeated taps keep moving them.
    if (focus) {
      const rowEl = list.querySelector(`[data-seat="${focus.seatId}"]`);
      const button = rowEl?.querySelectorAll('button')[focus.direction < 0 ? 0 : 1];
      if (button && !button.disabled) button.focus();
      else rowEl?.querySelector('button:not(:disabled)')?.focus();
    }
  }

  function move(index, direction) {
    const seatId = draft[index];
    draft = moveSeat(draft, index, direction);
    render({ seatId, direction });
  }

  return {
    /** Opens with the players in their current playing order. */
    open(rows) {
      draft = rows.map((row) => row.seatId);
      names = Object.fromEntries(rows.map((row) => [row.seatId, row.name]));
      error.clear();
      render(null);
      sheet.open();
    },
    sync(rows, stillHost) {
      if (!sheet.isOpen()) return;
      if (!stillHost) {
        sheet.close();
        return;
      }
      const seated = rows.map((row) => row.seatId);
      const next = [...draft.filter((seatId) => seated.includes(seatId)), ...seated.filter((seatId) => !draft.includes(seatId))];
      names = Object.fromEntries(rows.map((row) => [row.seatId, row.name]));
      const changed = next.join() !== draft.join();
      draft = next;
      if (changed || list.childElementCount !== draft.length) render(null);
      else for (const li of list.children) li.querySelector('.order-name').textContent = names[li.dataset.seat] ?? '';
    },
    destroy: () => sheet.destroy(),
  };
}

/**
 * Before starting with absent players: their names, each with "Masadan çıkar", and
 * "Yine de başlat". Everyone seated plays, present or absent.
 */
export function createStartSheet({ api, uid, code, onStart }) {
  const sheet = createSheet({ title: TEXT.absentTitle });
  const error = errorLine('start-error');
  const list = h('ul', { class: 'absent-list' });
  const startButton = actionButton(TEXT.startAnyway, 'btn btn-primary');
  const cancel = actionButton(TEXT.cancel, 'btn btn-outline');
  const tooFew = h('p', { class: 'hint', text: TEXT.startTooFew, hidden: true });
  sheet.body.append(h('p', { class: 'sheet-text', text: TEXT.absentText }), list, tooFew, error.el, h('div', { class: 'dialog-actions' }, cancel, startButton));
  cancel.addEventListener('click', () => sheet.close());
  startButton.addEventListener('click', async () => {
    if (await run(startButton, error, onStart)) sheet.close();
  });

  function render(rows) {
    const { canStart, absent } = startCheck(rows);
    list.replaceChildren(...absent.map((row) => {
      const kick = h('button', { type: 'button', class: 'btn-small is-danger', text: TEXT.kick });
      kick.addEventListener('click', () => run(kick, error, () => api.kickSeat({ uid, code, seatId: row.seatId })));
      return h('li', { class: 'absent-row' },
        h('span', { class: 'presence-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'order-name', text: row.name }),
        row.host ? null : kick);
    }));
    startButton.disabled = !canStart;
    tooFew.hidden = canStart;
  }

  return {
    open(rows) {
      error.clear();
      render(rows);
      sheet.open();
    },
    sync(rows, stillHost, inLobby) {
      if (!sheet.isOpen()) return;
      if (!stillHost || !inLobby) sheet.close();
      else render(rows);
    },
    close: () => sheet.close(),
    destroy: () => sheet.destroy(),
  };
}
