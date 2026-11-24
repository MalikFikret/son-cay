// rooms/$code/press/$seatId = { n, seq, at }: "this seat's player is holding the fire button"
// (step 4.4b, decisions Q55 as changed by Q74, Q56). Written when the long press cocks the
// hammer, removed on release, cancel or expiry (and by onDisconnect). It says only THAT a press
// is going on, never at whom: the target leaves the device only inside the shot (Q56).
//
//   n:   the match number (match/n) the press belongs to
//   seq: the countdown it belongs to (the engine's clock.seq in the presser's view)
//   at:  server time of the write
//
// The rules cannot read whose turn it is (inside match/stateJson), so every client checks the
// signal itself (seat = the player the countdown waits for, n and seq = the current ones, not
// older than the shot time) and ignores it otherwise.
//
// Readable by members. Written or removed only by the valid member sitting on that seat (judged
// before the write; also for onDisconnect removals, judged at disconnect time). Writes need a
// running match (status "playing" before the write); removals are always allowed for the owner.
// Leaving and kicking remove the entry together with its seat, like presence. Strict shape: n,
// seq, at and nothing else; at === now (no client time).

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  STATUS_BEFORE,
  all,
  anyOf,
  deletedByKick,
  deletedWithOwnSeat,
  either,
  isMember,
  isSeatId,
  sitsOn,
} from './helpers.js';

const WHOLE_NUMBER = (max) => ({ '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= ${max}` });

export function pressRules() {
  const newSeats = `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`;
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    $seatId: {
      '.write': all(
        SIGNED_IN,
        CODE_OK,
        // Never recreate anything in a deleted room (a late onDisconnect removal is harmless).
        `${ROOM_BEFORE}.child('meta').exists()`,
        isSeatId('$seatId'),
        anyOf(
          // The owner: set while a match runs, remove at any time.
          all(sitsOn(ROOM_BEFORE, '$seatId'), either('!newData.exists()', `${STATUS_BEFORE} === 'playing'`)),
          // Leaving or kicking: the entry goes with its seat.
          deletedWithOwnSeat('$seatId', newSeats),
          deletedByKick('$seatId', newSeats),
        ),
      ),
      // Checked on the whole entry, so any change (also of n or seq alone) carries a fresh
      // server time.
      '.validate': "newData.hasChildren(['n', 'seq', 'at']) && newData.child('at').val() === now",
      n: WHOLE_NUMBER(1000000000),
      seq: WHOLE_NUMBER(1000000000),
      at: { '.validate': 'newData.val() === now' },
      $other: REFUSE,
    },
  };
}
