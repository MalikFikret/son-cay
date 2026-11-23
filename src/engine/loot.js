// Loot after an elimination (decision 63). The player credited with a kill gets
// a standing PRIVATE offer, like a ransom offer: it never blocks the game, the
// turn passes at once, and several offers can be open at the same time (for
// one looter or for several). Nobody else learns anything about it: no public
// event, nothing in anybody else's view.
//
// The looter secretly sees the eliminated player's tools and takes one
// (Custom: or coins up to the cap, chosen blind), or nothing. The offer lasts
// LOOT_SECONDS; the engine has no clock, so the looter's own device sends the
// expiry (a lootChoice of kind 'none' with expired: true) when the time is up.
// Its start is the countdown that began in the same write as the kill:
// `clockSeq` names it (the room layer knows when that countdown started).
//
// Whatever was not taken leaves the game when the offer closes: chosen,
// expired, the looter eliminated or removed, or the match ended.

import { ERR } from './constants.js';
import { getPlayer, isPlainObject, reject, removeOne, requireAlivePlayer } from './util.js';
import { priv } from './events.js';

// The open offers of a player (a state stored before decision 63 has none).
export function lootsOf(player) {
  return Array.isArray(player.loots) ? player.loots : [];
}

// Opens one offer. Called after the turn has moved on, so state.clock.seq is
// the countdown that started in the same write as the kill.
export function openLoot(ctx, looterId, victimId) {
  const s = ctx.state;
  const looter = getPlayer(s, looterId);
  const victim = getPlayer(s, victimId);
  if (!Array.isArray(looter.loots)) looter.loots = [];
  looter.loots.push({ victim: victim.id, clockSeq: s.clock.seq });
  priv(ctx, looter.id, 'lootOffer', {
    looter: looter.id,
    victim: victim.id,
    tools: victim.hand.slice(),
    coinsOption: s.config.mode === 'custom',
    clockSeq: s.clock.seq,
  });
}

// Closes one offer of a looter. The victim's remaining tools and coins leave the game.
function closeLoot(ctx, looter, index, result) {
  const s = ctx.state;
  const [offer] = looter.loots.splice(index, 1);
  const victim = getPlayer(s, offer.victim);
  victim.hand = [];
  victim.coins = 0;
  priv(ctx, looter.id, 'lootResult', { looter: looter.id, victim: victim.id, ...result });
}

// Closes every open offer of a player who can no longer loot (eliminated,
// removed) or of everybody when the match ends. Nothing is taken.
export function closeLootsOf(ctx, player, reason) {
  while (lootsOf(player).length > 0) {
    closeLoot(ctx, player, 0, { taken: 'none', forfeited: true, reason });
  }
}

export function handleLootChoice(ctx, action) {
  const s = ctx.state;
  const player = requireAlivePlayer(s, action.playerId);
  const index = typeof action.victim === 'string' ? lootsOf(player).findIndex((l) => l.victim === action.victim) : -1;
  // A late choice (the offer expired or closed) or someone else's loot.
  if (index === -1) reject(ERR.NO_LOOT, 'you have no open loot of that player');
  const victim = getPlayer(s, player.loots[index].victim);
  const choice = action.choice;
  if (!isPlainObject(choice)) reject(ERR.INVALID_ACTION, 'choice must be an object');

  if (choice.kind === 'tool') {
    if (typeof choice.tool !== 'string' || !removeOne(victim.hand, choice.tool)) {
      reject(ERR.INVALID_CHOICE, 'that tool is not among the eliminated player\'s tools');
    }
    player.hand.push(choice.tool);
    closeLoot(ctx, player, index, { taken: 'tool', tool: choice.tool, forfeited: false, reason: 'chosen' });
  } else if (choice.kind === 'coins') {
    if (s.config.mode !== 'custom') reject(ERR.INVALID_CHOICE, 'coins can be looted only in custom mode');
    // Chosen blind: the looter gets what is there, up to the cap.
    const amount = Math.min(victim.coins, s.config.custom.lootCoinCap);
    player.coins += amount;
    closeLoot(ctx, player, index, { taken: 'coins', amount, coins: player.coins, forfeited: false, reason: 'chosen' });
  } else if (choice.kind === 'none') {
    // The looter's device sends the expiry when LOOT_SECONDS have passed.
    const expired = action.expired === true;
    closeLoot(ctx, player, index, { taken: 'none', forfeited: expired, reason: expired ? 'expired' : 'chosen' });
  } else {
    reject(ERR.INVALID_CHOICE, "choice.kind must be 'tool', 'coins' or 'none'");
  }
}
