// rooms/$code itself, and the order of its children.
//
// There is no .read at this level (a read grant would cascade to secrets/ and claims/). The only
// .write here deletes the whole room: the last seated player, between matches. It requires the
// room to be gone after the write, so it never grants anything else below it.

import { CODE_OK, REFUSE, SEAT_IDS, SIGNED_IN, all, either, isMember, memberEntry } from './helpers.js';
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

export function roomRules() {
  return {
    '.write': DELETE_ROOM,
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
