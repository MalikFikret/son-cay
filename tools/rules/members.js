// rooms/$code/members/$uid = seatId: links a device (uid) to its seat.
// Your own entry is always readable (to find your seat); all entries are readable by members.

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  deletedByKick,
  deletedWithOwnSeat,
  either,
  isMember,
  isSeatId,
} from './helpers.js';

// The uid on a seat, before / after the write. `seat` is an expression giving a seat id.
const uidBefore = (seat) => `${ROOM_BEFORE}.child('seats').child(${seat}).child('uid').val()`;
const uidAfter = (seat) => `${NEW_ROOM_FROM_DEPTH_2}.child('seats').child(${seat}).child('uid').val()`;

// Leaving: delete your own entry, and stale entries of old devices that still point to the
// seat you are leaving (deletedWithOwnSeat checks that the entry's seat is yours and goes too).
const LEAVE = all('data.exists()', 'data.isString()', deletedWithOwnSeat('data.val()', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`));

// Kicking: the host deletes every entry (the current device's and stale ones) that points to the
// seat being kicked (deletedByKick checks that the seat goes in the same write).
const KICK = all('data.exists()', 'data.isString()', deletedByKick('data.val()', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`));

// Your own entry is stale when its seat now has another uid (recovered on another device).
const DELETE_OWN_STALE = all('!newData.exists()', 'data.exists()', `${uidBefore('data.val()')} !== auth.uid`);

// Create your entry, or replace your stale one: only to a seat that the same write gives you
// (a newly taken seat, or a recovered one), in a room that has meta after the write (a new room
// writes its meta in the same update; a deleted room has none).
const SET_OWN = all(
  `${NEW_ROOM_FROM_DEPTH_2}.child('meta').exists()`,
  either('!data.exists()', `${uidBefore('data.val()')} !== auth.uid`),
  'newData.isString()',
  isSeatId('newData.val()'),
  `${uidAfter('newData.val()')} === auth.uid`,
  `${uidBefore('newData.val()')} !== auth.uid`,
);

export function membersRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    $uid: {
      '.read': 'auth != null && auth.uid === $uid',
      '.write': all(SIGNED_IN, CODE_OK, anyOf(LEAVE, KICK, all('auth.uid === $uid', anyOf(DELETE_OWN_STALE, SET_OWN)))),
      '.validate': all('newData.isString()', isSeatId('newData.val()')),
    },
  };
}
