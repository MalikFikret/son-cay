// Entry point of the game UI (loaded by index.html): connects to Firebase, then shows the screen
// of the current hash route and follows hash changes.
//
// On page load: if this tab remembers a table code and the signed-in user still holds a seat
// there, the tab goes straight back to that table; otherwise the code is forgotten (and if that
// table was closed, its "Masa kapatıldı" notice is shown first).
//
// Away from the table (decision Q70): the seat keeper (seat-keeper.js) keeps this tab's seat
// present while it shows another screen (Giriş with its "Masaya dön" bar, Hakkında, Nasıl oynanır,
// Ayarlar). While seated,
// another table cannot be created, joined or recovered ("Önce masana dön").

import { replace } from './dom.js';
import { loading, screen } from './components.js';
import { connect } from './firebase.js';
import { forgetCode, rememberCode, rememberedCode } from './memory.js';
import { tableGuard } from './home-model.js';
import { createSeatKeeper } from './seat-keeper.js';
import { errorMessage } from './messages.js';
import { initLanguage, onLanguageChange, t } from './i18n/i18n.js';
import { ROUTES, hashFor, parseRoute } from './routes.js';
import { aboutScreen } from './screens/about.js';
import { howToScreen } from './screens/howto.js';
import { settingsScreen } from './screens/settings.js';
import { initDeviceSettings } from './device-settings.js';
import { ROOM_CLOSED_MS, closedScreen } from './screens/closed.js';
import { homeScreen } from './screens/home.js';
import { problemScreen } from './screens/problem.js';
import { recoverScreen } from './screens/recover.js';
import { lobbyScreen } from './screens/lobby.js';
import { sitScreen } from './screens/sit.js';
import { ROOM_ERR } from '../rooms/index.js';

const root = document.getElementById('app');

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
  /**
   * Back to Giriş, with an optional message there; `info: true` shows it in the neutral style
   * (a confirmation such as "Masayı kapattın."), otherwise in the error colour.
   */
  goHome(message, { info = false } = {}) {
    goHome(message, { info });
  },
  /** The table was closed (decision Q67): "Masa kapatıldı" for a few seconds, then Giriş. */
  roomClosed(code) {
    showRoomClosed(code);
  },
  /** This tab no longer holds a seat at its remembered table. */
  forgetTable() {
    forgetCode();
  },
  /** The seat keeper (set after connecting). */
  keeper: null,
  /**
   * A problem with the held seat while no table screen receives it (decision Q70): a lost seat
   * or a closed room forgets the table; on Giriş the bar goes away ("Masa kapatıldı" for a
   * closed room, the seat-lost message otherwise).
   */
  onSeatProblem(error) {
    seatProblem(error);
  },
  /**
   * Back from Nasıl oynanır (decision Q73) or Ayarlar (step 4.4a): to the screen it was opened
   * from (one history step: the How to play tabs never add an entry), or Giriş if this tab opened
   * it directly (e.g. a reload).
   */
  pageBack() {
    if (pageOpenedFrom !== null) history.back();
    else ctx.go(hashFor.home());
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
let flashInfo = false; // the flash confirms something (neutral style on Giriş), not an error

// Each rendered screen gets a view: `active()` turns false as soon as another screen replaces
// it, so late answers of the database never touch the page or navigate.
let currentView = null;

// Side pages (Nasıl oynanır, Ayarlar): navigation only, opened from Giriş or the table. The route
// shown before one was opened (null: opened directly, e.g. after a reload).
const SIDE_PAGES = [ROUTES.HOW_TO, ROUTES.SETTINGS];
let lastRouteName = null;
let pageOpenedFrom = null;

function startView() {
  if (currentView) {
    currentView.alive = false;
    for (const fn of currentView.leave) fn();
  }
  const state = { alive: true, leave: [] };
  currentView = state;
  return { active: () => state.alive, onLeave: (fn) => state.leave.push(fn) };
}

/** `titleKey`: the locale key of the page's name in the document title ("Son Çay: masa"). */
function show(node, titleKey) {
  replace(root, node);
  document.title = titleKey ? t('app.pageTitle', t(titleKey)) : t('app.name');
  window.scrollTo(0, 0);
}

function showLoading(text) {
  show(screen('screen-loading', loading(text)));
}

function goHome(message, { info = false } = {}) {
  flash = message ?? null;
  flashInfo = info === true;
  ctx.go(hashFor.home(), { replace: true });
}

// "Masa kapatıldı" for ROOM_CLOSED_MS, then Giriş (at once with the button). The remembered
// table code is forgotten if it is this table's.
function showRoomClosed(code) {
  if (rememberedCode() === code) forgetCode();
  const view = startView();
  show(closedScreen({ code, onHome: () => { if (view.active()) goHome(); } }), 'app.titleClosed');
  const timer = setTimeout(() => {
    if (view.active()) goHome();
  }, ROOM_CLOSED_MS);
  view.onLeave(() => clearTimeout(timer));
}

const LOST_CODES = [ROOM_ERR.SEAT_LOST, ROOM_ERR.NOT_MEMBER, ROOM_ERR.ROOM_NOT_FOUND];

async function seatProblem(error) {
  if (!LOST_CODES.includes(error?.code)) return;
  const held = ctx.keeper?.current();
  if (!held) return;
  ctx.keeper.release();
  if (rememberedCode() === held.code) forgetCode();
  const gone = error.code === ROOM_ERR.ROOM_NOT_FOUND || (await roomGone(held.code));
  // Only Giriş shows anything about it (its bar); the side pages drop their bar; other screens
  // simply forget the table.
  const shown = parseRoute(location.hash).name;
  if (SIDE_PAGES.includes(shown)) {
    route();
    return;
  }
  if (shown !== ROUTES.HOME) return;
  if (gone) showRoomClosed(held.code);
  else goHome(errorMessage(ROOM_ERR.SEAT_LOST));
}

// One table per player (decision Q70): another table's route while seated goes to Giriş.
function blockedByOwnTable(intent, code) {
  const guard = tableGuard({ heldCode: ctx.keeper?.current()?.code ?? null, intent, code });
  if (guard.allowed) return false;
  goHome(intent === 'create' ? undefined : guard.message);
  return true;
}

function tableProblem(code, failure) {
  const notFound = failure?.code === ROOM_ERR.ROOM_NOT_FOUND;
  show(problemScreen({
    title: t('common.tableTitle', code),
    message: errorMessage(failure),
    actionText: notFound ? t('common.toHome') : t('app.retry'),
    onAction: notFound ? () => ctx.go(hashFor.home()) : () => route(),
    onBack: () => ctx.go(hashFor.home()),
  }), 'app.titleTable');
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
      show(lobbyScreen(ctx, view, { code, mine, message }), 'app.titleLobby');
      return;
    }
    if (rememberedCode() === code) forgetCode();
    const summary = await ctx.api.getRoomSummary({ uid: ctx.uid, code });
    if (view.active()) show(sitScreen(ctx, view, { summary }), 'app.titleSit');
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
    if (view.active()) show(recoverScreen(ctx, view, { summary }), 'app.titleRecover');
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
  if (SIDE_PAGES.includes(current.name) && lastRouteName !== current.name) pageOpenedFrom = lastRouteName;
  if (!SIDE_PAGES.includes(current.name)) pageOpenedFrom = null;
  lastRouteName = current.name;
  switch (current.name) {
    case ROUTES.HOME: {
      const message = flash;
      const info = flashInfo;
      flash = null;
      flashInfo = false;
      show(homeScreen(ctx, view, { message, info }));
      return;
    }
    case ROUTES.CREATE:
      // Seated: back to Giriş (e.g. browser back from the table after creating it).
      if (blockedByOwnTable('create')) return;
      show(sitScreen(ctx, view, {}), 'app.titleCreate');
      return;
    case ROUTES.ABOUT:
      show(aboutScreen(ctx, view), 'app.titleAbout');
      return;
    case ROUTES.HOW_TO:
      show(howToScreen(ctx, view, { tab: current.tab }), 'app.titleHowTo');
      return;
    case ROUTES.SETTINGS:
      show(settingsScreen(ctx, view), 'app.titleSettings');
      return;
    case ROUTES.TABLE:
      if (blockedByOwnTable('join', current.code)) return;
      canonicalize(hashFor.table(current.code));
      showTable(view, current.code);
      return;
    case ROUTES.RECOVER:
      if (blockedByOwnTable('recover', current.code)) return;
      canonicalize(hashFor.recover(current.code));
      showRecover(view, current.code);
      return;
    case ROUTES.BAD_CODE:
      goHome(errorMessage('BAD_INVITE'));
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
  // The seat is held from now on, whatever screen this tab shows (decision Q70).
  ctx.keeper.hold(code, mine.seatId, ctx.onSeatProblem);
  ctx.keeper.away(ctx.onSeatProblem);
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
  // The device's language (decision Q71): stored choice, else the browser's, else Turkish.
  initLanguage();
  // This device's settings (step 4.4a): the motion class on <html> before anything is drawn.
  initDeviceSettings();
  showLoading(t('app.connecting'));
  try {
    Object.assign(ctx, await connect());
    ctx.keeper = createSeatKeeper({ api: ctx.api, uid: ctx.uid });
  } catch {
    show(problemScreen({
      title: t('app.name'),
      message: errorMessage('CONNECT_FAILED'),
      actionText: t('app.retry'),
      onAction: () => location.reload(),
      onBack: () => location.reload(),
    }));
    return;
  }
  await restoreRememberedTable();
  // A language change draws the current screen again (no switch in the UI yet).
  onLanguageChange(() => ctx.refresh());
  window.addEventListener('hashchange', route);
  route();
}

start();
