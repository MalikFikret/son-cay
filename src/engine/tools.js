// Tool use. One `useTool` action, plus the follow-up actions of the two
// multi-step tools (handSwap -> handSwapTarget, steal -> stealChoice).
//
// Handlers run on a draft state: they may mutate first and reject later,
// because a rejection discards the whole draft.

import { ERR, TOOL_INFO, isHiddenTool, isToolId, REFILL_PAUSE_MS } from './constants.js';
import { alivePlayers, reject, removeOne, requireAlivePlayer, requireTarget } from './util.js';
import { pub, priv } from './events.js';
import { shuffleInPlace } from './rng.js';
import { currentChamber, reloadIfEmpty } from './roulette.js';
import { setClock } from './turn.js';
import { activeShieldIndex } from './shot.js';

function requireCurrent(state, player) {
  if (state.turn.playerId !== player.id) reject(ERR.NOT_YOUR_TURN, 'it is not your turn');
}

// Consumes one active tool shield of every targeted player other than the
// user. Returns the ids of the players whose shield blocked the tool.
function blockersOf(state, userId, targetIds) {
  const blockers = [];
  for (const id of targetIds) {
    if (id === userId) continue;
    const target = state.players.find((p) => p.id === id);
    const index = activeShieldIndex(state, target.shields.tool);
    if (index !== -1) {
      target.shields.tool.splice(index, 1);
      blockers.push(id);
    }
  }
  return blockers;
}

// Private receipt for a fully hidden tool (the only trace it leaves).
function hiddenReceipt(ctx, player, tool, result) {
  priv(ctx, player.id, 'toolUsed', { tool, by: player.id, ...result });
}

const TOOL_HANDLERS = {
  // Reveals the type of the current chamber to the user only.
  detector(ctx, player) {
    hiddenReceipt(ctx, player, 'detector', { chamber: currentChamber(ctx.state).type });
  },

  // Same type or different types: current chamber vs the one after it.
  probe(ctx, player) {
    const { chambers, cursor } = ctx.state.round;
    let result = 'noNext'; // the current chamber is the last one of this reload
    if (cursor + 1 < chambers.length) {
      result = chambers[cursor].type === chambers[cursor + 1].type ? 'same' : 'different';
    }
    hiddenReceipt(ctx, player, 'probe', { result });
  },

  // How many live chambers among the next three (or fewer, if fewer remain).
  counter(ctx, player) {
    const { chambers, cursor } = ctx.state.round;
    const upcoming = chambers.slice(cursor, cursor + 3);
    hiddenReceipt(ctx, player, 'counter', {
      live: upcoming.filter((c) => c.type === 'live').length,
      examined: upcoming.length,
    });
  },

  // Discards the current chamber without firing; the turn stays.
  skip(ctx, player) {
    const s = ctx.state;
    const chamber = currentChamber(s);
    s.round.cursor += 1;
    if (isHiddenTool('skip', s.config.mode)) {
      hiddenReceipt(ctx, player, 'skip', { chamber: chamber.type });
    } else {
      // Custom: everyone sees the skip; the type stays with the user.
      pub(ctx, 'toolUsed', { tool: 'skip', by: player.id });
      priv(ctx, player.id, 'toolResult', { tool: 'skip', by: player.id, chamber: chamber.type });
    }
    // The last Mermi was discarded: the round ends and refills mid-turn. The turn stays, with a
    // fresh countdown after the round pause (decision Q79): the engine cannot freeze the running
    // one, it does not know how much of it has passed.
    if (reloadIfEmpty(ctx)) setClock(s, 'shot', s.turn.playerId, REFILL_PAUSE_MS);
  },

  // Swaps the current chamber with the next one, revealing neither.
  swap(ctx, player) {
    const { chambers, cursor } = ctx.state.round;
    const swapped = cursor + 1 < chambers.length;
    if (swapped) {
      const tmp = chambers[cursor];
      chambers[cursor] = chambers[cursor + 1];
      chambers[cursor + 1] = tmp;
    }
    hiddenReceipt(ctx, player, 'swap', { swapped });
  },

  // Inverts the effect of the current chamber (the mark stays on the chamber).
  flip(ctx, player) {
    const chamber = currentChamber(ctx.state);
    chamber.flipped = !chamber.flipped;
    hiddenReceipt(ctx, player, 'flip', { flipped: chamber.flipped });
  },

  // Randomly reorders the remaining chambers. Announced.
  shuffle(ctx, player) {
    const s = ctx.state;
    shuffleInPlace(s, s.round.chambers, s.round.cursor);
    for (const p of s.players) {
      // Custom: private info about a chamber still in play is no longer reliable.
      if (p.privateInfo && p.privateInfo.chamberIndex >= s.round.cursor) p.privateInfo.stale = true;
    }
    pub(ctx, 'toolUsed', { tool: 'shuffle', by: player.id });
  },

  // The next shot deals 2 if it is live.
  double(ctx, player) {
    const s = ctx.state;
    if (s.doublePending) reject(ERR.DOUBLE_ALREADY_ACTIVE, 'the next shot is already doubled');
    s.doublePending = true;
    pub(ctx, 'toolUsed', { tool: 'double', by: player.id });
  },

  reverse(ctx, player) {
    const s = ctx.state;
    s.direction = -s.direction;
    pub(ctx, 'toolUsed', { tool: 'reverse', by: player.id, direction: s.direction });
  },

  // Links two living players until the end of the reload.
  link(ctx, player, action) {
    const s = ctx.state;
    const targets = action.targets;
    if (!Array.isArray(targets) || targets.length !== 2) reject(ERR.INVALID_TARGET, 'link needs exactly two targets');
    const a = requireTarget(s, targets[0]);
    const b = requireTarget(s, targets[1]);
    if (a.id === b.id) reject(ERR.INVALID_TARGET, 'link needs two different players');
    pub(ctx, 'toolUsed', { tool: 'link', by: player.id, targets: [a.id, b.id] });
    const blockers = blockersOf(s, player.id, [a.id, b.id]);
    if (blockers.length > 0) {
      pub(ctx, 'toolBlocked', { tool: 'link', by: player.id, blockedBy: blockers });
      return;
    }
    const exists = s.links.some((l) => (l[0] === a.id && l[1] === b.id) || (l[0] === b.id && l[1] === a.id));
    if (!exists) s.links.push([a.id, b.id]);
  },

  // The target loses their next turn, once.
  jail(ctx, player, action) {
    const s = ctx.state;
    const target = requireTarget(s, action.target, player.id);
    pub(ctx, 'toolUsed', { tool: 'jail', by: player.id, target: target.id });
    const blockers = blockersOf(s, player.id, [target.id]);
    if (blockers.length > 0) {
      pub(ctx, 'toolBlocked', { tool: 'jail', by: player.id, blockedBy: blockers });
      return;
    }
    target.jailed = true; // jailing a jailed player adds nothing
  },

  // Step 1 of 2: the user sees every living player's hand size, then picks.
  handSwap(ctx, player) {
    const s = ctx.state;
    s.phase = { type: 'handSwap' };
    priv(ctx, player.id, 'handCounts', { by: player.id, counts: handCounts(s, player.id) });
  },

  // Step 1 of 2: the user sees the victim's hand. Consumed by the look itself.
  steal(ctx, player, action) {
    const s = ctx.state;
    const victim = requireTarget(s, action.target, player.id);
    pub(ctx, 'toolUsed', { tool: 'steal', by: player.id, target: victim.id });
    const blockers = blockersOf(s, player.id, [victim.id]);
    if (blockers.length > 0) {
      pub(ctx, 'toolBlocked', { tool: 'steal', by: player.id, blockedBy: blockers });
      return;
    }
    s.phase = { type: 'steal', victim: victim.id };
    priv(ctx, player.id, 'stealPeek', { by: player.id, victim: victim.id, tools: victim.hand.slice() });
  },

  // Shields are silent and start working when the current turn has ended.
  shotShield(ctx, player) {
    const s = ctx.state;
    player.shields.shot.push(s.turn.number + 1);
    hiddenReceipt(ctx, player, 'shotShield', { round: s.round.index });
  },

  toolShield(ctx, player) {
    const s = ctx.state;
    player.shields.tool.push(s.turn.number + 1);
    hiddenReceipt(ctx, player, 'toolShield', { round: s.round.index });
  },

  heal(ctx, player) {
    const s = ctx.state;
    // Heal never raises life points above the starting value.
    if (player.hp >= s.config.hp) {
      reject(ERR.HP_FULL, 'you are already at full health');
    }
    player.hp += 1;
    pub(ctx, 'toolUsed', { tool: 'heal', by: player.id, hp: player.hp });
  },
};

// Hand sizes of every living player except the viewer (handSwap peek).
export function handCounts(state, exceptId) {
  const counts = {};
  for (const p of alivePlayers(state)) if (p.id !== exceptId) counts[p.id] = p.hand.length;
  return counts;
}

export function handleUseTool(ctx, action) {
  const s = ctx.state;
  const player = requireAlivePlayer(s, action.playerId);
  const tool = action.tool;
  if (!isToolId(tool)) reject(ERR.UNKNOWN_TOOL, 'unknown tool id');
  if (!player.hand.includes(tool)) reject(ERR.TOOL_NOT_IN_HAND, 'you do not hold that tool');

  const isCurrent = s.turn.playerId === player.id;
  if (TOOL_INFO[tool].timing === 'turn') {
    requireCurrent(s, player);
    if (s.phase.type !== 'turn') reject(ERR.WRONG_PHASE, 'finish the pending step first');
  }
  // The per-turn limit counts everything used during the owner's own turn.
  // "Anytime" tools used outside one's turn are free of it.
  if (isCurrent) {
    if (s.turn.toolsUsed >= s.config.toolsPerTurn) reject(ERR.TOOL_LIMIT_REACHED, 'tool limit for this turn reached');
    s.turn.toolsUsed += 1;
  }
  removeOne(player.hand, tool);
  TOOL_HANDLERS[tool](ctx, player, action);
}

// Step 2 of handSwap: exchange whole hands with the chosen player.
export function handleHandSwapTarget(ctx, action) {
  const s = ctx.state;
  const player = requireAlivePlayer(s, action.playerId);
  requireCurrent(s, player);
  if (s.phase.type !== 'handSwap') reject(ERR.WRONG_PHASE, 'no hand swap is pending');
  const target = requireTarget(s, action.target, player.id);
  s.phase = { type: 'turn' };
  pub(ctx, 'toolUsed', { tool: 'handSwap', by: player.id, target: target.id });
  const blockers = blockersOf(s, player.id, [target.id]);
  if (blockers.length > 0) {
    pub(ctx, 'toolBlocked', { tool: 'handSwap', by: player.id, blockedBy: blockers });
    return;
  }
  const mine = player.hand;
  player.hand = target.hand;
  target.hand = mine;
  priv(ctx, player.id, 'handSwapped', { player: player.id, with: target.id, hand: player.hand.slice() });
  priv(ctx, target.id, 'handSwapped', { player: target.id, with: player.id, hand: target.hand.slice() });
}

// Step 2 of steal: take one tool and give one in exchange, or walk away.
export function handleStealChoice(ctx, action) {
  const s = ctx.state;
  const player = requireAlivePlayer(s, action.playerId);
  requireCurrent(s, player);
  if (s.phase.type !== 'steal') reject(ERR.WRONG_PHASE, 'no steal is pending');
  const victim = s.players.find((p) => p.id === s.phase.victim);
  const take = action.take === undefined ? null : action.take;
  const give = action.give === undefined ? null : action.give;
  s.phase = { type: 'turn' };

  if (take === null && give === null) {
    priv(ctx, player.id, 'stealResult', { by: player.id, victim: victim.id, taken: null, given: null });
    return;
  }
  // It is an exchange: nothing can be taken without giving something back.
  if (typeof take !== 'string' || typeof give !== 'string') {
    reject(ERR.INVALID_CHOICE, 'choose both a tool to take and a tool to give, or neither');
  }
  if (!removeOne(victim.hand, take)) reject(ERR.INVALID_CHOICE, 'the victim does not hold that tool');
  if (!removeOne(player.hand, give)) reject(ERR.TOOL_NOT_IN_HAND, 'you do not hold the tool you want to give');
  victim.hand.push(give);
  player.hand.push(take);
  priv(ctx, [player.id, victim.id], 'stealResult', { by: player.id, victim: victim.id, taken: take, given: give });
}

// Timeout while a tool step is pending: the step is abandoned.
export function abandonPendingTool(ctx) {
  const s = ctx.state;
  const playerId = s.turn.playerId;
  if (s.phase.type === 'handSwap') {
    // The tool was spent on the look; nobody was chosen.
    pub(ctx, 'toolUsed', { tool: 'handSwap', by: playerId, target: null });
  } else if (s.phase.type === 'steal') {
    priv(ctx, playerId, 'stealResult', { by: playerId, victim: s.phase.victim, taken: null, given: null });
  }
  s.phase = { type: 'turn' };
}
