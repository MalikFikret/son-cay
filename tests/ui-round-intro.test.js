// Game UI: the round intro screen, "Tur girişi" (step 4.4d-b, decision Q79; approved mock:
// conversation 23, model 1): the kicker by round, the counts, the bullet dots in two groups, the
// first turn ("sen" on that player's own device), the bar from the shared pause end, both
// languages, and the screen code (texts through textContent, no red, the placeholder gone).

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatch, viewFor, ROUND_INTRO_MS } from '../src/engine/index.js';
import { pauseWindow } from '../src/rooms/index.js';
import { introFraction, introModel } from '../src/ui/intro-model.js';
import { DEFAULT_LANGUAGE, setLanguage } from '../src/ui/i18n/i18n.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const names = { s01: 'Zeynep', s02: 'Kerem', s03: 'Ada' };
const nameOf = (id) => names[id] ?? id;

/** A view with the given round and counts and the turn on `turn`. */
function view({ index = 1, live = 3, blank = 2, turn = 's01' } = {}) {
  return {
    round: { index, shots: 0, announced: { total: live + blank, live, blank } },
    turn: { playerId: turn, number: 1, toolsUsed: 0 },
  };
}

afterEach(() => setLanguage(DEFAULT_LANGUAGE));

describe('the round intro model', () => {
  test('the kicker: "Maç başlıyor" for round 1, "Yeni tur" later', () => {
    assert.equal(introModel({ view: view({ index: 1 }), mySeat: 's02', nameOf }).kicker, 'Maç başlıyor');
    assert.equal(introModel({ view: view({ index: 6 }), mySeat: 's02', nameOf }).kicker, 'Yeni tur');
    assert.equal(introModel({ view: view({ index: 6 }), mySeat: 's02', nameOf }).round, '6. tur');
  });

  test('the counts: dots split into Dolu then Boş, the total and the two coloured numbers', () => {
    const m = introModel({ view: view({ live: 2, blank: 4 }), mySeat: null, nameOf });
    assert.equal(m.liveDots, 2);
    assert.equal(m.blankDots, 4);
    assert.equal(m.total, '6 mermi');
    assert.equal(m.live, '2 Dolu');
    assert.equal(m.blank, '4 Boş');
  });

  test('the first turn: the name, or "sen" on that player\'s own device (spectators see the name)', () => {
    assert.equal(introModel({ view: view({ turn: 's01' }), mySeat: 's02', nameOf }).first, 'İlk sıra: Zeynep');
    const mine = introModel({ view: view({ turn: 's02' }), mySeat: 's02', nameOf });
    assert.equal(mine.first, 'İlk sıra: sen');
    assert.equal(mine.mine, true);
    assert.equal(introModel({ view: view({ turn: 's03' }), mySeat: null, nameOf }).first, 'İlk sıra: Ada');
  });

  test('one announcement for screen readers with the round, the counts and the first turn', () => {
    const m = introModel({ view: view({ index: 1, live: 3, blank: 2, turn: 's01' }), mySeat: 's02', nameOf });
    assert.equal(m.announce, 'Maç başlıyor. 1. tur: 5 mermi, 3 Dolu, 2 Boş. İlk sıra: Zeynep');
  });

  test('English: the approved terms and plural', () => {
    setLanguage('en');
    const m = introModel({ view: view({ index: 1, live: 1, blank: 0, turn: 's02' }), mySeat: 's02', nameOf });
    assert.equal(m.kicker, 'Match starting');
    assert.equal(m.round, 'Round 1');
    assert.equal(m.total, '1 bullet');
    assert.equal(m.live, '1 Loaded');
    assert.equal(m.blank, '0 Empty');
    assert.equal(m.first, 'First turn: you');
    const later = introModel({ view: view({ index: 4, live: 2, blank: 3, turn: 's03' }), mySeat: 's02', nameOf });
    assert.equal(later.kicker, 'New round');
    assert.equal(later.total, '5 bullets');
    assert.equal(later.first, 'First turn: Ada');
    assert.equal(later.announce, 'New round. Round 4: 5 bullets, 2 Loaded, 3 Empty. First turn: Ada');
  });

  test('no usable round: nothing to show', () => {
    assert.equal(introModel({ view: null, mySeat: null, nameOf }), null);
    assert.equal(introModel({ view: { round: { index: 1 } }, mySeat: null, nameOf }), null);
  });

  test('from a real match start: the engine\'s announced counts and first player', () => {
    const res = createMatch({ mode: 'classic' }, ['s01', 's02', 's03'].map((id) => ({ id })), 9);
    const v = viewFor(res.state, 's01');
    const m = introModel({ view: v, mySeat: 's01', nameOf });
    assert.equal(m.liveDots, res.state.round.announced.live);
    assert.equal(m.blankDots, res.state.round.announced.blank);
    assert.equal(m.mine, res.state.turn.playerId === 's01');
  });
});

describe('the round intro bar', () => {
  // The match start: the intro is the whole pause, from clockAt.
  const pause = pauseWindow({ seq: 1, kind: 'shot', playerId: 's01', pauseMs: ROUND_INTRO_MS }, 100_000);

  test('fills over the intro from the shared pause end, not a local timer', () => {
    assert.equal(introFraction(pause, 100_000), 0);
    assert.equal(introFraction(pause, 101_000), 0.25);
    assert.equal(introFraction(pause, 103_000), 0.75);
    assert.equal(introFraction(pause, 104_000), 1);
    assert.equal(introFraction(pause, 99_000), 0, 'before the intro');
    assert.equal(introFraction(pause, 200_000), 1, 'after it');
  });

  test('a device that arrives mid-intro starts part-filled; a refill\'s intro starts after the round-end pause', () => {
    const refill = pauseWindow({ seq: 7, kind: 'shot', playerId: 's01', pauseMs: 9000 }, 100_000);
    assert.equal(refill.introAt, 105_000);
    assert.equal(introFraction(refill, 104_000), 0, 'still the round-end pause');
    assert.equal(introFraction(refill, 107_000), 0.5);
  });

  test('Hareketler off: the bar moves in whole seconds', () => {
    assert.equal(introFraction(pause, 101_900, { stepMs: 1000 }), 0.25);
    assert.equal(introFraction(pause, 102_100, { stepMs: 1000 }), 0.5);
    assert.equal(introFraction(null, 1), 0);
  });
});

describe('the round intro screen code', () => {
  const table = read('src/ui/screens/table.js');
  const css = read('src/ui/style.css');

  test('the placeholder and the reload banner are gone', () => {
    for (const gone of ['intro-placeholder', 'introOverlay', 'reloadBanner', 'showReload', 'reloadFor', 'reloadText']) {
      assert.ok(!table.includes(gone), `${gone} in table.js`);
    }
    for (const gone of ['.intro-placeholder', '.reload-banner', 'reload-show']) assert.ok(!css.includes(gone), `${gone} in style.css`);
  });

  test('the Dolu / Boş colours of the mock, never the fire / target red', () => {
    const block = css.slice(css.indexOf('.round-intro {'), css.indexOf('@keyframes round-intro-out'));
    assert.match(block, /#F08A7E/);
    assert.match(block, /#8FDAD3/);
    assert.doesNotMatch(block, /--fire|--target|#D9443A/i);
  });

  test('the entry never fades: fully visible where animations do not run (like the shot notice)', () => {
    const entry = css.slice(css.indexOf('@keyframes round-intro-in'), css.indexOf('@keyframes round-intro-out'));
    assert.doesNotMatch(entry, /opacity/);
  });

  test('Hareketler off: no animation (the motion-off class, never the phone setting)', () => {
    assert.match(css, /\.motion-off \.round-intro,\n\.motion-off \.round-intro\.is-leaving \{ animation: none; \}/);
  });
});
