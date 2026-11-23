// Shot resolution: the chamber effect, double damage, shot shields and
// ricochet, links, eliminations, kill credit, match end, and what happens to
// the turn afterwards.

import { alivePlayers, getPlayer } from './util.js';
import { pub, priv, audit } from './events.js';
import { chamberEffect, currentChamber, reloadIfEmpty } from './roulette.js';
import { resolvePredictions } from './ghosts.js';
import { closeOffer, closeOffersTo } from './jail.js';
import { closeLootsOf, openLoot } from './loot.js';
import { advanceTurn, continueTurn } from './turn.js';

// A shield counts only once the turn in which it was raised has ended.
export function activeShieldIndex(state, shields) {
  return shields.findIndex((fromTurn) => fromTurn <= state.turn.number);
}

// Distributes the damage of one live shot.
//
// Rules implemented here:
// - A shot shield blocks the whole shot for its owner and sends it back at the
//   shooter. If the owner IS the shooter (self shot, ricochet, or damage
//   arriving through a link) the shield just absorbs it.
// - Damage on a linked player is copied to the partner(s), transitively.
// - Safety rule: one shot never strikes the same player more than once.
// - Kill credit: damage belongs to the shooter, except damage that comes from
//   a ricochet (and anything it drags along through links), which belongs to
//   the owner of the reflecting shield.
function distributeDamage(state, shooterId, targetId, amount) {
  const hits = [];
  const deaths = [];
  const struck = {};
  let reflected = false;

  const strike = (playerId, credit, via) => {
    if (struck[playerId]) return;
    struck[playerId] = true;
    const p = getPlayer(state, playerId);
    const shieldIndex = activeShieldIndex(state, p.shields.shot);
    if (shieldIndex !== -1) {
      p.shields.shot.splice(shieldIndex, 1);
      if (playerId === shooterId) {
        hits.push({ player: playerId, result: 'absorbed', via });
      } else {
        hits.push({ player: playerId, result: 'reflected', via });
        if (via === 'direct') reflected = true;
        strike(shooterId, playerId, 'reflect');
      }
      return;
    }
    p.hp = Math.max(0, p.hp - amount);
    hits.push({ player: playerId, result: 'damage', amount, hp: p.hp, via });
    if (p.hp === 0) deaths.push({ player: playerId, credit });
    for (const link of state.links) {
      if (link[0] === playerId) strike(link[1], credit, 'link');
      else if (link[1] === playerId) strike(link[0], credit, 'link');
    }
  };

  strike(targetId, shooterId, 'direct');
  return { hits, deaths, reflected };
}

function eliminate(ctx, death) {
  const s = ctx.state;
  const p = getPlayer(s, death.player);
  p.alive = false;
  p.hp = 0;
  p.shields = { shot: [], tool: [] };
  p.jailed = false;
  p.privateInfo = null;
  closeOffer(ctx, p, 'eliminated');
  closeOffersTo(ctx, p.id, 'eliminated');
  // A looter who is out loses every loot still open (decision 63).
  closeLootsOf(ctx, p, 'looterOut');
  s.links = s.links.filter((link) => link[0] !== p.id && link[1] !== p.id);
  pub(ctx, 'eliminated', {
    player: p.id,
    // Who gets credit for the elimination; null when the player did it to themself.
    by: death.credit === p.id ? null : death.credit,
    round: s.round.index,
  });
}

export function endMatch(ctx) {
  const s = ctx.state;
  const alive = alivePlayers(s);
  // The end of the match closes every open loot; nothing is taken.
  for (const p of s.players) closeLootsOf(ctx, p, 'matchEnded');
  for (const p of s.players) {
    if (!p.alive) {
      p.hand = [];
      p.coins = 0;
    }
  }
  s.status = 'ended';
  s.result = alive.length === 1 ? { type: 'win', winner: alive[0].id } : { type: 'draw', winner: null };
  s.phase = { type: 'ended' };
  s.predictions = {};
  s.clock = { seq: s.clock.seq + 1, kind: 'none', playerId: null };
  pub(ctx, 'matchEnded', {
    result: s.result.type,
    winner: s.result.winner,
    startingPlayers: s.startingPlayers,
  });
}

// Fires the current chamber. `auto` marks the automatic self shot of a timeout.
// A blank on self keeps the turn whether it was fired on purpose or by a
// timeout (design change: see docs/design-changes.md).
export function fire(ctx, shooterId, targetId, auto) {
  const s = ctx.state;
  const round = s.round;
  const chamber = currentChamber(s);
  round.cursor += 1;
  round.shots += 1;

  const effect = chamberEffect(chamber);
  const doubled = s.doublePending;
  s.doublePending = false; // consumed by this shot whatever happens
  const amount = effect === 'live' ? (doubled ? 2 : 1) : 0;

  resolvePredictions(ctx, effect);

  let outcome = { hits: [], deaths: [], reflected: false };
  if (effect === 'live') outcome = distributeDamage(s, shooterId, targetId, amount);

  // Everyone sees the EFFECT. A flipped chamber is indistinguishable from a
  // real chamber of the displayed kind.
  pub(ctx, 'shot', {
    round: round.index,
    shooter: shooterId,
    target: targetId,
    effect,
    doubled,
    auto,
    reflected: outcome.reflected,
    hits: outcome.hits,
  });
  audit(ctx, 'shotAudit', { round: round.index, chamberType: chamber.type, flipped: chamber.flipped });

  const selfBlank = effect === 'blank' && targetId === shooterId;
  if (selfBlank && s.config.mode === 'custom' && s.config.custom.selfBlankCoin > 0) {
    const shooter = getPlayer(s, shooterId);
    shooter.coins += s.config.custom.selfBlankCoin;
    priv(ctx, shooterId, 'coinsChanged', {
      player: shooterId,
      delta: s.config.custom.selfBlankCoin,
      coins: shooter.coins,
      reason: 'selfBlank',
    });
  }

  for (const death of outcome.deaths) eliminate(ctx, death);

  if (alivePlayers(s).length <= 1) {
    endMatch(ctx);
    return;
  }

  s.phase = { type: 'turn' };
  reloadIfEmpty(ctx);

  // The credited player loots each victim, if still alive and not the victim
  // (decision 63: a private standing offer; the turn passes at once).
  const loots = [];
  for (const death of outcome.deaths) {
    const victim = getPlayer(s, death.player);
    const looter = getPlayer(s, death.credit);
    if (death.credit !== death.player && looter.alive) {
      loots.push({ looter: looter.id, victim: victim.id });
    } else {
      victim.hand = [];
      victim.coins = 0;
    }
  }

  if (selfBlank) continueTurn(ctx);
  else advanceTurn(ctx);
  // After the turn moved on: the offers start with the countdown of this write.
  for (const loot of loots) openLoot(ctx, loot.looter, loot.victim);
}
