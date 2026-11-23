// "Masayı kapat" (decision Q67): the host's low-emphasis control to close the table, with an
// inline confirmation step in the page (no window.confirm). Used by the waiting room and, during
// a match, by the table screen. Not red: red is only for the chosen target and the fire button
// (decision 54).

import { h } from './dom.js';
import { errorLine } from './components.js';
import { TEXT } from './messages.js';

/**
 * @param {{ id: string, onConfirm: () => Promise<string | null> }} options
 *   onConfirm closes the room; it resolves to an error message to show, or null on success
 * @returns {{ el: HTMLElement, update(state: { visible: boolean, enabled: boolean, hint: string | null }): void }}
 */
export function createCloseRoom({ id, onConfirm }) {
  let enabled = false;
  let busy = false;

  const button = h('button', { type: 'button', class: 'btn-close-room', text: TEXT.closeRoom, 'aria-describedby': `${id}-hint` });
  const hint = h('span', { class: 'hint close-room-hint', id: `${id}-hint`, hidden: true });
  const error = errorLine(`${id}-error`);
  const no = h('button', { type: 'button', class: 'btn btn-outline', text: TEXT.cancel });
  const yes = h('button', { type: 'button', class: 'btn btn-close-yes', text: TEXT.closeRoomYes });
  const confirm = h('div', { class: 'close-room-confirm', role: 'group', 'aria-labelledby': `${id}-title`, hidden: true },
    h('p', { class: 'close-room-title', id: `${id}-title`, text: TEXT.closeRoomTitle }),
    h('p', { class: 'muted', text: TEXT.closeRoomNote }),
    error.el,
    h('div', { class: 'dialog-actions' }, no, yes));
  const el = h('section', { class: 'close-room', hidden: true }, button, hint, confirm);

  function closeConfirm() {
    confirm.hidden = true;
    button.hidden = false;
    error.clear();
  }

  button.addEventListener('click', () => {
    if (!enabled || busy) return;
    confirm.hidden = false;
    button.hidden = true;
    error.clear();
    no.focus();
  });
  no.addEventListener('click', () => {
    if (busy) return;
    closeConfirm();
    button.focus();
  });
  yes.addEventListener('click', async () => {
    if (busy || !enabled) return;
    busy = true;
    yes.disabled = true;
    no.disabled = true;
    yes.textContent = TEXT.closingRoom;
    error.clear();
    const failure = await onConfirm();
    busy = false;
    yes.disabled = false;
    no.disabled = false;
    yes.textContent = TEXT.closeRoomYes;
    if (failure) error.show(failure);
  });

  return {
    el,
    update(state) {
      enabled = state.enabled === true;
      el.hidden = !state.visible;
      button.disabled = !enabled;
      hint.textContent = state.hint ?? '';
      hint.hidden = !state.hint;
      // The condition went away (someone came back, or I am no longer the host).
      if ((!enabled || !state.visible) && !busy) closeConfirm();
    },
  };
}
