// System action: remove a player from the current match.
//
// Sent by the host layer, like `timeout`: the engine does not check who sent
// it. The host is responsible for allowing it only from the room host and
// only for a disconnected player.
//
// The removed player is treated as eliminated, but by nobody: no loot, no
// credit, no elimination points. Their tools and coins leave the game. In
// Custom they become a ghost like any eliminated player. Everything they are
// involved in is cleaned up (see docs/open-questions.md, Q35).

import { ERR } from './constants.js';
import { alivePlayers, getPlayer, reject } from './util.js';
import { pub, priv } from './events.js';
import { closeOffer, closeOffersTo } from './jail.js';
import { endMatch } from './shot.js';
import { closeLootsOf } from './loot.js';
import { abandonPendingTool } from './tools.js';
import { advanceTurn } from './turn.js';

export function handleRemovePlayer(ctx, action) {
  const s = ctx.state;
  if (typeof action.target !== 'string') reject(ERR.INVALID_TARGET, 'target must be a player id');
  const p = getPlayer(s, action.target);
  if (!p) reject(ERR.UNKNOWN_PLAYER, `unknown player: ${action.target}`);
  if (!p.alive) reject(ERR.PLAYER_ELIMINATED, `player is already out of the match: ${p.id}`);

  pub(ctx, 'playerRemoved', { player: p.id });

  p.alive = false;
  p.hp = 0;
  p.hand = [];
  p.coins = 0;
  p.shields = { shot: [], tool: [] };
  p.jailed = false;
  p.privateInfo = null;
  closeOffer(ctx, p, 'removed');
  closeOffersTo(ctx, p.id, 'removed');
  // Their open loots are lost; the victims' tools leave the game (decision 63).
  closeLootsOf(ctx, p, 'looterOut');
  s.links = s.links.filter((link) => link[0] !== p.id && link[1] !== p.id);

  if (alivePlayers(s).length <= 1) {
    endMatch(ctx);
    return;
  }

  const phase = s.phase;
  if (s.turn.playerId === p.id) {
    // Their pending step (aim, hand swap, steal) is abandoned and the turn
    // passes to the next living player. A pending double stays for the next shot.
    abandonPendingTool(ctx);
    advanceTurn(ctx);
    return;
  }
  // Someone else's pending step aimed at the removed player is dropped.
  if (phase.type === 'confirm' && phase.target === p.id) {
    s.phase = { type: 'turn' };
    priv(ctx, s.turn.playerId, 'targetCancelled', { player: s.turn.playerId });
  } else if (phase.type === 'steal' && phase.victim === p.id) {
    s.phase = { type: 'turn' };
    priv(ctx, s.turn.playerId, 'stealResult', { by: s.turn.playerId, victim: p.id, taken: null, given: null });
  }
}
