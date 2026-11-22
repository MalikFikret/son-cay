// Masa: the match table, shown in place of the waiting room while a match runs (approved mocks
// "Masa · sıra sende" and "Masa · başkasının sırası", conversation 13, models 3 and 4).
//
// Top to bottom: the top bar (round, table code, Tablo / Ayarlar / ? disabled for now), the
// seats around the table with their tea-glass lives and the turn direction, the revolver in the
// middle, the status line with the countdown and the last move, my hand (tools shown, not usable
// yet) and the fire button on my turn.
//
// It reads only what watchMatch gives this device (its own view, events and legal actions).
// Secret aiming: the target I pick stays on this device; it is sent only inside the shot itself
// (one chooseTarget with the confirmation step switched off, see ensureNoConfirm). Nothing about
// the press is sent either. Every device runs the match clock (runMatchClock).
//
// Every listener, timer and animation stops in destroy().

import { h, svg } from '../dom.js';
import { ICONS, errorLine } from '../components.js';
import { TEXT, errorMessage } from '../messages.js';
import { MODE_LABELS } from '../lobby-model.js';
import { toolIcon, toolName } from '../tools.js';
import { revolverSvg, SHOT_TIMING } from '../revolver.js';
import { LONG_PRESS_MS, PRESS, initialPress, isPressing, pressStep } from '../fire-press.js';
import {
  STAGE_WIDTH,
  URGENT_MS,
  aimAngle,
  directionArrows,
  keepTarget,
  lastMove,
  lastRound,
  msLeft,
  nearestAngle,
  outRounds,
  placeSeats,
  pointsLeft,
  reloadFor,
  revolverSeat,
  seatLayout,
  seatTags,
  secondsShown,
  shotsIn,
  statusText,
  tapTarget,
  targetsFrom,
} from '../table-model.js';
import { ROOM_ERR, isSeatPresent } from '../../rooms/index.js';

const LOST_CODES = [ROOM_ERR.SEAT_LOST, ROOM_ERR.NOT_MEMBER, ROOM_ERR.ROOM_NOT_FOUND];
const RELOAD_SHOW_MS = 2200; // the reload announcement stays this long
const END_HOLD_MS = 2600; // the final state stays this long before the waiting room returns
const ERROR_SHOW_MS = 6000;
const RING = 2 * Math.PI * 22; // countdown ring circumference (r = 22)
const MAX_EVENTS = 300; // events kept for the last-move line

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {{ api: object, uid: string, code: string, mode: string, mySeat: string,
 *   watchServerOffset?: (fn: (offset: number) => void) => () => void,
 *   onLost: (error: object) => void }} options
 * @returns {{ el: HTMLElement, setRoom(room: { names: Record<string, string>, presence: object }): void,
 *   finish(): Promise<void>, destroy(): void }}
 */
export function createTable({ api, uid, code, mode, mySeat, watchServerOffset, onLost }) {
  let destroyed = false;
  const stops = [];
  const timers = new Set();
  let offset = 0;
  let names = {};
  let presence = {};

  let applied = null; // the last update drawn: { n, view, legalActions, clockAt }
  let events = []; // events seen this match (mine: public + my private ones)
  let outs = {}; // seatId -> { round, removed }
  let round = 0; // the round of the last reloaded event
  let endedAt = null; // when the ended state was drawn (local ms)
  const queue = [];
  let running = false;

  let target = null; // my chosen target: on this device only
  let press = initialPress();
  let holdTimer = null;
  let sending = false;
  let prefFor = null; // match n the "no confirmation" preference was sent for
  let prefPromise = null;
  let angle = NaN;

  // --- Static parts --------------------------------------------------------------------------
  const roundTitle = h('span', { class: 'table-round' });
  const topBar = h('header', { class: 'table-top' },
    h('div', { class: 'table-top-text' },
      roundTitle,
      h('span', { class: 'hint', text: TEXT.tableSubtitle(code, MODE_LABELS[mode] ?? '') })),
    h('div', { class: 'table-top-actions' },
      h('button', { type: 'button', class: 'table-top-button', text: TEXT.tablo, disabled: true, title: TEXT.soon }),
      h('button', { type: 'button', class: 'table-top-button is-square', 'aria-label': TEXT.settings, disabled: true, title: TEXT.soon }, svg(GEAR)),
      h('button', { type: 'button', class: 'table-top-button is-square', 'aria-label': TEXT.howToPlay, disabled: true, title: TEXT.soon },
        h('span', { class: 'table-help', text: '?' }))));

  const disc = h('div', { class: 'table-disc', 'aria-hidden': 'true' });
  const decor = svg(DECOR);
  const arrows = svg(['svg', { class: 'table-arrows', role: 'img', preserveAspectRatio: 'none' }]);
  const revolverWrap = h('div', { class: 'revolver', role: 'img' }, revolverSvg());
  const reloadLive = h('span', { class: 'reload-live' });
  const reloadBlank = h('span', { class: 'reload-blank' });
  const reloadSr = h('span', { class: 'visually-hidden' });
  const reloadBanner = h('div', { class: 'reload-banner', 'aria-hidden': 'true', hidden: true },
    h('span', { class: 'reload-kicker', text: TEXT.reloadLabel }),
    h('span', { class: 'reload-counts' }, reloadLive, h('span', { class: 'reload-dot', text: '·' }), reloadBlank));
  const reloadLive2 = h('p', { class: 'visually-hidden', role: 'status' }, reloadSr);
  const stage = h('div', { class: 'table-stage' }, disc, decor, arrows, revolverWrap, reloadBanner);
  const seatEls = new Map(); // seatId -> { el, tag, name, lives }

  const statusLine = h('h2', { class: 'table-status-text' });
  const lastLine = h('p', { class: 'table-last' });
  const ringBar = svg(['circle', { cx: 26, cy: 26, r: 22, fill: 'none', 'stroke-width': 4, transform: 'rotate(-90 26 26)', class: 'ring-bar' }]);
  const ringText = h('span', { class: 'ring-text' });
  const ring = h('div', { class: 'table-ring', role: 'timer' },
    svg(['svg', { width: 52, height: 52, viewBox: '0 0 52 52', 'aria-hidden': 'true' },
      ['circle', { cx: 26, cy: 26, r: 22, fill: 'none', stroke: '#3A2E24', 'stroke-width': 4 }]]),
    ringText);
  ring.firstChild.append(ringBar);
  const status = h('section', { class: 'table-status' },
    h('div', { class: 'table-status-main', 'aria-live': 'polite' }, statusLine, lastLine), ring);

  const errors = errorLine('table-error');
  const note = h('p', { class: 'table-note hint', hidden: true });

  const handTitle = h('span', { class: 'hand-title' });
  const handList = h('div', { class: 'hand-list' });
  const hand = h('section', { class: 'hand', hidden: true },
    h('div', { class: 'hand-head' }, handTitle, h('span', { class: 'hand-soon', text: TEXT.handSoon })),
    handList);
  let handKey = null;

  const fireMain = h('span', { class: 'fire-main' });
  const fireSub = h('span', { class: 'fire-sub' });
  const fireButton = h('button', { type: 'button', class: 'fire-button' }, fireMain, fireSub);
  const fireWrap = h('div', { class: 'fire-wrap', hidden: true }, fireButton);

  const el = h('div', { class: 'table-screen' },
    topBar, stage,
    h('div', { class: 'table-lower' }, status, errors.el, note, hand, fireWrap),
    reloadLive2);

  // --- Live parts ------------------------------------------------------------------------------
  function report(error) {
    if (destroyed) return;
    if (LOST_CODES.includes(error?.code)) {
      onLost(error);
      return;
    }
    showError(errorMessage(error));
  }

  function showError(text) {
    errors.show(text);
    later(() => errors.clear(), ERROR_SHOW_MS, 'error');
  }

  try {
    stops.push(api.watchMatch({ uid, code, onUpdate: enqueue, onError: report }));
    stops.push(api.runMatchClock({ uid, code, onError: report }));
    if (typeof watchServerOffset === 'function') stops.push(watchServerOffset((value) => { offset = value; }));
  } catch (error) {
    report(error);
  }
  const tick = setInterval(updateClock, 200);

  // A timer that is cleared on destroy. A named one replaces its previous run.
  const named = new Map();
  function later(fn, ms, name) {
    if (name && named.has(name)) {
      clearTimeout(named.get(name));
      timers.delete(named.get(name));
    }
    const id = setTimeout(() => {
      timers.delete(id);
      if (name) named.delete(name);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    if (name) named.set(name, id);
    return id;
  }
  const wait = (ms) => new Promise((resolve) => (ms > 0 ? later(resolve, ms) : resolve()));

  // --- Updates: one at a time, with the shot animation first -------------------------------------
  function enqueue(update) {
    if (destroyed) return;
    queue.push(update);
    if (!running) run();
  }

  async function run() {
    running = true;
    while (queue.length > 0 && !destroyed) {
      const update = queue.shift();
      // Behind by several updates (e.g. a slow tab): draw without animating.
      await play(update, !update.initial && queue.length < 2);
    }
    running = false;
  }

  async function play(update, animate) {
    if (update.initial) {
      events = [];
      outs = {};
      round = 0;
      target = null;
      endedAt = null;
    }
    const shots = shotsIn(update.events);
    if (animate && applied) {
      for (const shot of shots) {
        if (destroyed) return;
        await aimAt(shot.target);
        await shotAnimation(shot);
      }
    }
    if (destroyed) return;
    outs = outRounds(update.events, outs, round);
    round = lastRound(update.events, round);
    events = events.concat(update.events).slice(-MAX_EVENTS);
    const wasMine = applied?.view.turn.playerId === mySeat;
    applied = update;
    if (shots.length > 0 || !wasMine) target = null;
    target = keepTarget(target, myTargets());
    if (update.view.status === 'ended' && endedAt === null) {
      endedAt = Date.now();
      dispatch({ type: 'expire' });
    }
    renderAll();
    const reload = reloadFor(update);
    if (reload) showReload(reload);
    ensureNoConfirm();
  }

  // --- Rendering -------------------------------------------------------------------------------
  const nameOf = (id) => names[id] ?? id ?? '';
  const myTurn = () => applied?.view.status === 'active' && applied.view.role === 'alive'
    && applied.view.turn.playerId === mySeat && applied.view.phase.type === 'turn';
  const myTargets = () => (myTurn() ? targetsFrom(applied.legalActions) : []);
  const clockMs = () => (applied ? msLeft({
    clockAt: applied.clockAt, seconds: applied.view.config.shotTimeSeconds, kind: applied.view.clock.kind, serverNow: Date.now() + offset,
  }) : null);
  const canFire = () => myTurn() && target !== null && !sending && (clockMs() ?? 1) > 0;

  function renderAll() {
    if (!applied || destroyed) return;
    const { view } = applied;
    roundTitle.textContent = TEXT.roundTitle(view.round.index);
    renderSeats(view);
    renderStatus(view);
    renderHand(view);
    renderFire();
    pointRevolver(revolverSeat({ target, view }));
    updateClock();
  }

  function renderSeats(view) {
    const layout = seatLayout(view.players.length);
    stage.style.height = `${layout.height}px`;
    stage.style.setProperty('--cy', `${layout.cy}px`);
    stage.dataset.size = layout.size;
    const placed = placeSeats(view.players, view.viewer);
    const mine = myTurn();
    const targets = myTargets();
    disc.classList.toggle('is-mine', mine);
    const turnId = view.status === 'active' ? view.turn.playerId : null;
    for (const spot of placed) {
      const player = view.players.find((p) => p.id === spot.id);
      let seat = seatEls.get(spot.id);
      if (!seat) {
        seat = buildSeat(spot.id);
        seatEls.set(spot.id, seat);
        stage.append(seat.el);
      }
      seat.el.style.left = `${(spot.x / STAGE_WIDTH) * 100}%`;
      seat.el.style.top = `${spot.y}px`;
      const present = isSeatPresent(presence[spot.id]);
      const tags = seatTags(player, { viewerId: view.viewer, turnId, target, present, out: outs[spot.id], ended: view.status === 'ended' });
      seat.tag.textContent = tags.join(' · ');
      seat.tag.hidden = tags.length === 0;
      seat.name.textContent = nameOf(spot.id);
      if (seat.hp !== player.hp) {
        seat.hp = player.hp;
        seat.lives.classList.toggle('is-many', view.config.hp > 6);
        seat.lives.replaceChildren(...Array.from({ length: view.config.hp }, (_, i) => svg(i < player.hp ? ICONS.glassFull : ICONS.glassEmpty)));
      }
      const targetable = mine && !sending && targets.includes(spot.id);
      const cls = seat.el.classList;
      cls.toggle('is-me', spot.id === view.viewer);
      cls.toggle('is-turn', spot.id === turnId);
      cls.toggle('is-target', spot.id === target);
      cls.toggle('is-out', !player.alive);
      cls.toggle('is-absent', !present && player.alive);
      cls.toggle('is-targetable', targetable);
      seat.el.disabled = !targetable;
      seat.el.setAttribute('aria-pressed', String(spot.id === target));
      seat.el.setAttribute('aria-label', TEXT.seatLabel(nameOf(spot.id), tags.join(', '), TEXT.livesLabel(player.hp, view.config.hp)));
      seat.spot = spot;
    }
    for (const [id, seat] of seatEls) {
      if (!placed.some((s) => s.id === id)) {
        seat.el.remove();
        seatEls.delete(id);
      }
    }
    // Turn direction (1 = clockwise on the screen, the engine's seat order).
    arrows.setAttribute('viewBox', `0 0 ${STAGE_WIDTH} ${layout.height}`);
    arrows.setAttribute('aria-label', view.direction === -1 ? TEXT.directionCounter : TEXT.directionClockwise);
    arrows.replaceChildren(...directionArrows(layout.cx, layout.cy, 146, view.direction).flatMap(({ arc, head }) => [
      svg(['path', { d: arc, class: 'arrow-line' }]), svg(['path', { d: head, class: 'arrow-line' }]),
    ]));
  }

  function buildSeat(id) {
    const tag = h('span', { class: 'seat-tag' });
    const name = h('span', { class: 'seat-name' });
    const lives = h('span', { class: 'seat-lives', 'aria-hidden': 'true' });
    const el = h('button', { type: 'button', class: 'seat' }, tag, name, lives);
    el.addEventListener('click', () => onSeatTap(id));
    return { el, tag, name, lives, hp: null, spot: null };
  }

  function onSeatTap(id) {
    if (!myTurn() || sending || isPressing(press)) return;
    target = tapTarget(target, id, myTargets());
    renderAll();
  }

  function renderStatus(view) {
    statusLine.textContent = statusText(view, nameOf);
    const move = view.status === 'ended' ? { lead: TEXT.matchOver, effect: null, tail: '' } : lastMove(events, nameOf);
    if (move === null) {
      lastLine.replaceChildren();
    } else {
      lastLine.replaceChildren(
        TEXT.lastEventPrefix + move.lead,
        move.effect ? ' ' : '',
        move.effect ? h('span', { class: move.effect === 'live' ? 'effect-live' : 'effect-blank', text: move.effect === 'live' ? TEXT.effectLive : TEXT.effectBlank }) : '',
        move.tail ? ` ${move.tail}` : '');
    }
    if (view.role === 'spectator') note.textContent = TEXT.watchingWaiting;
    else if (view.role !== 'alive' && view.status === 'active') note.textContent = TEXT.watchingOut;
    note.hidden = !(view.role === 'spectator' || (view.role !== 'alive' && view.status === 'active'));
  }

  function renderHand(view) {
    const tools = view.role === 'alive' && view.status === 'active' ? view.self?.hand ?? [] : null;
    hand.hidden = tools === null;
    if (tools === null) return;
    const key = tools.join(',');
    if (key === handKey) return;
    handKey = key;
    handTitle.textContent = tools.length > 0 ? TEXT.handTitle(tools.length) : TEXT.handEmpty;
    handList.replaceChildren(...tools.map((tool) => h('button', {
      type: 'button', class: 'hand-tool', disabled: true, 'aria-label': toolName(tool),
    }, toolIcon(tool, 'small'), h('span', { class: 'hand-name', text: toolName(tool) }))));
  }

  function renderFire() {
    const show = myTurn();
    fireWrap.hidden = !show;
    if (!show) return;
    const pressing = isPressing(press);
    fireButton.disabled = !canFire() && !pressing;
    fireButton.classList.toggle('is-ready', target !== null);
    fireButton.classList.toggle('is-pressing', pressing);
    fireMain.textContent = target === null ? TEXT.chooseTarget : TEXT.fire;
    if (sending) fireSub.textContent = TEXT.firing;
    else if (pressing) fireSub.textContent = TEXT.slideToCancel;
    else if (target === null) fireSub.textContent = TEXT.chooseTargetHint;
    else fireSub.textContent = target === mySeat ? TEXT.targetSelf : TEXT.targetIs(nameOf(target));
  }

  function updateClock() {
    if (destroyed || !applied) return;
    const ms = clockMs();
    ring.hidden = ms === null;
    if (ms !== null) {
      const total = applied.view.config.shotTimeSeconds * 1000;
      const seconds = secondsShown(ms);
      ringText.textContent = String(seconds);
      ring.setAttribute('aria-label', TEXT.secondsLeft(seconds));
      ringBar.setAttribute('stroke-dasharray', `${((ms / total) * RING).toFixed(1)} ${RING.toFixed(1)}`);
      ring.classList.toggle('is-mine', applied.view.clock.playerId === mySeat);
    }
    const urgent = myTurn() && ms !== null && ms <= URGENT_MS && ms > 0;
    fireButton.classList.toggle('is-urgent', urgent);
    // Time ran out during a press: cancel it; the clock sends the timeout (engine rule).
    if (ms === 0 && isPressing(press)) dispatch({ type: 'expire' });
    if (ms === 0 && myTurn() && !fireButton.disabled && !isPressing(press)) renderFire();
  }

  // --- Revolver --------------------------------------------------------------------------------
  function pointRevolver(seatId) {
    const seat = seatId ? seatEls.get(seatId) : null;
    if (!seat?.spot || !applied) return;
    const width = stage.clientWidth || STAGE_WIDTH;
    const layout = seatLayout(applied.view.players.length);
    const point = { x: (seat.spot.x / STAGE_WIDTH) * width, y: seat.spot.y };
    const next = nearestAngle(angle, aimAngle({ x: width / 2, y: layout.cy }, point));
    const moved = !Number.isFinite(angle) || Math.abs(next - angle) > 1;
    angle = next;
    // Always the same function list, so the turn (and the mirror flip) interpolates smoothly.
    revolverWrap.style.transform = `rotate(${next.toFixed(1)}deg) scaleY(${pointsLeft(next) ? -1 : 1})`;
    revolverWrap.setAttribute('aria-label', TEXT.revolverAt(nameOf(seatId)));
    return moved;
  }

  async function aimAt(seatId) {
    const moved = pointRevolver(seatId);
    if (moved) await wait(reducedMotion() ? SHOT_TIMING.reducedAim : SHOT_TIMING.aim);
  }

  async function shotAnimation(shot) {
    const reduced = reducedMotion();
    const live = shot.effect === 'live';
    revolverWrap.classList.remove('is-live', 'is-blank', 'is-cocking', 'is-cocked');
    void revolverWrap.offsetWidth; // restart the keyframes
    revolverWrap.classList.add(live ? 'is-live' : 'is-blank');
    const total = live ? (reduced ? SHOT_TIMING.reducedLive : SHOT_TIMING.live) : (reduced ? SHOT_TIMING.reducedBlank : SHOT_TIMING.blank);
    if (live) {
      later(() => {
        for (const hit of shot.hits ?? []) {
          const seat = seatEls.get(hit.player);
          if (hit.result === 'damage' && seat) {
            seat.el.classList.add('is-hit');
            later(() => seat.el.classList.remove('is-hit'), 700);
          }
        }
      }, reduced ? 0 : 440);
    }
    await wait(total);
    revolverWrap.classList.remove('is-live', 'is-blank');
    await wait(SHOT_TIMING.hold);
  }

  // --- Reload announcement -----------------------------------------------------------------------
  function showReload({ live, blank, text }) {
    reloadLive.textContent = live;
    reloadBlank.textContent = blank;
    reloadSr.textContent = `${TEXT.reloadLabel}: ${text}`;
    reloadBanner.hidden = false;
    reloadBanner.classList.remove('is-showing');
    void reloadBanner.offsetWidth;
    reloadBanner.classList.add('is-showing');
    later(() => {
      reloadBanner.hidden = true;
      reloadBanner.classList.remove('is-showing');
    }, RELOAD_SHOW_MS, 'reload');
  }

  // --- The fire button's press ---------------------------------------------------------------------
  function dispatch(event) {
    const result = pressStep(press, event);
    press = result.state;
    const effect = result.effect;
    if (!isPressing(press) && holdTimer !== null) {
      clearTimeout(holdTimer);
      timers.delete(holdTimer);
      holdTimer = null;
    }
    if (effect === 'cock') {
      revolverWrap.classList.add('is-cocking');
      later(() => {
        if (press.phase === PRESS.COCKED) revolverWrap.classList.add('is-cocked');
      }, reducedMotion() ? 0 : 600, 'cocked');
    } else if (effect === 'cancel') {
      revolverWrap.classList.remove('is-cocking', 'is-cocked');
    } else if (effect && effect.fire) {
      // A long press keeps the hammer drawn back until the shot animation lets it fall.
      revolverWrap.classList.remove('is-cocked');
      fire();
    }
    if (applied) renderFire();
  }

  function isInside(event) {
    const box = fireButton.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  function startPress() {
    dispatch({ type: 'down', at: performance.now(), enabled: canFire() });
    if (isPressing(press)) holdTimer = later(() => {
      holdTimer = null;
      dispatch({ type: 'hold', at: performance.now() });
    }, LONG_PRESS_MS);
  }

  fireButton.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      fireButton.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable (e.g. synthetic events): the move / up checks still work.
    }
    startPress();
  });
  fireButton.addEventListener('pointermove', (event) => {
    if (isPressing(press) && !isInside(event)) dispatch({ type: 'leave' });
  });
  fireButton.addEventListener('pointerup', (event) => dispatch({ type: 'up', at: performance.now(), inside: isInside(event) }));
  fireButton.addEventListener('pointercancel', () => dispatch({ type: 'expire' }));
  fireButton.addEventListener('lostpointercapture', () => {
    if (isPressing(press)) dispatch({ type: 'expire' });
  });
  fireButton.addEventListener('contextmenu', (event) => event.preventDefault());
  // Keyboard: Enter / Space press and release like a finger inside the button.
  fireButton.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) startPress();
  });
  fireButton.addEventListener('keyup', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    dispatch({ type: 'up', at: performance.now(), inside: true });
  });
  fireButton.addEventListener('blur', () => dispatch({ type: 'expire' }));
  // Clicks are handled by the press events above.
  fireButton.addEventListener('click', (event) => event.preventDefault());

  // --- Sending the shot -------------------------------------------------------------------------
  // The engine's confirmation step would write the aimed target into the match before the shot.
  // It is switched off for this player once per match (setPreference, an ordinary action), so the
  // shot is ONE chooseTarget that aims and fires in the same write.
  function ensureNoConfirm() {
    if (!applied || applied.view.role !== 'alive' || applied.view.status !== 'active') return prefPromise;
    if (applied.view.self?.confirmShot === false) return null;
    if (prefFor === applied.n && prefPromise) return prefPromise;
    prefFor = applied.n;
    prefPromise = api.submitAction({ uid, code, action: { type: 'setPreference', confirmShot: false } })
      .catch((error) => {
        prefFor = null;
        report(error);
      })
      .finally(() => {
        prefPromise = null;
      });
    return prefPromise;
  }

  async function fire() {
    if (!canFire()) return;
    const aimed = target;
    sending = true;
    renderAll();
    try {
      const pending = ensureNoConfirm();
      if (pending) await pending;
      if (destroyed) return;
      if (applied.view.self?.confirmShot !== false && prefFor === null) {
        showError(TEXT.shotRefused);
        return;
      }
      const result = await api.submitAction({ uid, code, action: { type: 'chooseTarget', target: aimed } });
      if (!destroyed && !result.ok) showError(TEXT.shotRefused);
    } catch (error) {
      report(error);
    } finally {
      sending = false;
      if (!destroyed) {
        if (!revolverWrap.classList.contains('is-live') && !revolverWrap.classList.contains('is-blank')) {
          revolverWrap.classList.remove('is-cocking');
        }
        renderAll();
      }
    }
  }

  // --- Public ----------------------------------------------------------------------------------
  return {
    el,
    /** Names and presence from the waiting room's live snapshot. */
    setRoom(room) {
      names = room.names ?? {};
      presence = room.presence ?? {};
      if (!running) renderAll();
    },
    /** Resolves once the last update has been animated and the final state was on screen a moment. */
    async finish() {
      const started = Date.now();
      while (!destroyed && Date.now() - started < 10000) {
        const idle = !running && queue.length === 0;
        if (idle && endedAt !== null && Date.now() - endedAt >= END_HOLD_MS) return;
        if (idle && endedAt === null && Date.now() - started >= 2000) return;
        await wait(100);
        if (destroyed) return;
      }
    },
    destroy() {
      if (destroyed) return;
      dispatch({ type: 'expire' });
      destroyed = true;
      clearInterval(tick);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const stop of stops.splice(0)) {
        try {
          const result = stop();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch {
          // Already stopped.
        }
      }
    },
  };
}

// The table's static drawing (approved mock): dashed ring, eight-pointed star, the revolver's base.
const DECOR = ['svg', { class: 'table-decor', width: 248, height: 248, viewBox: '0 0 248 248', 'aria-hidden': 'true' },
  ['circle', { cx: 124, cy: 124, r: 104, fill: 'none', stroke: '#EFE6D6', 'stroke-opacity': 0.12, 'stroke-width': 1, 'stroke-dasharray': '3 5' }],
  ['rect', { x: 64, y: 64, width: 120, height: 120, fill: 'none', stroke: '#3FB5AC', 'stroke-opacity': 0.35, 'stroke-width': 1.5 }],
  ['rect', { x: 64, y: 64, width: 120, height: 120, fill: 'none', stroke: '#3FB5AC', 'stroke-opacity': 0.35, 'stroke-width': 1.5, transform: 'rotate(45 124 124)' }],
  ['circle', { cx: 124, cy: 124, r: 46, fill: '#1E1814', stroke: '#3FB5AC', 'stroke-opacity': 0.5, 'stroke-width': 1 }]];

const GEAR = ['svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#EFE6D6', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
  ['circle', { cx: 12, cy: 12, r: 3.2 }],
  ['path', { d: 'M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7.1 7.1 M16.9 16.9 L18.7 18.7 M5.3 18.7 L7.1 16.9 M16.9 7.1 L18.7 5.3' }],
  ['circle', { cx: 12, cy: 12, r: 7 }]];
