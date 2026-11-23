// rooms/$code itself, and the order of its children.
//
// There is no .read at this level (a read grant would cascade to secrets/ and claims/). The only
// .write here deletes the whole room: the last seated player between matches, or the current host
// at any time (decision Q67; the UI alone limits it during a match to rooms where every other seat
// is absent, rules cannot iterate presence). Both require the room to be gone after the write, so
// they never grant anything else below it.
//
// .validate: nothing can exist under rooms/$code without meta. Once a room is deleted, a late
// write (another device's onDisconnect presence write, a claim, a members entry, a match clock
// write) cannot recreate a partial room; creation writes meta in the same update, so it still
// works. Validation is not run for a deletion (newData null), so deleting the room is unaffected.

import { CODE_OK, IS_HOST, REFUSE, SEAT_IDS, SIGNED_IN, all, anyOf, either, isMember, memberEntry } from './helpers.js';
import { claimsRules } from './claims.js';
import { matchRules } from './match.js';
import { membersRules } from './members.js';
import { metaRules } from './meta.js';
import { namesRules } from './names.js';
import { presenceRules } from './presence.js';
import { resultsRules } from './results.js';
import { seatsRules } from './seats.js';
import { secretsRules } from './secrets.js';
import { seatOrderRules } from './seat-order.js';
import { settingsRules } from './settings.js';

// No seat other than the writer's own exists. Rules cannot count children, so each of the 15
// fixed seat ids is checked: it is the writer's seat, or it does not exist.
const ONLY_SEAT_LEFT = all(
  ...SEAT_IDS.map((seatId) => either(`${memberEntry('data')}.val() === '${seatId}'`, `!data.child('seats/${seatId}').exists()`)),
);

const DELETE_ROOM = all(
  SIGNED_IN,
  CODE_OK,
  '!newData.exists()',
  "data.child('meta/status').val() === 'lobby'",
  isMember('data'),
  ONLY_SEAT_LEFT,
);

// The current host (a valid member on meta.hostSeat, judged before the write) deletes the room.
const HOST_DELETES_ROOM = all(SIGNED_IN, CODE_OK, '!newData.exists()', IS_HOST);

export function roomRules() {
  return {
    '.write': anyOf(DELETE_ROOM, HOST_DELETES_ROOM),
    '.validate': "newData.child('meta').exists()",
    meta: metaRules(),
    settings: settingsRules(),
    seats: seatsRules(),
    members: membersRules(),
    secrets: secretsRules(),
    claims: claimsRules(),
    presence: presenceRules(),
    names: namesRules(),
    match: matchRules(),
    results: resultsRules(),
    seatOrder: seatOrderRules(),
    $other: REFUSE,
  };
}
