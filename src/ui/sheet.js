// A panel that rises from the bottom of the screen (a modal <dialog>): handle, title, close
// button (X) and a body. Closed by the X, Esc, a tap on the dimmed background, or a swipe down
// on its top part. Used by the waiting room's menus and by the Tablo.

import { h } from './dom.js';
import { icon } from './components.js';
import { TEXT } from './messages.js';

const SWIPE_CLOSE_PX = 80;
let counter = 0;

/**
 * @param {{ title?: string, tall?: boolean, className?: string, onClose?: () => void }} options
 *   tall: about 90% of the screen height (the Tablo); otherwise as tall as its content
 * @returns {{ el: HTMLDialogElement, head: HTMLElement, body: HTMLElement, setTitle(text): void,
 *   open(): void, close(): void, isOpen(): boolean, destroy(): void }}
 */
export function createSheet({ title = '', tall = false, className = '', onClose } = {}) {
  counter += 1;
  const titleId = `sheet-title-${counter}`;
  const titleEl = h('h2', { class: 'sheet-title', id: titleId, text: title });
  const closeButton = h('button', { type: 'button', class: 'sheet-close', 'aria-label': TEXT.close }, icon('close'));
  const head = h('div', { class: 'sheet-head' },
    h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-title-row' }, titleEl, closeButton));
  const body = h('div', { class: 'sheet-body' });
  const panel = h('div', { class: 'sheet-panel' }, head, body);
  const el = h('dialog', { class: ['sheet', tall ? 'sheet-tall' : '', className].filter(Boolean).join(' '), 'aria-labelledby': titleId }, panel);

  closeButton.addEventListener('click', () => close());
  // A tap on the dimmed background (the dialog itself, outside the panel) closes it.
  el.addEventListener('click', (event) => {
    if (event.target === el) close();
  });
  el.addEventListener('close', () => {
    el.style.transform = '';
    if (typeof onClose === 'function') onClose();
  });

  // Swipe down on the top part.
  let startY = null;
  let dragged = 0;
  head.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    startY = event.clientY;
    dragged = 0;
    head.setPointerCapture?.(event.pointerId);
  });
  head.addEventListener('pointermove', (event) => {
    if (startY === null) return;
    dragged = Math.max(0, event.clientY - startY);
    el.style.transform = dragged > 0 ? `translateY(${dragged}px)` : '';
  });
  const endDrag = () => {
    if (startY === null) return;
    startY = null;
    if (dragged > SWIPE_CLOSE_PX) close();
    else el.style.transform = '';
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  function open() {
    if (el.open) return;
    el.style.transform = '';
    if (!el.isConnected) document.body.append(el);
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
  }

  function close() {
    if (!el.open) return;
    if (typeof el.close === 'function') el.close();
    else el.removeAttribute('open');
  }

  return {
    el,
    head,
    body,
    setTitle(text) {
      titleEl.textContent = text;
    },
    open,
    close,
    isOpen: () => el.open,
    destroy() {
      close();
      el.remove();
    },
  };
}
