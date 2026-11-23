// Entry point of the game UI (loaded by index.html): connects to Firebase, then shows the screen
// of the current hash route and follows hash changes.
//
// On page load: if this tab remembers a table code and the signed-in user still holds a seat
// there, the tab goes straight back to that table; otherwise the code is forgotten (and if that
// table was closed, its "Masa kapatıldı" notice is shown first).

import { replace } from './dom.js';
import { loading, screen } from './components.js';
import { connect } from './firebase.js';
import { forgetCode, rememberCode, rememberedCode } from './memory.js';
import { FORM_MESSAGES, errorMessage } from './messages.js';
import { ROUTES, hashFor, parseRoute } from './routes.js';
import { aboutScreen } from './screens/about.js';
import { ROOM_CLOSED_MS, closedScreen } from './screens/closed.js';
import { homeScreen } from './screens/home.js';
import { problemScreen } from './screens/problem.js';
import { recoverScreen } from './screens/recover.js';
import { lobbyScreen } from './screens/lobby.js';
import { sitScreen } from './screens/sit.js';
import { ROOM_ERR } from '../rooms/index.js';

const root = document.getElementById('app');
const TITLE = 'Son Çay';

const ctx = {
  api: null,
  uid: null,
  /** Goes to a hash route (pushes a history entry unless `replace`). */
  go(hash, { replace: replaceEntry = false } = {}) {
    if (replaceEntry) {
      history.replaceState(null, '', hash);
      route();
    } else if (location.hash === hash) {
      route();
    } else {
      location.hash = hash; // the hashchange listener renders it
    }
  },
  /** After a successful create / join / recover: remember the code and show the table. */
  enterTable(code) {
    rememberCode(code);
    ctx.go(hashFor.table(code));
  },
  /** Back to Giriş, with an optional message there. */
  goHome(message) {
    goHome(message);
  },
  /** The table was closed (decision Q67): "Masa kapatıldı" for a few seconds, then Giriş. */
  roomClosed(code) {
    showRoomClosed(code);
  },
  /** This tab no longer holds a seat at its remembered table. */
  forgetTable() {
    forgetCode();
  },
  /** Draws the current route again, with an optional message on the screen it shows. */
  refresh(message) {
    flash = message ?? null;
    route();
  },
};

// A message to show once on the next home or waiting-room screen (e.g. after a broken invite
// link, or a seat lost to another device).
let flash = null;

// Each rendered screen gets a view: `active()` turns false as soon as another screen replaces
// it, so late answers of the database never touch the page or navigate.
let currentView = null;

function startView() {
  if (currentView) {
    currentView.alive = false;
    for (const fn of currentView.leave) fn();
  }
  const state = { alive: true, leave: [] };
  currentView = state;
  return { active: () => state.alive, onLeave: (fn) => state.leave.push(fn) };
}

function show(node, title) {
  replace(root, node);
  document.title = title ? `${TITLE}: ${title}` : TITLE;
  window.scrollTo(0, 0);
}

function showLoading(text) {
  show(screen('screen-loading', loading(text)));
}

function goHome(message) {
  flash = message ?? null;
  ctx.go(hashFor.home(), { replace: true });
}

// "Masa kapatıldı" for ROOM_CLOSED_MS, then Giriş (at once with the button). The remembered
// table code is forgotten if it is this table's.
function showRoomClosed(code) {
  if (rememberedCode() === code) forgetCode();
  const view = startView();
  show(closedScreen({ code, onHome: () => { if (view.active()) goHome(); } }), 'masa kapatıldı');
  const timer = setTimeout(() => {
    if (view.active()) goHome();
  }, ROOM_CLOSED_MS);
  view.onLeave(() => clearTimeout(timer));
}

function tableProblem(code, failure) {
  const notFound = failure?.code === ROOM_ERR.ROOM_NOT_FOUND;
  show(problemScreen({
    title: `Masa ${code}`,
    message: errorMessage(failure),
    actionText: notFound ? 'Ana sayfaya dön' : 'Tekrar dene',
    onAction: notFound ? () => ctx.go(hashFor.home()) : () => route(),
    onBack: () => ctx.go(hashFor.home()),
  }), 'masa');
}

// #/masa/CODE: my seat if I hold one there, else the join screen.
async function showTable(view, code) {
  showLoading();
  try {
    const mine = await ctx.api.getMySeat({ uid: ctx.uid, code });
    if (!view.active()) return;
    if (mine !== null) {
      rememberCode(code);
      const message = flash;
      flash = null;
      show(lobbyScreen(ctx, view, { code, mine, message }), 'bekleme salonu');
      return;
    }
    if (rememberedCode() === code) forgetCode();
    const summary = await ctx.api.getRoomSummary({ uid: ctx.uid, code });
    if (view.active()) show(sitScreen(ctx, view, { summary }), 'masaya otur');
  } catch (failure) {
    if (!view.active()) return;
    // The table no longer exists (closed by its host, or its last player left).
    if (failure?.code === ROOM_ERR.ROOM_NOT_FOUND) showRoomClosed(code);
    else tableProblem(code, failure);
  }
}

// #/masa/CODE/don: recovery, unless this tab already holds a seat there.
async function showRecover(view, code) {
  showLoading();
  try {
    const mine = await ctx.api.getMySeat({ uid: ctx.uid, code });
    if (!view.active()) return;
    if (mine !== null) {
      ctx.go(hashFor.table(code), { replace: true });
      return;
    }
    const summary = await ctx.api.getRoomSummary({ uid: ctx.uid, code });
    if (view.active()) show(recoverScreen(ctx, view, { summary }), 'yerine dön');
  } catch (failure) {
    if (!view.active()) return;
    if (failure?.code === ROOM_ERR.ROOM_NOT_FOUND) showRoomClosed(code);
    else tableProblem(code, failure);
  }
}

// Shows the canonical form of the address (e.g. a table code typed in lower case) without a new
// history entry.
function canonicalize(hash) {
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function route() {
  const view = startView();
  const current = parseRoute(location.hash);
  switch (current.name) {
    case ROUTES.HOME: {
      const message = flash;
      flash = null;
      show(homeScreen(ctx, view, { message }));
      return;
    }
    case ROUTES.CREATE:
      show(sitScreen(ctx, view, {}), 'yeni masa');
      return;
    case ROUTES.ABOUT:
      show(aboutScreen(ctx, view), 'hakkında');
      return;
    case ROUTES.TABLE:
      canonicalize(hashFor.table(current.code));
      showTable(view, current.code);
      return;
    case ROUTES.RECOVER:
      canonicalize(hashFor.recover(current.code));
      showRecover(view, current.code);
      return;
    case ROUTES.BAD_CODE:
      goHome(FORM_MESSAGES.BAD_INVITE);
      return;
    default:
      goHome();
  }
}

// If this tab remembers a table and still holds a seat there, open that table, unless the
// address asks for another table or page (e.g. an invite link to another table).
async function restoreRememberedTable() {
  const code = rememberedCode();
  if (code === null) return;
  let mine;
  try {
    mine = await ctx.api.getMySeat({ uid: ctx.uid, code });
  } catch {
    return; // Unknown (e.g. offline): keep the code, the table route will report the problem.
  }
  const asked = parseRoute(location.hash);
  const home = [ROUTES.HOME, ROUTES.UNKNOWN, ROUTES.BAD_CODE].includes(asked.name);
  if (mine === null) {
    forgetCode();
    // The remembered table was closed: its route shows "Masa kapatıldı", then Giriş.
    if (home && (await roomGone(code))) history.replaceState(null, '', hashFor.table(code));
    return;
  }
  if (home) history.replaceState(null, '', hashFor.table(code));
}

async function roomGone(code) {
  try {
    await ctx.api.getRoomSummary({ uid: ctx.uid, code });
    return false;
  } catch (failure) {
    return failure?.code === ROOM_ERR.ROOM_NOT_FOUND;
  }
}

async function start() {
  showLoading('Bağlanıyor…');
  try {
    Object.assign(ctx, await connect());
  } catch {
    show(problemScreen({
      title: TITLE,
      message: FORM_MESSAGES.CONNECT_FAILED,
      actionText: 'Tekrar dene',
      onAction: () => location.reload(),
      onBack: () => location.reload(),
    }));
    return;
  }
  await restoreRememberedTable();
  window.addEventListener('hashchange', route);
  route();
}

start();
