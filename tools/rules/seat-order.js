// rooms/$code/seatOrder: the host's manual seating order for the next matches.
//
//   { seats: [seatId, ...], savedAt: <server time> }
//
// Absent node = random order (the engine shuffles). Readable by members. Written (set, replaced
// or deleted) only by the CURRENT host (the valid member on meta.hostSeat, judged before the
// write), and only while no match runs (status "lobby" before AND after the write). At most 15
// entries (indexes 0..14), each a seat id, no seat twice. Ids of seats that are no longer taken
// are allowed (they are skipped when a match starts); savedAt lets the client put players who
// sat down after the order was saved at the end, even on a reused seat id.

import { CODE_OK, IN_LOBBY, IS_HOST, REFUSE, ROOM_BEFORE, SEAT_ID_PATTERN, SIGNED_IN, all, either, isMember } from './helpers.js';

const MAX_ENTRIES = 15;
const INDEXES = Array.from({ length: MAX_ENTRIES }, (_, i) => String(i));

// No other index holds the same seat id. Rules cannot loop, so each of the 15 possible indexes
// is compared: it is this entry's own index, or its value differs.
const NO_DUPLICATE = all(
  ...INDEXES.map((i) => either(`$index === '${i}'`, `newData.parent().child('${i}').val() !== newData.val()`)),
);

export function seatOrderRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    '.write': all(
      SIGNED_IN,
      CODE_OK,
      IS_HOST,
      IN_LOBBY,
      // Not in the same write that starts a match (the order is read when it starts).
      "newData.parent().child('meta/status').val() === 'lobby'",
    ),
    '.validate': "newData.hasChildren(['seats', 'savedAt'])",
    seats: {
      '.validate': 'newData.hasChildren()',
      $index: {
        '.validate': all(
          '$index.matches(/^([0-9]|1[0-4])$/)',
          'newData.isString()',
          `newData.val().matches(${SEAT_ID_PATTERN})`,
          NO_DUPLICATE,
        ),
      },
    },
    savedAt: { '.validate': 'newData.val() === now' },
    $other: REFUSE,
  };
}
