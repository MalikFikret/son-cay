// "Masaya dön" on Giriş (decision Q70): while this tab holds a seat, a bar at the top of Giriş
// leads back to the table. Neutral; red "Sıra sende · N" while it is my turn in a running match.
//
// It listens only to what it needs: my own watchMatch view (the turn; the match node only exists
// once a match started) and the server time offset for the seconds. Presence and the host
// watcher are the seat keeper's (they never stop here). A lost seat or a closed room goes to
// ctx.onSeatProblem, which hides the bar (and shows "Masa kapatıldı" for a closed room).
// Everything stops when Giriş is left.

import { h } from './dom.js';
import { icon } from './components.js';
import { TEXT } from './messages.js';
import { hashFor } from './routes.js';
import { BAR, homeBarState } from './home-model.js';
import { msLeft, secondsShown } from './table-model.js';

/**
 * @param {object} ctx { api, uid, go, watchServerOffset, onSeatProblem }
 * @param {object} view { active(), onLeave(fn) }
 * @param {{ code: string, seatId: string }} held
 * @returns {HTMLElement}
 */
export function createHomeBar(ctx, view, held) {
  const title = h('span', { class: 'home-bar-title', text: TEXT.backToTable });
  const seconds = h('span', { class: 'home-bar-seconds' });
  const codeText = h('span', { class: 'home-bar-code', text: TEXT.homeBarTable(held.code) });
  const el = h('button', { type: 'button', class: 'home-bar' },
    title, seconds,
    h('span', { class: 'home-bar-end' }, codeText, icon('chevron')));
  el.addEventListener('click', () => ctx.go(hashFor.table(held.code)));

  let match = null; // the latest watchMatch update
  let offset = 0;
  let stopped = false;
  const stops = [];

  function draw() {
    if (stopped) return;
    const state = homeBarState({ held, view: match?.view ?? null });
    el.hidden = state.kind === BAR.HIDDEN;
    const myTurn = state.kind === BAR.MY_TURN;
    el.classList.toggle('is-my-turn', myTurn);
    title.textContent = myTurn ? TEXT.yourTurn : TEXT.backToTable;
    // Red bar: "Sıra sende · 17   Masaya dön · Masa CODE ›"; neutral: "Masaya dön   Masa CODE ›".
    const left = myTurn && match ? secondsShown(msLeft({
      clockAt: match.clockAt, seconds: match.view.config.shotTimeSeconds, kind: match.view.clock.kind, serverNow: Date.now() + offset,
    })) : null;
    seconds.textContent = left === null ? '' : `· ${left}`;
    seconds.hidden = left === null;
    codeText.textContent = myTurn ? `${TEXT.backToTable} · ${TEXT.homeBarTable(held.code)}` : TEXT.homeBarTable(held.code);
  }

  try {
    stops.push(ctx.api.watchMatch({
      uid: ctx.uid,
      code: held.code,
      onUpdate: (update) => { match = update; draw(); },
      onError: (error) => ctx.onSeatProblem(error),
    }));
  } catch (error) {
    ctx.onSeatProblem(error);
  }
  if (typeof ctx.watchServerOffset === 'function') {
    stops.push(ctx.watchServerOffset((value) => { offset = value; draw(); }));
  }
  const tick = setInterval(() => { if (el.classList.contains('is-my-turn')) draw(); }, 1000);

  view.onLeave(() => {
    stopped = true;
    clearInterval(tick);
    for (const stop of stops.splice(0)) {
      try {
        stop();
      } catch {
        // Already stopped.
      }
    }
  });

  draw();
  return el;
}
