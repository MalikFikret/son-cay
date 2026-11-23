// "Masa kapatıldı" (decision Q67): shown for a few seconds to everyone who was at a table when
// its host closed it, and to anyone who comes back to it later (its link, the remembered table,
// seat recovery). Then app.js goes to Giriş; the button goes there at once.

import { h } from '../dom.js';
import { header, icon, screen } from '../components.js';
import { TEXT } from '../messages.js';

/** How long the notice stays before Giriş, in milliseconds. */
export const ROOM_CLOSED_MS = 3500;

/**
 * @param {{ code: string, onHome: () => void }} params
 */
export function closedScreen({ code, onHome }) {
  const top = header({ title: `Masa ${code}`, onBack: onHome });
  return screen('screen-problem', top.el,
    h('div', { class: 'stack' },
      h('div', { class: 'notice', role: 'status' },
        icon('info'),
        h('span', {},
          h('strong', { text: TEXT.roomClosed }),
          ' ',
          TEXT.roomClosedSub))),
    h('div', { class: 'bottom' },
      h('button', { type: 'button', class: 'btn btn-primary', text: TEXT.toHome, on: { click: onHome } })));
}
