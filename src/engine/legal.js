// listLegalActions(state, playerId): every action the player could submit
// right now and have accepted. Meant for dev tools, bots and tests; it reads
// only what that player may know plus public information.
//
// Open-ended numeric choices are sampled, not enumerated: transfers and coin
// ransoms are listed for the amounts 1 and "everything".

import { TOOL_INFO } from './constants.js';
import { alivePlayers, getPlayer } from './util.js';
import { lootsOf } from './loot.js';

function unique(list) {
  return list.filter((item, i) => list.indexOf(item) === i);
}

export function listLegalActions(state, playerId) {
  const actions = [];
  if (state.status !== 'active') return actions;
  const me = getPlayer(state, playerId);
  if (!me) return actions;
  const custom = state.config.mode === 'custom';

  if (!me.alive) {
    if (custom) {
      for (const prediction of ['live', 'blank', null]) actions.push({ type: 'predict', playerId, prediction });
    }
    return actions;
  }

  const alive = alivePlayers(state);
  const others = alive.filter((p) => p.id !== playerId);
  const isCurrent = state.turn.playerId === playerId;
  const phase = state.phase.type;
  const underLimit = !isCurrent || state.turn.toolsUsed < state.config.toolsPerTurn;
  const hand = unique(me.hand);

  if (isCurrent && (phase === 'turn' || phase === 'confirm')) {
    for (const p of alive) actions.push({ type: 'chooseTarget', playerId, target: p.id });
  }
  if (isCurrent && phase === 'confirm') {
    actions.push({ type: 'confirmShot', playerId });
    actions.push({ type: 'cancelTarget', playerId });
  }

  if (underLimit) {
    for (const tool of hand) {
      const info = TOOL_INFO[tool];
      if (info.timing === 'turn' && !(isCurrent && phase === 'turn')) continue;
      if (tool === 'double' && state.doublePending) continue;
      if (tool === 'heal' && me.hp >= state.config.hp) continue;
      if (tool === 'link') {
        for (let i = 0; i < alive.length; i++) {
          for (let j = i + 1; j < alive.length; j++) {
            actions.push({ type: 'useTool', playerId, tool, targets: [alive[i].id, alive[j].id] });
          }
        }
      } else if (tool === 'jail' || tool === 'steal') {
        for (const p of others) actions.push({ type: 'useTool', playerId, tool, target: p.id });
      } else {
        actions.push({ type: 'useTool', playerId, tool });
      }
    }
  }

  if (isCurrent && phase === 'handSwap') {
    for (const p of others) actions.push({ type: 'handSwapTarget', playerId, target: p.id });
  }

  if (isCurrent && phase === 'steal') {
    actions.push({ type: 'stealChoice', playerId, take: null, give: null });
    const victim = getPlayer(state, state.phase.victim);
    for (const take of unique(victim.hand)) {
      for (const give of hand) actions.push({ type: 'stealChoice', playerId, take, give });
    }
  }

  // Open loots (decision 63): at any time, in any phase, whoever's turn it is.
  for (const loot of lootsOf(me)) {
    const victim = getPlayer(state, loot.victim);
    actions.push({ type: 'lootChoice', playerId, victim: victim.id, choice: { kind: 'none' } });
    for (const tool of unique(victim.hand)) {
      actions.push({ type: 'lootChoice', playerId, victim: victim.id, choice: { kind: 'tool', tool } });
    }
    if (custom) actions.push({ type: 'lootChoice', playerId, victim: victim.id, choice: { kind: 'coins' } });
  }

  actions.push({ type: 'setPreference', playerId, confirmShot: !me.confirmShot });

  if (custom) {
    for (const tool of state.config.enabledTools) {
      const left = state.shop.stock[tool];
      if ((left === null || left > 0) && me.coins >= state.config.custom.prices[tool]) {
        actions.push({ type: 'buy', playerId, tool });
      }
    }
    if (me.coins >= 1) {
      for (const p of others) {
        actions.push({ type: 'transfer', playerId, to: p.id, amount: 1 });
        if (me.coins > 1) actions.push({ type: 'transfer', playerId, to: p.id, amount: me.coins });
      }
    }
  }

  if (me.jailed) {
    for (const p of others) {
      for (const tool of hand) {
        actions.push({ type: 'ransomOffer', playerId, to: p.id, offer: { kind: 'tool', tool } });
      }
      if (custom && me.coins >= 1) {
        actions.push({ type: 'ransomOffer', playerId, to: p.id, offer: { kind: 'coins', amount: 1 } });
        if (me.coins > 1) {
          actions.push({ type: 'ransomOffer', playerId, to: p.id, offer: { kind: 'coins', amount: me.coins } });
        }
      }
    }
  }
  if (me.ransomOffer) actions.push({ type: 'ransomWithdraw', playerId });
  for (const p of alive) {
    const offer = p.ransomOffer;
    if (!offer || offer.to !== playerId) continue;
    actions.push({ type: 'ransomReject', playerId, from: p.id });
    // Accepting is listed only when it would succeed. This is the one spot
    // where the list depends on another player's secrets (dev/test use only).
    const funded = offer.kind === 'tool' ? p.hand.includes(offer.tool) : p.coins >= offer.amount;
    if (funded) actions.push({ type: 'ransomAccept', playerId, from: p.id });
  }

  return actions;
}
