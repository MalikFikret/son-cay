// Invariant and leak checkers shared by the fuzz test and the visibility tests.

import assert from 'node:assert/strict';
import { TOOL_INFO, isHiddenTool, viewFor, listLegalActions } from '../src/engine/index.js';

// The only fields a public event of each type may carry.
export const PUBLIC_EVENT_FIELDS = {
  matchStarted: ['mode', 'seats', 'startingPlayers'],
  reloaded: ['round', 'total', 'live', 'blank'],
  shopRestocked: ['round', 'stock'],
  shopStockChanged: ['tool', 'remaining'],
  turnStarted: ['player', 'turn'],
  turnSkipped: ['player', 'reason'],
  shot: ['round', 'shooter', 'target', 'effect', 'doubled', 'auto', 'reflected', 'hits'],
  toolUsed: ['tool', 'by', 'target', 'targets', 'direction', 'hp'],
  toolBlocked: ['tool', 'by', 'blockedBy'],
  eliminated: ['player', 'by', 'round'],
  roundEnded: ['round', 'shots', 'survivors'],
  predictionResolved: ['player', 'round', 'prediction', 'correct'],
  jailReleased: ['player', 'reason'],
  timedOut: ['player', 'kind'],
  playerRemoved: ['player'],
  matchEnded: ['result', 'winner', 'startingPlayers'],
};

// Every event is well formed, public events carry only whitelisted fields,
// and a hidden tool never appears in a public event.
export function checkEvents(state, events) {
  const known = state.players.map((p) => p.id);
  for (const e of events) {
    assert.equal(typeof e.type, 'string');
    if (e.visibility === 'public') {
      const allowed = PUBLIC_EVENT_FIELDS[e.type];
      assert.ok(allowed, `event type must not be public: ${e.type}`);
      for (const key of Object.keys(e)) {
        if (key === 'type' || key === 'visibility') continue;
        assert.ok(allowed.includes(key), `public ${e.type} event leaks field "${key}"`);
      }
      if (e.type === 'toolUsed' || e.type === 'toolBlocked') {
        assert.ok(TOOL_INFO[e.tool]);
        assert.equal(isHiddenTool(e.tool, state.config.mode), false, `hidden tool in a public event: ${e.tool}`);
      }
    } else {
      assert.equal(e.visibility, 'private');
      assert.ok(Array.isArray(e.to));
      for (const id of e.to) assert.ok(known.includes(id), `private event addressed to unknown id ${id}`);
    }
  }
}

// Structural invariants of a state.
export function checkState(state) {
  const cfg = state.config;
  const alive = state.players.filter((p) => p.alive);
  const idsAll = state.players.map((p) => p.id);

  for (const p of state.players) {
    assert.ok(Number.isInteger(p.hp) && p.hp >= 0, `hp must be a non-negative integer (${p.id}: ${p.hp})`);
    assert.equal(p.alive, p.hp > 0, `alive must match hp > 0 (${p.id})`);
    assert.ok(p.hp <= cfg.hp, 'hp above the starting value');
    assert.ok(Number.isInteger(p.coins) && p.coins >= 0, `coins must be a non-negative integer (${p.id})`);
    if (cfg.mode === 'classic') assert.equal(p.coins, 0);
    for (const tool of p.hand) assert.ok(cfg.enabledTools.includes(tool), `tool not enabled in this match: ${tool}`);
    if (!p.alive) {
      assert.deepEqual(p.shields, { shot: [], tool: [] });
      assert.equal(p.jailed, false);
      assert.equal(p.ransomOffer, null);
      assert.equal(p.privateInfo, null);
    }
    // Open loots (decision 63): held by a living looter, each on a different
    // eliminated victim, never looted twice; only a looted victim keeps tools.
    const loots = p.loots ?? [];
    if (!p.alive) assert.deepEqual(loots, [], 'a player who is out holds no loot');
    for (const loot of loots) {
      const victim = state.players.find((q) => q.id === loot.victim);
      assert.ok(victim && !victim.alive && victim.id !== p.id, 'a loot is on an eliminated player');
      assert.ok(Number.isInteger(loot.clockSeq) && loot.clockSeq <= state.clock.seq);
      const holders = state.players.filter((q) => (q.loots ?? []).some((l) => l.victim === loot.victim));
      assert.equal(holders.length, 1, 'a victim is looted once');
      assert.equal((p.loots ?? []).filter((l) => l.victim === loot.victim).length, 1);
    }
    if (!p.alive && (p.hand.length > 0 || p.coins > 0)) {
      assert.ok(state.players.some((q) => (q.loots ?? []).some((l) => l.victim === p.id)), `${p.id} is out but keeps tools without an open loot`);
    }
    if (p.ransomOffer) {
      assert.ok(p.jailed, 'only a jailed player has an offer');
      const to = state.players.find((q) => q.id === p.ransomOffer.to);
      assert.ok(to && to.alive && to.id !== p.id);
    }
  }

  const round = state.round;
  const live = round.chambers.filter((c) => c.type === 'live').length;
  assert.equal(round.chambers.length, round.announced.total);
  assert.equal(live, round.announced.live, 'chamber types never change within a round');
  assert.equal(round.announced.total - live, round.announced.blank);
  assert.ok(round.announced.live >= 1 && round.announced.blank >= 1);
  assert.ok(round.cursor >= 0 && round.cursor <= round.chambers.length);
  assert.ok(round.shots >= 0 && round.shots <= round.cursor);

  for (const link of state.links) {
    assert.equal(link.length, 2);
    assert.notEqual(link[0], link[1]);
    for (const id of link) assert.ok(alive.some((p) => p.id === id), 'links connect living players only');
  }
  assert.ok(state.direction === 1 || state.direction === -1);

  if (cfg.mode === 'custom') {
    for (const tool of Object.keys(state.shop.stock)) {
      const left = state.shop.stock[tool];
      assert.ok(left === null || (Number.isInteger(left) && left >= 0), 'shop stock never negative');
    }
    const seen = {};
    for (const p of alive) {
      if (!p.privateInfo || p.privateInfo.round !== round.index) continue;
      assert.ok(!seen[p.privateInfo.chamberIndex], 'private info chambers are distinct');
      seen[p.privateInfo.chamberIndex] = true;
    }
  }
  for (const id of Object.keys(state.predictions)) {
    const p = state.players.find((q) => q.id === id);
    assert.ok(p && !p.alive, 'only ghosts predict');
  }

  if (state.status === 'active') {
    assert.equal(state.result, null);
    assert.ok(alive.length >= 2, 'an active match has at least two living players');
    assert.ok(round.cursor < round.chambers.length, 'an active match always has a current chamber');
    assert.ok(idsAll.includes(state.turn.playerId));
    const phase = state.phase.type;
    assert.ok(['turn', 'confirm', 'handSwap', 'steal'].includes(phase));
    // No stuck state: the turn player always has a move that makes progress.
    // Loot never blocks (decision 63): the clock is always a shot clock.
    const actor = state.turn.playerId;
    let progress = ['chooseTarget'];
    if (phase === 'handSwap') progress = ['handSwapTarget'];
    if (phase === 'steal') progress = ['stealChoice'];
    if (phase === 'confirm') progress = ['confirmShot'];
    assert.ok(state.players.find((p) => p.id === actor).alive, 'the turn player is alive');
    assert.equal(state.clock.kind, 'shot');
    assert.equal(state.clock.playerId, actor, 'the clock runs for the turn player');
    assert.ok(
      listLegalActions(state, actor).some((a) => progress.includes(a.type)),
      `stuck: ${actor} has no ${progress.join('/')} action in phase ${phase}`,
    );
  } else {
    assert.equal(state.status, 'ended');
    assert.equal(state.phase.type, 'ended');
    for (const p of state.players) assert.deepEqual(p.loots ?? [], [], 'the end of the match closes every loot');
    if (state.result.type === 'win') {
      assert.equal(alive.length, 1);
      assert.equal(state.result.winner, alive[0].id);
    } else {
      assert.equal(state.result.type, 'draw');
      assert.equal(alive.length, 0);
      assert.equal(state.result.winner, null);
    }
  }
}

export function checkSerializable(state) {
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state, 'state must survive a JSON round trip');
}

// Returns a copy of the state in which every secret the viewer must NOT know
// has been replaced by different data. If viewFor(viewer) is identical for
// the original and the scrambled state, none of those secrets leak.
export function scrambleSecrets(state, viewerId) {
  const s = structuredClone(state);
  const viewer = s.players.find((p) => p.id === viewerId) || null;
  const viewerAlive = !!(viewer && viewer.alive);
  const isCurrent = s.turn.playerId === viewerId;
  const phase = s.phase;
  const other = s.players.find((p) => p.id !== viewerId);

  s.rng.s = (s.rng.s ^ 0x5a5a5a5a) >>> 0;
  for (const c of s.round.chambers) {
    c.type = c.type === 'live' ? 'blank' : 'live';
    c.flipped = !c.flipped;
  }
  s.round.cursor = 0;

  for (const p of s.players) {
    if (p.id === viewerId && viewerAlive) continue;
    const seesHand =
      viewerAlive &&
      ((phase.type === 'steal' && isCurrent && phase.victim === p.id) ||
        (viewer.loots ?? []).some((l) => l.victim === p.id));
    const seesHandSize = viewerAlive && phase.type === 'handSwap' && isCurrent && p.alive;
    if (!seesHand) {
      p.hand = seesHandSize ? p.hand.map((t) => (t === 'heal' ? 'jail' : 'heal')) : [...p.hand, 'detector', 'flip'];
    }
    p.coins += 7;
    p.shields = { shot: [0, 0, 999], tool: [0] };
    p.confirmShot = !p.confirmShot;
    p.privateInfo = { round: 77, chamberIndex: 0, type: 'live', stale: true };
    // Another player's open loots (or their absence) are invisible (decision 63).
    p.loots = (p.loots ?? []).length > 0 ? [] : [{ victim: other.id, clockSeq: 1 }];
    if (p.ransomOffer && p.ransomOffer.to === viewerId && viewerAlive) continue; // the viewer may see it
    p.ransomOffer = p.ransomOffer ? null : { to: other.id === p.id ? p.id : other.id, kind: 'tool', tool: 'heal' };
    if (p.ransomOffer && (p.ransomOffer.to === viewerId || p.ransomOffer.to === p.id)) p.ransomOffer = null;
  }

  if (!isCurrent || !viewerAlive) {
    s.turn.toolsUsed += 1;
    // A pending aim or hand swap is invisible to everyone but its user.
    if (phase.type === 'handSwap') s.phase = { type: 'confirm', target: s.players[0].id };
    else if (phase.type === 'confirm') s.phase = { type: 'turn' };
    else if (phase.type === 'turn') s.phase = { type: 'handSwap' };
  }
  for (const p of s.players) {
    if (p.id === viewerId) continue;
    if (s.predictions[p.id]) delete s.predictions[p.id];
    else s.predictions[p.id] = 'live';
  }
  return s;
}

const FORBIDDEN_VIEW_KEYS = ['"rng"', '"chambers"', '"cursor"', '"predictions"'];

// viewFor(viewer) must not depend on anything the viewer may not know.
export function checkNoLeak(state, viewerId) {
  const view = JSON.stringify(viewFor(state, viewerId));
  for (const key of FORBIDDEN_VIEW_KEYS) assert.ok(!view.includes(key), `view exposes ${key}`);
  const scrambled = JSON.stringify(viewFor(scrambleSecrets(state, viewerId), viewerId));
  assert.equal(view, scrambled, `viewFor(${viewerId}) depends on hidden data`);
}

export function checkNoLeakForAll(state) {
  checkNoLeak(state, null);
  for (const p of state.players) checkNoLeak(state, p.id);
}
