// The reducer: createMatch(config, players, seed) and applyAction(state, action).
//
// Both are pure. applyAction never mutates its input: it works on a deep copy
// (the "draft") and returns it. A rejected action returns the ORIGINAL state
// object untouched, together with an error code.

import { ENGINE_VERSION, ERR, MIN_PLAYERS, MAX_PLAYERS, PLAYER_ID_PATTERN } from './constants.js';
import { clone, EngineError, isInt, isPlainObject, reject, requireAlivePlayer, requireTarget } from './util.js';
import { validateConfig } from './config.js';
import { randInt, seedToUint32, shuffleInPlace } from './rng.js';
import { pub, priv } from './events.js';
import { startRound } from './roulette.js';
import { fire } from './shot.js';
import { abandonPendingTool, handleHandSwapTarget, handleStealChoice, handleUseTool } from './tools.js';
import { forfeitLoot, handleLootChoice } from './loot.js';
import { handleBuy, handleTransfer } from './economy.js';
import { handleRansomAccept, handleRansomOffer, handleRansomReject, handleRansomWithdraw } from './jail.js';
import { handlePredict } from './ghosts.js';
import { handleRemovePlayer } from './removal.js';

function failure(code, message, extra) {
  return { ok: false, error: { code, message, ...extra } };
}

// players: [{ id: string, confirmShot?: boolean }, ...] (3 to 15, unique ids)
//          confirmShot: the player's confirmation step, OFF unless true (decision 55:
//          the game has no confirmation step; the option stays in the engine).
// seed:    integer or non-empty string
// Returns { ok: true, state, events } or { ok: false, error }.
export function createMatch(config, players, seed) {
  const checked = validateConfig(config === undefined ? {} : config);
  if (!checked.ok) {
    return failure(ERR.INVALID_CONFIG, 'invalid config', { details: checked.errors });
  }
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    return failure(ERR.INVALID_PLAYERS, `a match needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  const seen = [];
  for (const p of players) {
    // Ids are used as object keys elsewhere, so they must be simple and must
    // not collide with built-in object properties such as 'constructor'.
    if (!isPlainObject(p) || typeof p.id !== 'string' || !PLAYER_ID_PATTERN.test(p.id) || p.id in {}) {
      return failure(
        ERR.INVALID_PLAYERS,
        'every player needs an id of 1-64 letters, digits, "_" or "-" that is not a reserved word',
      );
    }
    if (seen.includes(p.id)) return failure(ERR.INVALID_PLAYERS, `duplicate player id: ${p.id}`);
    if (p.confirmShot !== undefined && typeof p.confirmShot !== 'boolean') {
      return failure(ERR.INVALID_PLAYERS, 'confirmShot must be a boolean');
    }
    seen.push(p.id);
  }
  const seedOk = (isInt(seed) && seed >= 0) || (typeof seed === 'string' && seed.length > 0);
  if (!seedOk) return failure(ERR.INVALID_SEED, 'seed must be a non-negative integer or a non-empty string');

  const cfg = checked.config;
  const state = {
    version: ENGINE_VERSION,
    config: cfg,
    rng: { s: seedToUint32(seed) },
    status: 'active',
    result: null,
    startingPlayers: players.length,
    players: [],
    direction: 1,
    turn: null,
    round: null,
    links: [],
    doublePending: false,
    phase: { type: 'turn' },
    clock: { seq: 0, kind: 'none', playerId: null },
    shop: null,
    predictions: {},
  };
  const ctx = { state, events: [] };

  const order = players.map((p) => ({ id: p.id, confirmShot: p.confirmShot === true }));
  if (cfg.randomizeSeats) shuffleInPlace(state, order);
  state.players = order.map((p, seat) => ({
    id: p.id,
    seat,
    hp: cfg.hp,
    alive: true,
    hand: [],
    coins: cfg.mode === 'custom' ? cfg.custom.startCoins : 0,
    shields: { shot: [], tool: [] },
    jailed: false,
    ransomOffer: null,
    confirmShot: p.confirmShot,
    privateInfo: null,
  }));
  pub(ctx, 'matchStarted', {
    mode: cfg.mode,
    seats: state.players.map((p) => p.id),
    startingPlayers: state.startingPlayers,
  });

  startRound(ctx);

  const first = state.players[randInt(state, state.players.length)];
  state.turn = { playerId: first.id, number: 1, toolsUsed: 0 };
  state.clock = { seq: 1, kind: 'shot', playerId: first.id };
  pub(ctx, 'turnStarted', { player: first.id, turn: 1 });

  return { ok: true, state, events: ctx.events };
}

function requireCurrentPlayer(state, action) {
  const player = requireAlivePlayer(state, action.playerId);
  if (state.turn.playerId !== player.id) reject(ERR.NOT_YOUR_TURN, 'it is not your turn');
  return player;
}

// Pick a target. With the player's confirmation off (the default) this fires
// at once; with it switched on it only aims and confirmShot fires. The aim itself is known
// to the shooter only: nobody gets a chance to react between aim and shot.
function handleChooseTarget(ctx, action) {
  const s = ctx.state;
  const player = requireCurrentPlayer(s, action);
  if (s.phase.type !== 'turn' && s.phase.type !== 'confirm') {
    reject(ERR.WRONG_PHASE, 'you cannot aim right now');
  }
  const target = requireTarget(s, action.target);
  if (player.confirmShot) {
    s.phase = { type: 'confirm', target: target.id };
    priv(ctx, player.id, 'targetChosen', { player: player.id, target: target.id });
  } else {
    fire(ctx, player.id, target.id, false);
  }
}

function handleConfirmShot(ctx, action) {
  const s = ctx.state;
  const player = requireCurrentPlayer(s, action);
  if (s.phase.type !== 'confirm') reject(ERR.WRONG_PHASE, 'choose a target first');
  fire(ctx, player.id, s.phase.target, false);
}

function handleCancelTarget(ctx, action) {
  const s = ctx.state;
  const player = requireCurrentPlayer(s, action);
  if (s.phase.type !== 'confirm') reject(ERR.WRONG_PHASE, 'there is no target to cancel');
  s.phase = { type: 'turn' };
  priv(ctx, player.id, 'targetCancelled', { player: player.id });
}

// Per-player setting: skip the confirmation step for one's own shots.
function handleSetPreference(ctx, action) {
  const player = requireAlivePlayer(ctx.state, action.playerId);
  if (typeof action.confirmShot !== 'boolean') reject(ERR.INVALID_ACTION, 'confirmShot must be a boolean');
  player.confirmShot = action.confirmShot;
  priv(ctx, player.id, 'preferenceSet', { player: player.id, confirmShot: player.confirmShot });
}

// The host's timer ran out.
// - loot pending:      the looter forfeits this loot.
// - anything else:     any pending step (aim, hand swap, steal) is abandoned
//                      and the current chamber is fired at the turn player.
//                      Like any self shot: a blank keeps the turn (with a fresh
//                      clock), a live passes it.
function handleTimeout(ctx, action) {
  const s = ctx.state;
  if (action.seq !== undefined && action.seq !== s.clock.seq) {
    reject(ERR.STALE_TIMEOUT, 'this timeout belongs to an older timer');
  }
  if (s.phase.type === 'loot') {
    pub(ctx, 'timedOut', { player: s.phase.queue[0].looter, kind: 'loot' });
    forfeitLoot(ctx);
    return;
  }
  const playerId = s.turn.playerId;
  pub(ctx, 'timedOut', { player: playerId, kind: 'shot' });
  abandonPendingTool(ctx);
  fire(ctx, playerId, playerId, true);
}

const HANDLERS = {
  chooseTarget: handleChooseTarget,
  confirmShot: handleConfirmShot,
  cancelTarget: handleCancelTarget,
  useTool: handleUseTool,
  handSwapTarget: handleHandSwapTarget,
  stealChoice: handleStealChoice,
  lootChoice: handleLootChoice,
  setPreference: handleSetPreference,
  buy: handleBuy,
  transfer: handleTransfer,
  ransomOffer: handleRansomOffer,
  ransomWithdraw: handleRansomWithdraw,
  ransomAccept: handleRansomAccept,
  ransomReject: handleRansomReject,
  predict: handlePredict,
  timeout: handleTimeout,
  removePlayer: handleRemovePlayer,
};

// Returns { ok: true, state, events } on success, or
// { ok: false, state (the same object that was passed in), events: [], error }.
export function applyAction(state, action) {
  const fail = (code, message) => ({ ok: false, state, events: [], error: { code, message } });
  if (!isPlainObject(state) || state.version !== ENGINE_VERSION || !Array.isArray(state.players)) {
    return fail(ERR.INVALID_STATE, 'not a match state of this engine version');
  }
  if (!isPlainObject(action) || typeof action.type !== 'string') {
    return fail(ERR.INVALID_ACTION, 'an action is an object with a string type');
  }
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, action.type)) {
    return fail(ERR.UNKNOWN_ACTION, `unknown action type: ${action.type}`);
  }
  if (state.status === 'ended') return fail(ERR.MATCH_ENDED, 'the match is over');

  const ctx = { state: clone(state), events: [] };
  try {
    HANDLERS[action.type](ctx, action);
  } catch (e) {
    if (e instanceof EngineError) return fail(e.code, e.message);
    throw e;
  }
  return { ok: true, state: ctx.state, events: ctx.events };
}
