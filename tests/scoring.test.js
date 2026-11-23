// Session points (document: "Session points", "Calculation rules",
// "The living and the ghosts").

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCORING,
  scoreMatch,
  classifyShot,
  validateScoring,
  createSession,
  addMatchToSession,
  sessionRanking,
  eventsFor,
} from '../src/engine/index.js';
import { setup, play, shoot, use, pubs, one, edit, deepFreeze } from './helpers.js';

const loot = (playerId, victim, kind = 'none') => ({ type: 'lootChoice', playerId, victim, choice: { kind } });
const predict = (playerId, prediction) => ({ type: 'predict', playerId, prediction });

function prepared(state, { shields = {}, links = [], dead = [] } = {}) {
  return edit(state, (d) => {
    for (const id of Object.keys(shields)) d.players.find((p) => p.id === id).shields.shot.push(0);
    for (const link of links) d.links.push(link.slice());
    for (const id of dead) {
      const p = d.players.find((q) => q.id === id);
      p.alive = false;
      p.hp = 0;
    }
  });
}

// Like play(), but the log starts with the matchStarted event a real match log
// begins with (it lists every player of the match).
function playLog(state, ...actions) {
  const res = play(state, ...actions);
  const started = {
    type: 'matchStarted',
    mode: state.config.mode,
    seats: state.players.map((p) => p.id),
    startingPlayers: state.startingPlayers,
    visibility: 'public',
  };
  return { state: res.state, events: [started, ...res.events] };
}

// Points per player for the events produced by some actions.
function points(state, actions, scoring) {
  const { events } = playLog(state, ...actions);
  return scoreMatch(events, scoring).players;
}

test('scoring: the default numbers are the ones in the scoring table', () => {
  assert.deepEqual(DEFAULT_SCORING, {
    liveOnOther: 1,
    blankOnOther: -1,
    blankOnSelf: 2,
    liveOnSelf: -1,
    elimination: 2,
    roundSurvivalPerShot: 1,
    winPerStartingPlayer: 3,
    predictionCorrect: 1,
    predictionWrong: -1,
    scoreAutoShots: true,
  });
});

test('scoring table: live shot on another player = +1', () => {
  const p = points(setup({ chambers: 'LBB' }), [shoot('p1', 'p2')]);
  assert.deepEqual(p.p1, { total: 1, shots: 1, eliminations: 0, rounds: 0, win: 0, predictions: 0 });
});

test('scoring table: blank shot on another player = -1', () => {
  assert.equal(points(setup({ chambers: 'BLB' }), [shoot('p1', 'p2')]).p1.total, -1);
});

test('scoring table: blank shot on yourself = +2', () => {
  assert.equal(points(setup({ chambers: 'BLB' }), [shoot('p1', 'p1')]).p1.total, 2);
});

test('scoring table: live shot on yourself = -1', () => {
  assert.equal(points(setup({ chambers: 'LBB' }), [shoot('p1', 'p1')]).p1.total, -1);
});

test('scoring table: eliminating a player = +2 (on top of the shot itself)', () => {
  const p = points(setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 } }), [shoot('p1', 'p2')]);
  assert.deepEqual(p.p1, { total: 3, shots: 1, eliminations: 2, rounds: 0, win: 0, predictions: 0 });
  assert.equal(p.p2.total, 0);
});

test('scoring table: finishing a round alive = the number of shots of that round', () => {
  // Three chambers, one of them skipped: two shots. Only p1, p3, p4 are alive at the end.
  const s0 = setup({ n: 4, chambers: 'BLB', hp: { p2: 1 }, hands: { p1: ['skip'] } });
  const { events } = playLog(s0, use('p1', 'skip'), shoot('p1', 'p2'), loot('p1', 'p2'), shoot('p3', 'p4'));
  assert.equal(one(pubs(events, 'roundEnded')).shots, 2);
  const p = scoreMatch(events).players;
  assert.equal(p.p1.rounds, 2);
  assert.equal(p.p3.rounds, 2);
  assert.equal(p.p4.rounds, 2);
  assert.equal(p.p2.rounds, 0, 'the eliminated player did not finish the round');
});

test('scoring table: winning the match = 3 points per player who STARTED the match', () => {
  const s0 = prepared(setup({ n: 5, chambers: 'LBB', hp: { p2: 1 } }), { dead: ['p3', 'p4', 'p5'] });
  const p = points(s0, [shoot('p1', 'p2')]);
  assert.equal(p.p1.win, 15);
  assert.equal(p.p1.total, 1 + 2 + 15);
  assert.equal(p.p2.win, 0);
});

test('scoring example from the document: 8-shot round, live on another (+1), blank on self (+2), survived (+8) = 11', () => {
  const s0 = setup({ n: 4, chambers: 'LBLBLBLB' });
  const { state, events } = playLog(
    s0,
    shoot('p1', 'p2'), // 1: p1 live on another
    shoot('p2', 'p2'), // 2: blank on self, p2 continues
    shoot('p2', 'p3'), // 3
    shoot('p3', 'p3'), // 4
    shoot('p3', 'p4'), // 5
    shoot('p4', 'p4'), // 6
    shoot('p4', 'p2'), // 7
    shoot('p1', 'p1'), // 8: p1 blank on self, the round ends here
  );
  assert.equal(state.round.index, 2);
  assert.equal(one(pubs(events, 'roundEnded')).shots, 8);
  const p1 = scoreMatch(events).players.p1;
  assert.deepEqual(p1, { total: 11, shots: 3, eliminations: 0, rounds: 8, win: 0, predictions: 0 });
});

// --- Calculation rules ---------------------------------------------------------------

test('scoring rule: counted per shot, not per damage - a doubled shot is one point', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['double'] } });
  assert.equal(points(s0, [use('p1', 'double'), shoot('p1', 'p2')]).p1.total, 1);
});

test('scoring rule: a shot hurting two linked players is one point for both together', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB' }), { links: [['p2', 'p3']] });
  assert.equal(points(s0, [shoot('p1', 'p2')]).p1.total, 1);
  const doubled = prepared(setup({ n: 4, chambers: 'LBBB', hands: { p1: ['double'] } }), { links: [['p2', 'p3']] });
  assert.equal(points(doubled, [use('p1', 'double'), shoot('p1', 'p2')]).p1.total, 1);
});

test('scoring rule: who was hurt in the end decides - a shot bounced back by a shot shield is a live on self', () => {
  const s0 = prepared(setup({ chambers: 'LBB' }), { shields: { p2: true } });
  const p = points(s0, [shoot('p1', 'p2')]);
  assert.equal(p.p1.total, -1);
  assert.equal(p.p2.total, 0, 'the shield owner gets no shot points');
  // Even when the shooter's own shield then absorbs it: still that kind of shot.
  const both = prepared(setup({ chambers: 'LBB' }), { shields: { p1: true, p2: true } });
  assert.equal(points(both, [shoot('p1', 'p2')]).p1.total, -1);
});

test('scoring rule: a live self shot absorbed by your own shield still counts as a live on self', () => {
  const s0 = prepared(setup({ chambers: 'LBB' }), { shields: { p1: true } });
  assert.equal(points(s0, [shoot('p1', 'p1')]).p1.total, -1);
});

test('scoring rule: hitting the aimed target counts as a live on another even if a linked shield bounces part of it back', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB' }), { shields: { p3: true }, links: [['p2', 'p3']] });
  assert.equal(points(s0, [shoot('p1', 'p2')]).p1.total, 1);
});

test('scoring rule: a self shot that also hurts a linked partner is still a shot on self', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB' }), { links: [['p1', 'p3']] });
  assert.equal(points(s0, [shoot('p1', 'p1')]).p1.total, -1);
});

test('scoring rule: a flipped chamber is scored by its effect', () => {
  const live = setup({ chambers: 'LBB', hands: { p1: ['flip'] } });
  assert.equal(points(live, [use('p1', 'flip'), shoot('p1', 'p1')]).p1.total, 2, 'acts as a blank on self');
  const blank = setup({ chambers: 'BLL', hands: { p1: ['flip'] } });
  assert.equal(points(blank, [use('p1', 'flip'), shoot('p1', 'p2')]).p1.total, 1, 'acts as a live on another');
});

test('scoring rule: elimination points for every eliminated player, even two with one shot', () => {
  const s0 = prepared(setup({ n: 5, chambers: 'LBBBB', hp: { p2: 1, p3: 1 } }), { links: [['p2', 'p3']] });
  const p = points(s0, [shoot('p1', 'p2')]);
  assert.deepEqual(p.p1, { total: 5, shots: 1, eliminations: 4, rounds: 0, win: 0, predictions: 0 });
});

test('scoring rule: a kill by a bounced shot is credited to the shield owner', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 } }), { shields: { p2: true } });
  const p = points(s0, [shoot('p1', 'p2')]);
  assert.equal(p.p2.eliminations, 2);
  assert.equal(p.p1.total, -1);
});

test('scoring rule: nobody gets elimination points for eliminating themself', () => {
  const p = points(setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 } }), [shoot('p1', 'p1')]);
  assert.equal(p.p1.eliminations, 0);
  assert.equal(p.p1.total, -1);
  for (const id of ['p2', 'p3', 'p4']) assert.equal(p[id].total, 0);
});

test('scoring rule: the win bonus depends on the starting players, not on the shots of the last round', () => {
  // The last round here has a single shot; the bonus is still 3 x 6 = 18,
  // and the unfinished last round gives no round points.
  const s0 = prepared(setup({ n: 6, chambers: 'LBBBBBBB', hp: { p2: 1 } }), { dead: ['p3', 'p4', 'p5', 'p6'] });
  const { events } = playLog(s0, shoot('p1', 'p2'));
  const score = scoreMatch(events);
  assert.equal(score.players.p1.win, 18);
  assert.equal(score.players.p1.rounds, 0);
  assert.equal(pubs(events, 'roundEnded').length, 0);
  assert.equal(score.result, 'win');
  assert.equal(score.winner, 'p1');
  assert.equal(score.complete, true);
});

test('scoring rule: winning is never cheaper than finishing an early round', () => {
  // A first round has at most 2 x players chambers; the win bonus is 3 x players.
  for (let n = 3; n <= 15; n++) assert.ok(DEFAULT_SCORING.winPerStartingPlayer * n > 2 * n * DEFAULT_SCORING.roundSurvivalPerShot);
});

test('scoring rule: in a draw nobody gets the win bonus; shot and elimination points stay', () => {
  const s0 = prepared(setup({ n: 3, chambers: 'LBB', hp: { p1: 1, p2: 1 } }), { dead: ['p3'], links: [['p1', 'p2']] });
  const { events } = playLog(s0, shoot('p1', 'p1'));
  const score = scoreMatch(events);
  assert.equal(score.result, 'draw');
  assert.equal(score.winner, null);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(score.players[id].win, 0);
  // p1: live on self (-1) + eliminating p2 (+2). p2 did nothing and gets nothing.
  assert.deepEqual(score.players.p1, { total: 1, shots: -1, eliminations: 2, rounds: 0, win: 0, predictions: 0 });
  assert.equal(score.players.p2.total, 0);
});

// --- The living and the ghosts -------------------------------------------------------

test('scoring: in classic only the living score - there are no ghost predictions', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBLB' }), { dead: ['p4'] });
  const { events } = playLog(s0, shoot('p1', 'p2'), shoot('p2', 'p3'), shoot('p3', 'p1'), shoot('p1', 'p2'));
  const p = scoreMatch(events).players;
  assert.equal(pubs(events, 'predictionResolved').length, 0);
  assert.deepEqual(p.p4, { total: 0, shots: 0, eliminations: 0, rounds: 0, win: 0, predictions: 0 });
});

test('scoring: in custom a ghost gets +1 for a correct prediction, -1 for a wrong one, 0 for none', () => {
  const s0 = prepared(setup({ mode: 'custom', n: 5, chambers: 'LBLBB' }), { dead: ['p4', 'p5'] });
  const { events } = playLog(
    s0,
    predict('p4', 'live'),
    predict('p5', 'blank'),
    shoot('p1', 'p2'), // live: p4 right, p5 wrong
    predict('p4', 'live'),
    shoot('p2', 'p3'), // blank: p4 wrong, p5 abstained
    shoot('p3', 'p1'), // live: nobody predicted
  );
  const p = scoreMatch(events).players;
  assert.equal(p.p4.predictions, 0);
  assert.equal(p.p4.total, 0);
  assert.equal(p.p5.predictions, -1);
});

test('scoring: a ghost has no floor or ceiling, and at best earns in a round what the living earn for finishing it', () => {
  const s0 = prepared(setup({ mode: 'custom', n: 4, chambers: 'BBB' }), { dead: ['p4'] });
  const right = playLog(
    s0,
    predict('p4', 'blank'),
    shoot('p1', 'p2'),
    predict('p4', 'blank'),
    shoot('p2', 'p3'),
    predict('p4', 'blank'),
    shoot('p3', 'p1'),
  );
  const good = scoreMatch(right.events).players;
  assert.equal(good.p4.total, 3, 'every prediction of the round correct: the number of its shots');
  assert.equal(good.p1.rounds, 3, 'what a living player gets from finishing the round alone');
  const wrong = playLog(
    s0,
    predict('p4', 'live'),
    shoot('p1', 'p2'),
    predict('p4', 'live'),
    shoot('p2', 'p3'),
    predict('p4', 'live'),
    shoot('p3', 'p1'),
  );
  assert.equal(scoreMatch(wrong.events).players.p4.total, -3);
});

// --- Config, logs, sessions ------------------------------------------------------------

test('scoring: the numbers are config values', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 } });
  const { events } = playLog(s0, shoot('p1', 'p2'));
  const p = scoreMatch(events, { liveOnOther: 5, elimination: 10 }).players;
  assert.equal(p.p1.total, 15);
  assert.equal(validateScoring({ liveOnOther: 'x' }).ok, false);
  assert.equal(validateScoring({ unknown: 1 }).ok, false);
  assert.equal(validateScoring({ scoreAutoShots: 1 }).ok, false);
  assert.throws(() => scoreMatch(events, { unknown: 1 }));
});

test('scoring: timeout shots are scored like self shots by default, and can be excluded', () => {
  const s0 = setup({ chambers: 'BLB' });
  const { events } = playLog(s0, { type: 'timeout' }, { type: 'timeout' });
  // Blank on self (+2) keeps the turn, then a live on self (-1): both p1's.
  const scored = scoreMatch(events).players;
  assert.equal(scored.p1.total, 1);
  assert.equal(scored.p2.total, 0);
  const excluded = scoreMatch(events, { scoreAutoShots: false }).players;
  assert.equal(excluded.p1.total, 0);
  assert.equal(excluded.p2.total, 0);
});

test('scoring: classifyShot names the table row of a shot event', () => {
  assert.equal(classifyShot({ shooter: 'a', target: 'a', effect: 'blank', reflected: false }), 'blankOnSelf');
  assert.equal(classifyShot({ shooter: 'a', target: 'b', effect: 'blank', reflected: false }), 'blankOnOther');
  assert.equal(classifyShot({ shooter: 'a', target: 'a', effect: 'live', reflected: false }), 'liveOnSelf');
  assert.equal(classifyShot({ shooter: 'a', target: 'b', effect: 'live', reflected: false }), 'liveOnOther');
  assert.equal(classifyShot({ shooter: 'a', target: 'b', effect: 'live', reflected: true }), 'liveOnSelf');
});

test('scoring: uses public events only - any player\'s log gives the same result as the full log', () => {
  const s0 = prepared(setup({ mode: 'custom', n: 4, chambers: 'LBLB', hp: { p2: 1 }, hands: { p1: ['flip', 'detector'] } }), {
    dead: ['p4'],
  });
  const { events } = playLog(
    s0,
    predict('p4', 'blank'),
    use('p1', 'detector'),
    use('p1', 'flip'),
    shoot('p1', 'p1'),
    shoot('p1', 'p2'),
    shoot('p2', 'p3'),
  );
  const full = scoreMatch(events);
  for (const viewer of ['p1', 'p2', 'p4', null]) assert.deepEqual(scoreMatch(eventsFor(events, viewer)), full);
});

test('scoring: is pure and does not touch the log', () => {
  const s0 = setup({ chambers: 'LBB' });
  const { events } = playLog(s0, shoot('p1', 'p2'));
  deepFreeze(events);
  assert.deepEqual(scoreMatch(events), scoreMatch(events));
});

test('session: points accumulate from match to match and rank the players', () => {
  const s0 = prepared(setup({ n: 3, chambers: 'LBB', hp: { p2: 1 } }), { dead: ['p3'] });
  const { events } = playLog(s0, shoot('p1', 'p2'));
  const match = scoreMatch(events); // p1: 1 + 2 + 9 = 12
  const empty = deepFreeze(createSession());
  const one_ = deepFreeze(addMatchToSession(empty, match));
  const two = addMatchToSession(one_, match);
  assert.deepEqual(empty, { matches: 0, totals: {} });
  assert.deepEqual(one_, { matches: 1, totals: { p1: 12, p2: 0, p3: 0 } });
  assert.deepEqual(two, { matches: 2, totals: { p1: 24, p2: 0, p3: 0 } });
  assert.deepEqual(sessionRanking(two), [
    { id: 'p1', points: 24 },
    { id: 'p2', points: 0 },
    { id: 'p3', points: 0 },
  ]);
});
