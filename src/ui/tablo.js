// Tablo: a tall panel rising from the bottom with two tabs.
// - "Bu maç": the last finished match of the table (getLastMatch): rows by survival, tur survived,
//   match points; a tap on a row opens its points breakdown.
// - "Oturum": the session ranking (points, matches, wins, what the last match added).
// Only public information. Reusable: the waiting room opens it between matches; the table
// screen opens it during a match with a live "Bu maç" (setLive) and, on my turn, a red
// "Sıra sende" bar at the top that closes the panel back to the table (setTurnBar).

import { h, svg } from './dom.js';
import { ICONS, icon, loading as loadingLine } from './components.js';
import { TEXT, errorMessage } from './messages.js';
import { createSheet } from './sheet.js';
import { matchView, sessionView } from './tablo-model.js';

/**
 * @param {{ loadLastMatch: () => Promise<object | null>, mySeat: string }} options
 *   loadLastMatch: the summary of the last finished match (or null)
 * @returns {{ open(tab?): void, close(): void, update(session, names): void, destroy(): void }}
 */
export function createTablo({ loadLastMatch, mySeat }) {
  const sheet = createSheet({ title: TEXT.tablo, tall: true, className: 'tablo' });
  let tab = 'match';
  let session = { matches: 0, rows: [] };
  let names = {};
  let summary; // undefined: not loaded; null: no finished match yet
  let loadedFor = -1; // session.matches when the summary was loaded
  let loading = null;
  let live = null; // () => live "Bu maç" view (the table screen), or null
  const expanded = new Set();

  const tabs = { match: tabButton('match', TEXT.tabMatch), session: tabButton('session', TEXT.tabSession) };
  const tabList = h('div', { class: 'segmented tablo-tabs', role: 'tablist', 'aria-label': TEXT.tablo }, tabs.match, tabs.session);
  const headerLine = h('span', { class: 'hint tablo-header-line' });
  const panel = h('div', { class: 'tablo-panel', role: 'tabpanel' });
  // The red "Sıra sende" bar (the one red exception: it stands in for the fire button).
  const turnSeconds = h('span', { class: 'turn-bar-seconds' });
  const turnBar = h('button', { type: 'button', class: 'turn-bar', hidden: true },
    h('span', { class: 'turn-bar-title', text: TEXT.yourTurn }),
    turnSeconds,
    h('span', { class: 'turn-bar-back', text: TEXT.backToTable }),
    icon('chevron'));
  turnBar.addEventListener('click', () => sheet.close());
  sheet.head.prepend(turnBar);
  sheet.head.append(tabList, headerLine);
  sheet.body.append(panel);

  function tabButton(id, text) {
    const button = h('button', { type: 'button', role: 'tab', class: 'segment', id: `tablo-tab-${id}`, text });
    button.addEventListener('click', () => show(id));
    return button;
  }

  function show(id) {
    tab = id;
    for (const [key, button] of Object.entries(tabs)) {
      const on = key === id;
      button.setAttribute('aria-selected', String(on));
      button.classList.toggle('is-checked', on);
      button.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `tablo-tab-${id}`);
    render();
    if (id === 'match' && !live) ensureMatch();
  }

  // Loads the last match once per finished match (session.matches changes when one ends).
  function ensureMatch() {
    if (loading || loadedFor === session.matches) return;
    const wanted = session.matches;
    loading = loadLastMatch()
      .then((result) => {
        summary = result;
        loadedFor = wanted;
        expanded.clear();
      })
      .catch((error) => {
        summary = { error: errorMessage(error) };
      })
      .finally(() => {
        loading = null;
        if (sheet.isOpen()) render();
      });
    render();
  }

  function render() {
    if (tab === 'match') renderMatch();
    else renderSession();
  }

  const columns = (...cells) => h('div', { class: `tablo-cols ${tab === 'match' ? 'cols-match' : 'cols-session'}`, 'aria-hidden': 'true' },
    cells.map((text, i) => h('span', { class: i >= 2 ? 'num' : '', text })));

  function renderMatch() {
    if (live) {
      const view = live();
      headerLine.textContent = view?.header ?? '';
      if (!view) {
        panel.replaceChildren(loadingLine());
        return;
      }
      panel.replaceChildren(
        columns(TEXT.colRank, TEXT.colPlayer, TEXT.colRounds, TEXT.colPoints, ''),
        h('ul', { class: 'tablo-list' }, view.rows.map(matchRow)),
        h('p', { class: 'hint tablo-note', text: view.footnote ?? TEXT.matchFootnote }));
      return;
    }
    if (summary === undefined || loading) {
      headerLine.textContent = '';
      panel.replaceChildren(loadingLine());
      return;
    }
    if (summary?.error) {
      headerLine.textContent = '';
      panel.replaceChildren(h('p', { class: 'field-error', role: 'alert', text: summary.error }));
      return;
    }
    const view = matchView(summary, mySeat);
    if (!view) {
      headerLine.textContent = '';
      panel.replaceChildren(h('p', { class: 'tablo-empty', text: TEXT.noMatchYet }));
      return;
    }
    headerLine.textContent = view.header;
    panel.replaceChildren(
      columns(TEXT.colRank, TEXT.colPlayer, TEXT.colRounds, TEXT.colPoints, ''),
      h('ul', { class: 'tablo-list' }, view.rows.map(matchRow)),
      h('p', { class: 'hint tablo-note', text: TEXT.matchFootnote }));
  }

  function matchRow(row) {
    const open = expanded.has(row.seatId);
    const detailsId = `tablo-details-${row.seatId}`;
    const button = h('button', { type: 'button', class: 'tablo-row cols-match', 'aria-expanded': String(open), 'aria-controls': detailsId },
      h('span', { class: 'tablo-rank', text: String(row.rank) }),
      h('span', { class: 'tablo-who' },
        h('span', { class: 'tablo-name-line' },
          h('span', { class: 'tablo-name', text: row.displayName }),
          row.me ? h('span', { class: 'tablo-me', text: TEXT.me }) : null),
        h('span', { class: 'tablo-status-line' },
          row.glasses ? glasses(row.glasses) : null,
          row.statusText ? h('span', { class: row.status === 'won' ? 'tablo-status is-won' : 'tablo-status', text: row.statusText }) : null)),
      h('span', { class: 'num', text: String(row.roundsSurvived) }),
      h('span', { class: 'num tablo-points', text: String(row.points) }),
      icon('expand'));
    button.addEventListener('click', () => {
      if (expanded.has(row.seatId)) expanded.delete(row.seatId);
      else expanded.add(row.seatId);
      renderMatch();
      panel.querySelector(`[aria-controls="${detailsId}"]`)?.focus();
    });
    const classes = ['tablo-item'];
    if (row.me) classes.push('is-me');
    if (row.out) classes.push('is-out');
    return h('li', { class: classes.join(' ') }, button, open ? breakdown(row, detailsId) : null);
  }

  function breakdown(row, id) {
    return h('dl', { class: 'tablo-breakdown', id },
      row.lines.map((line) => h('div', { class: line.total ? 'cols-match tablo-line is-total' : 'cols-match tablo-line' },
        h('dt', { text: line.label }),
        h('dd', { class: 'num muted-cell', text: line.count }),
        h('dd', { class: 'num strong', text: line.points }))));
  }

  function glasses({ full, total }) {
    const el = h('span', { class: 'tablo-glasses', role: 'img', 'aria-label': TEXT.hpLabel(full) });
    for (let i = 0; i < total; i += 1) el.append(svg(i < full ? ICONS.glassFull : ICONS.glassEmpty));
    return el;
  }

  function renderSession() {
    const view = sessionView(session, names, mySeat);
    headerLine.textContent = view.header;
    panel.replaceChildren(
      columns(TEXT.colRank, TEXT.colPlayer, TEXT.colMatches, TEXT.colWins, TEXT.colPoints),
      h('ul', { class: 'tablo-list' }, view.rows.map((row) => h('li', { class: row.me ? 'tablo-item tablo-row cols-session is-me' : 'tablo-item tablo-row cols-session' },
        h('span', { class: 'tablo-rank', text: String(row.rank) }),
        h('span', { class: 'tablo-name-line' },
          h('span', { class: 'tablo-name', text: row.displayName }),
          row.me ? h('span', { class: 'tablo-me', text: TEXT.me }) : null),
        h('span', { class: 'num', text: String(row.matches) }),
        h('span', { class: 'num tablo-wins' }, String(row.wins), row.wins > 0 ? h('span', { role: 'img', 'aria-label': TEXT.winsLabel }, icon('crown')) : null),
        h('span', { class: 'num tablo-total' },
          h('span', { class: 'tablo-points', text: String(row.points) }),
          row.lastText ? h('span', { class: 'tablo-last', text: row.lastText }) : null)))),
      h('p', { class: 'hint tablo-note', text: TEXT.sessionFootnote }));
  }

  return {
    open(which = tab) {
      sheet.open();
      show(which);
    },
    close: () => sheet.close(),
    /** New session data (and seat names) from the room. Reloads "Bu maç" when a match ended. */
    update(nextSession, nextNames) {
      session = nextSession;
      names = nextNames;
      if (!sheet.isOpen()) return;
      // "Bu maç" changes only when another match has ended; "Oturum" follows every change.
      if (tab === 'match' && !live) ensureMatch();
      else render();
    },
    /** Live "Bu maç": a function returning the current view (liveMatchView), or null. */
    setLive(fn) {
      live = typeof fn === 'function' ? fn : null;
    },
    /** Redraws the open panel (after a match update). The open row stays open. */
    refresh() {
      if (sheet.isOpen()) render();
    },
    /** The "Sıra sende" bar: shown with the seconds left, or hidden (null). */
    setTurnBar(seconds) {
      const show = typeof seconds === 'number';
      turnBar.hidden = !show;
      if (show) turnSeconds.textContent = `· ${seconds}`;
    },
    isOpen: () => sheet.isOpen(),
    destroy: () => sheet.destroy(),
  };
}
