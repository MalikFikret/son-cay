// Ayarlar (step 4.4a, decisions Q43, Q53, Q55; approved mock: conversation 11, model 3, without
// the "Ateşlemeden önce sor" switch, dropped by Q55): the six revolvers in two columns (the chosen
// one framed in turquoise with a check mark), the "Oyun" switches Ses and Hareketler, and the
// footer. Everything is saved on this device only (device-settings.js); nothing is read from or
// written to the database. A change applies at once (no redraw of the page needed).
//
// Navigation only, like Nasıl oynanır: opened from Giriş or the match "⋮" menu; the seat keeper
// keeps the seat present; while seated the "Masaya dön" bar sits at the top (red on my turn);
// back returns to where the page was opened. The table draws the chosen revolver when it is
// shown again (and follows a change while it is mounted).

import { h, svg } from '../dom.js';
import { header, screen } from '../components.js';
import { t } from '../i18n/i18n.js';
import { createHomeBar } from '../home-bar.js';
import { revolverSvg } from '../revolver.js';
import { DEFAULT_REVOLVER, REVOLVERS, REVOLVER_IDS } from '../revolvers.js';
import { getSettings, onSettingsChange, setSetting } from '../device-settings.js';

const CHECK = ['svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
  ['path', { d: 'M2.5 6.2 L5 8.5 L9.5 3.5', fill: 'none', stroke: '#15100C', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]];

/** The note under a revolver's name ("kemik kabza · varsayılan" for the default). */
export function revolverNote(id) {
  const note = t(REVOLVERS[id].noteKey);
  return id === DEFAULT_REVOLVER ? t('deviceSettings.defaultNote', note) : note;
}

/**
 * @param {object} ctx { keeper, pageBack(), ... }
 * @param {object} view { active(), onLeave(fn) }
 */
export function settingsScreen(ctx, view) {
  const held = ctx.keeper?.current() ?? null;
  const bar = held ? createHomeBar(ctx, view, held) : null;
  const top = header({ title: t('common.settings'), subtitle: t('app.name'), onBack: () => ctx.pageBack() });

  const cards = REVOLVER_IDS.map((id) => {
    const data = REVOLVERS[id];
    const button = h('button', {
      type: 'button', class: 'revolver-card', 'data-revolver': id,
      on: { click: () => setSetting('revolver', id) },
    },
    h('span', { class: 'revolver-check', 'aria-hidden': 'true' }, svg(CHECK)),
    revolverSvg(id, { className: 'revolver-preview', width: 140, height: 89 }),
    h('span', { class: 'revolver-name', text: t(data.nameKey) }),
    h('span', { class: 'revolver-note', text: revolverNote(id) }));
    return { id, button };
  });

  const switches = [
    toggle('sound', 'settings-sound', t('deviceSettings.sound'), t('deviceSettings.soundHelp')),
    toggle('motion', 'settings-motion', t('deviceSettings.motion'), t('deviceSettings.motionHelp')),
  ];

  function draw() {
    const settings = getSettings();
    for (const { id, button } of cards) {
      const chosen = settings.revolver === id;
      button.setAttribute('aria-pressed', String(chosen));
      button.classList.toggle('is-chosen', chosen);
    }
    for (const item of switches) item.draw(settings);
  }

  // Also follows a change made in another tab of this browser.
  const stop = onSettingsChange(() => { if (view.active()) draw(); });
  view.onLeave(stop);
  draw();

  return screen('screen-settings', bar, top.el,
    h('div', { class: 'settings-page' },
      h('section', { class: 'settings-section', 'aria-labelledby': 'settings-revolver-title' },
        h('h2', { class: 'section-title', id: 'settings-revolver-title', text: t('deviceSettings.revolverTitle') }),
        h('p', { class: 'muted small', text: t('deviceSettings.revolverNote') }),
        h('div', { class: 'revolver-grid', role: 'group', 'aria-label': t('deviceSettings.revolverGroup') },
          cards.map((card) => card.button))),
      h('section', { class: 'settings-section is-game', 'aria-labelledby': 'settings-game-title' },
        h('h2', { class: 'section-title', id: 'settings-game-title', text: t('deviceSettings.gameTitle') }),
        switches.map((item) => item.el)),
      h('p', { class: 'settings-footer', text: t('deviceSettings.footer') })));
}

/** A labelled on / off switch (role switch, 44 px target) for one boolean setting. */
function toggle(key, id, label, help) {
  const button = h('button', {
    type: 'button', class: 'switch', role: 'switch', 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-help`,
    on: { click: () => setSetting(key, !getSettings()[key]) },
  }, h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })));
  const el = h('div', { class: 'settings-row' },
    h('div', { class: 'settings-row-text' },
      h('span', { class: 'settings-row-label', id: `${id}-label`, text: label }),
      h('span', { class: 'settings-row-help', id: `${id}-help`, text: help })),
    button);
  return {
    el,
    draw(settings) {
      button.setAttribute('aria-checked', String(settings[key]));
      button.classList.toggle('is-on', settings[key]);
    },
  };
}
