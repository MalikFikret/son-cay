// rooms/$code/presence/$seatId = { conns: { [connId]: true }, lastSeenAt }: present <=> conns
// has a child. Readable by members; written only by the member sitting on that seat. The
// checks use the data at write time (root), which for onDisconnect writes is the time of the
// disconnect, so a device that lost its seat by recovery can no longer touch it.

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  deletedByKick,
  deletedWithOwnSeat,
  isMember,
  isSeatId,
  sitsOn,
} from './helpers.js';

// The room must exist before the write (meta), so a late onDisconnect write of another device
// can never touch a deleted room.
const OWN_SEAT = all(SIGNED_IN, CODE_OK, `${ROOM_BEFORE}.child('meta').exists()`, isSeatId('$seatId'));

export function presenceRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    $seatId: {
      // Leaving or kicking: the whole entry goes with its seat. Requires the entry to be gone
      // after the write, so this grant never covers anything else below it.
      '.write': all(
        OWN_SEAT,
        anyOf(
          deletedWithOwnSeat('$seatId', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`),
          deletedByKick('$seatId', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`),
        ),
      ),
      conns: {
        '.write': all(OWN_SEAT, sitsOn(ROOM_BEFORE, '$seatId')),
        '.validate': 'newData.hasChildren()',
        $connId: { '.validate': '$connId.matches(/^[A-Za-z0-9_-]{1,64}$/) && newData.val() === true' },
      },
      lastSeenAt: {
        // Never deleted (that would move absent-since back to joinedAt).
        '.write': all(OWN_SEAT, 'newData.exists()', sitsOn(ROOM_BEFORE, '$seatId')),
        '.validate': 'newData.val() === now',
      },
      $other: REFUSE,
    },
  };
}
