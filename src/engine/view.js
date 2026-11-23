// viewFor(state, playerId): the part of the state one player may know.
//
// Public for everyone: seats, HP, who is alive / jailed, links, turn, the
// counts announced at the last reload, the number of shots fired this round,
// a pending double, a pending steal (who, never what), the shop stock, and the
// config. Loot is never public (decision 63): not even that one is open.
//
// Never exposed to anyone: the chamber order, the remaining live/blank
// counts, the PRNG state.
//
// Private to their owner: hand, coins, shields, private info, ransom offers,
// the tools-used counter, the confirmation preference, a ghost's prediction,
// and the secret content of a pending step (aimed target, steal peek,
// hand-size peek) and the looter's open loots.

import { clone, getPlayer, hasOwn } from './util.js';
import { handCounts } from './tools.js';
import { lootsOf } from './loot.js';

function publicPhase(state) {
  const phase = state.phase;
  switch (phase.type) {
    case 'steal':
      return { type: 'steal', thief: state.turn.playerId, victim: phase.victim };
    case 'ended':
      return { type: 'ended' };
    default:
      // 'turn', and also 'confirm' and 'handSwap': an aim is the shooter's own
      // business until the shot, and a hand swap is not public until a target is named.
      return { type: 'turn' };
  }
}

function shieldView(state, shields) {
  return shields.map((fromTurn) => ({ active: fromTurn <= state.turn.number }));
}

function privatePending(state, me) {
  const phase = state.phase;
  const isCurrent = state.turn.playerId === me.id;
  if (phase.type === 'confirm' && isCurrent) {
    return { type: 'confirm', target: phase.target };
  }
  if (phase.type === 'handSwap' && isCurrent) {
    return { type: 'handSwap', counts: handCounts(state, me.id) };
  }
  if (phase.type === 'steal' && isCurrent) {
    return { type: 'steal', victim: phase.victim, tools: getPlayer(state, phase.victim).hand.slice() };
  }
  return null;
}

// playerId may be a player of the match, or null/unknown for an outside
// spectator (public information only).
export function viewFor(state, playerId) {
  const me = playerId == null ? null : getPlayer(state, playerId);
  const custom = state.config.mode === 'custom';
  let role = 'spectator';
  if (me) role = me.alive ? 'alive' : custom ? 'ghost' : 'eliminated';

  const view = {
    viewer: me ? me.id : null,
    role,
    version: state.version,
    config: clone(state.config),
    status: state.status,
    result: clone(state.result),
    startingPlayers: state.startingPlayers,
    direction: state.direction,
    players: state.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      hp: p.hp,
      alive: p.alive,
      jailed: p.jailed,
    })),
    links: clone(state.links),
    doublePending: state.doublePending,
    turn: { playerId: state.turn.playerId, number: state.turn.number },
    round: {
      index: state.round.index,
      announced: clone(state.round.announced),
      shots: state.round.shots,
    },
    phase: publicPhase(state),
    clock: clone(state.clock),
    shop: custom ? { stock: clone(state.shop.stock) } : null,
    self: null,
    ghost: null,
  };

  if (me && me.alive) {
    const isCurrent = state.turn.playerId === me.id;
    view.self = {
      hand: me.hand.slice(),
      confirmShot: me.confirmShot,
      shields: {
        shot: shieldView(state, me.shields.shot),
        tool: shieldView(state, me.shields.tool),
      },
      toolsUsedThisTurn: isCurrent ? state.turn.toolsUsed : null,
      ransomOffer: clone(me.ransomOffer),
      incomingRansomOffers: state.players
        .filter((p) => p.ransomOffer && p.ransomOffer.to === me.id)
        .map((p) => ({ from: p.id, ...clone(p.ransomOffer) })),
      pending: privatePending(state, me),
      // My open loots (decision 63): the victim's tools, private to me.
      loots: lootsOf(me).map((loot) => ({
        victim: loot.victim,
        tools: getPlayer(state, loot.victim).hand.slice(),
        coinsOption: custom,
        clockSeq: loot.clockSeq,
      })),
      coins: custom ? me.coins : null,
      privateInfo: custom ? clone(me.privateInfo) : null,
    };
  } else if (me && custom) {
    // A ghost keeps nothing of what it knew while alive.
    view.ghost = { prediction: hasOwn(state.predictions, me.id) ? state.predictions[me.id] : null };
  }

  return view;
}
