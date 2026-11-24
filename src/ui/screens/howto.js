// Nasıl oynanır (step 4.8, decision Q73): two tabs, "Kurallar" (approved mock: conversation 11,
// model 1, plus the Q73 additions at the end of Sıra, Süre and Ganimet) and "Malzemeler" (model
// 2: every engine tool with its large badge, name, explanation and tags). Static: nothing is read
// from or written to the database; the numbers come from the engine (howto-model.js).
//
// Navigation only (like "Ana sayfa", decision Q70): opened from Giriş or from the match "⋮"
// menu; the seat keeper keeps presence, the host watcher and this device's clock duties running.
// While seated, Giriş's "Masaya dön" bar sits at the top (red "Sıra sende · N" on my turn).
// The open tab is in the hash (#/nasil, #/nasil/malzemeler; switched with replaceState), so a
// language change, which draws the route again, keeps it.

import { h, svg } from '../dom.js';
import { ICONS, header, screen } from '../components.js';
import { t } from '../i18n/i18n.js';
import { HOW_TO_TABS, hashFor } from '../routes.js';
import { toolIcon } from '../tools.js';
import { createHomeBar } from '../home-bar.js';
import { howToTools, ruleNumbers, tagLegend, turnCases } from '../howto-model.js';

const TAB_ORDER = [HOW_TO_TABS.RULES, HOW_TO_TABS.TOOLS];
const TAB_LABEL = { [HOW_TO_TABS.RULES]: 'howTo.tabRules', [HOW_TO_TABS.TOOLS]: 'howTo.tabItems' };
const GLASSES_FULL = 4; // the Amaç illustration: four full glasses and an empty one (mock)
const EXAMPLE_LIVE = 3; // the Tur badge of the mock: "3 dolu · 2 boş"
const EXAMPLE_BLANK = 2;

/**
 * @param {object} ctx { keeper, pageBack(), ... }
 * @param {object} view { active(), onLeave(fn) }
 * @param {{ tab: string }} params
 */
export function howToScreen(ctx, view, { tab = HOW_TO_TABS.RULES } = {}) {
  const held = ctx.keeper?.current() ?? null;
  const bar = held ? createHomeBar(ctx, view, held) : null;
  const top = header({ title: t('common.howToPlay'), subtitle: t('app.name'), onBack: () => ctx.pageBack() });

  let current = TAB_ORDER.includes(tab) ? tab : HOW_TO_TABS.RULES;
  const panel = h('div', { class: 'howto-panel', role: 'tabpanel', id: 'howto-panel', tabindex: '-1' });
  const tabs = TAB_ORDER.map((id) => h('button', {
    type: 'button', class: 'howto-tab', role: 'tab', id: `howto-tab-${id}`, 'aria-controls': 'howto-panel',
    text: t(TAB_LABEL[id]),
    on: { click: () => select(id) },
  }));
  const tabList = h('div', { class: 'howto-tabs', role: 'tablist', 'aria-label': t('howTo.tabsLabel') }, tabs);
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const at = TAB_ORDER.indexOf(current);
    let next = at;
    if (event.key === 'ArrowRight') next = (at + 1) % TAB_ORDER.length;
    if (event.key === 'ArrowLeft') next = (at - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = TAB_ORDER.length - 1;
    select(TAB_ORDER[next]);
    tabs[next].focus();
  });

  function draw() {
    tabs.forEach((button, i) => {
      const selected = TAB_ORDER[i] === current;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-current', selected);
    });
    panel.setAttribute('aria-labelledby', `howto-tab-${current}`);
    panel.replaceChildren(current === HOW_TO_TABS.TOOLS ? toolsTab() : rulesTab(() => {
      select(HOW_TO_TABS.TOOLS);
      tabList.scrollIntoView({ block: 'start' });
      panel.focus({ preventScroll: true });
    }));
  }

  function select(id) {
    if (!view.active() || id === current) return;
    current = id;
    // The tab is part of the address, without a new history entry: back still returns to where
    // the page was opened from.
    history.replaceState(null, '', hashFor.howTo(id));
    draw();
  }

  draw();
  // The bar sits exactly as on Giriş (full width, no gutter), so it stays on one line at 360 px.
  return screen('screen-howto', bar, top.el,
    h('div', { class: 'howto' }, tabList, panel));
}

function card(titleKey, ...children) {
  return h('section', { class: 'howto-card' },
    h('h2', { class: 'section-title', text: t(titleKey) }),
    children);
}

const lead = (text) => h('p', { class: 'howto-lead', text });
const note = (text) => h('p', { class: 'muted small', text });

function rulesTab(onShowTools) {
  const numbers = ruleNumbers();
  const glasses = h('span', { class: 'howto-glasses', 'aria-hidden': 'true' },
    Array.from({ length: GLASSES_FULL }, () => svg(ICONS.glassFull)), svg(ICONS.glassEmpty));
  const caseRows = turnCases().map((row) => h('tr', {},
    h('th', { scope: 'row', text: row.label }),
    h('td', { class: row.keepsTurn ? 'is-keep' : null, text: row.result })));
  const tools = howToTools();
  return h('div', { class: 'howto-stack' },
    card('howTo.goalTitle',
      lead(t('howTo.goalText')),
      h('div', { class: 'howto-lives' }, glasses, h('span', { class: 'muted small', text: t('howTo.goalLives') })),
      note(t('howTo.goalDraw'))),
    card('howTo.roundTitle',
      lead(t('howTo.roundText')),
      h('div', { class: 'howto-reload' },
        h('span', { class: 'howto-dot is-live', 'aria-hidden': 'true' }),
        h('span', { text: t('howTo.roundLive', EXAMPLE_LIVE) }),
        h('span', { class: 'howto-dot is-blank', 'aria-hidden': 'true' }),
        h('span', { text: t('howTo.roundBlank', EXAMPLE_BLANK) })),
      note(t('howTo.roundNote'))),
    card('howTo.turnTitle',
      lead(t('howTo.turnText')),
      h('table', { class: 'howto-cases', 'aria-label': t('howTo.turnTableLabel') },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: t('howTo.turnColCase') }),
          h('th', { scope: 'col', text: t('howTo.turnColResult') }))),
        h('tbody', {}, caseRows)),
      note(t('howTo.turnNote')),
      note(t('howTo.turnAiming'))),
    card('howTo.timeTitle',
      lead(t('howTo.timeText', numbers.shotTimeSeconds)),
      note(t('howTo.timeNote')),
      note(t('howTo.timeHold'))),
    card('howTo.itemsTitle',
      lead(t('howTo.itemsText')),
      note(t('howTo.itemsNote', numbers.toolsPerTurn)),
      h('button', { type: 'button', class: 'howto-link', on: { click: onShowTools } },
        h('span', { text: t('howTo.itemsAll', tools.count) }), svg(ICONS.chevron))),
    card('howTo.lootTitle',
      lead(t('howTo.lootText')),
      note(t('howTo.lootNote')),
      note(t('howTo.lootTime', numbers.lootSeconds))));
}

function tagChip(kind, text) {
  return h('span', { class: `howto-tag is-${kind}`, text });
}

function toolRow(row) {
  return h('li', { class: 'howto-tool', 'data-tool': row.id },
    toolIcon(row.id, 'large'),
    h('div', { class: 'howto-tool-text' },
      h('span', { class: 'howto-tool-name', text: row.name }),
      h('span', { class: 'howto-tool-help', text: row.help }),
      h('span', { class: 'howto-tags' }, row.tags.map((tag) => tagChip(tag.kind, tag.text)))));
}

function toolsTab() {
  const tools = howToTools();
  return h('div', { class: 'howto-stack' },
    lead(t('howTo.toolsIntro')),
    h('div', { class: 'howto-legend' },
      tagLegend().map((item) => h('p', { class: 'howto-legend-row' }, tagChip(item.kind, item.tag), h('span', { text: item.text })))),
    h('h2', { class: 'section-title howto-group', text: t('howTo.turnToolsTitle') }),
    h('ul', { class: 'howto-tools' }, tools.turn.map(toolRow)),
    h('h2', { class: 'section-title howto-group', text: t('howTo.anytimeToolsTitle') }),
    h('ul', { class: 'howto-tools' }, tools.anytime.map(toolRow)));
}
