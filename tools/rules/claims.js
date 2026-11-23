// rooms/$code/claims/$seatId = { uid, pin, at }: the latest seat-recovery attempt (write 1 of
// recoverSeat). No .read: nobody can read a claim. Rules cannot count failed attempts, so the
// claims are throttled to one per seat every 2 seconds of server time.

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  PIN_PATTERN,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  deletedByKick,
  deletedWithOwnSeat,
  either,
  isNotMember,
  isSeatId,
} from './helpers.js';

// A non-member claims an occupied seat for themselves, at most once per seat every 2 s.
const CLAIM = all(
  `${ROOM_BEFORE}.child('meta').exists()`,
  `${ROOM_BEFORE}.child('seats').child($seatId).exists()`,
  "newData.child('uid').val() === auth.uid",
  isNotMember(ROOM_BEFORE),
  either('!data.exists()', "now >= data.child('at').val() + 2000"),
);

export function claimsRules() {
  return {
    $seatId: {
      '.write': all(
        SIGNED_IN,
        CODE_OK,
        isSeatId('$seatId'),
        anyOf(
          CLAIM,
          deletedWithOwnSeat('$seatId', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`),
          deletedByKick('$seatId', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`),
        ),
      ),
      '.validate': "newData.hasChildren(['uid', 'pin', 'at'])",
      uid: { '.validate': 'newData.isString()' },
      pin: { '.validate': `newData.isString() && newData.val().matches(${PIN_PATTERN})` },
      at: { '.validate': 'newData.val() === now' },
      $other: REFUSE,
    },
  };
}
