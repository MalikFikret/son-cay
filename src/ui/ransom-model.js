// Pure helpers of the Hapis ransom on the match table (Fidye; task 4.3c, decision 64). No DOM,
// no database.
//
// The engine already has the rules (src/engine/jail.js): a jailed player may offer one tool to
// one living player; if that player accepts, the tool moves and the jailed player is released.
// One standing offer at a time (a new one replaces it), no timer, never blocking.
//
// Security: everything here reads only this device's own view (view.self.ransomOffer, mine;
// view.self.incomingRansomOffers, offers made to me) and my own private events. Third players see
// only the public jailReleased. Nothing is written anywhere shared but the ransom actions
// themselves. NOTE: "Kabul et" is never enabled or disabled from the legal actions: the engine
// lists ransomAccept only while the offerer still holds the tool, which would tell the recipient
// something about the offerer's hand. The engine refuses an unfunded accept (OFFER_NOT_FUNDED).

import { t } from './i18n/i18n.js';
import { isTool, toolName } from './tools.js';

const holdsHand = (view) => Boolean(view && view.status === 'active' && view.role === 'alive' && view.self);
const isJailed = (view) => holdsHand(view) && view.players.some((p) => p.id === view.viewer && p.jailed);

/**
 * The jailed player's Fidye row near the hand, or null (decision 64): shown only while I am jailed
 * and hold at least one tool, or while my offer is still standing.
 * @returns {{ canOffer: boolean, pending: { to: string, tool: string } | null } | null}
 */
export function ransomRow(view) {
  if (!isJailed(view)) return null;
  const offer = view.self.ransomOffer;
  const pending = offer && offer.kind === 'tool' && isTool(offer.tool) ? { to: offer.to, tool: offer.tool } : null;
  const canOffer = Array.isArray(view.self.hand) && view.self.hand.some(isTool);
  if (!canOffer && !pending) return null;
  return { canOffer, pending };
}

/** The pending offer as one line: "Fidye teklifin: Kerem · Pansuman". */
export function pendingText(pending, nameOf) {
  return pending ? t('ransom.ransomPending', nameOf(pending.to), toolName(pending.tool)) : '';
}

/**
 * What the Fidye sheet offers: the living players I may offer to and my tools (each tool once),
 * both from my own legal actions (tool offers only: coins are Custom, no UI yet).
 * @returns {{ players: string[], tools: string[] }}
 */
export function ransomChoices(legalActions) {
  const players = [];
  const tools = [];
  for (const a of Array.isArray(legalActions) ? legalActions : []) {
    if (a?.type !== 'ransomOffer' || a.offer?.kind !== 'tool') continue;
    if (typeof a.to === 'string' && !players.includes(a.to)) players.push(a.to);
    if (isTool(a.offer.tool) && !tools.includes(a.offer.tool)) tools.push(a.offer.tool);
  }
  return { players, tools };
}

/** The ransomOffer to send, or null until both a player and a tool are chosen. */
export function offerAction({ to = null, tool = null }, choices) {
  if (!choices || !choices.players.includes(to) || !choices.tools.includes(tool)) return null;
  return { type: 'ransomOffer', to, offer: { kind: 'tool', tool } };
}

/**
 * The recipient's cards (decision 64): one per incoming tool offer, from my own view only.
 * @returns {Array<{ from: string, tool: string, name: string }>}
 */
export function incomingCards(view) {
  if (!holdsHand(view) || !Array.isArray(view.self.incomingRansomOffers)) return [];
  return view.self.incomingRansomOffers
    .filter((o) => o && o.kind === 'tool' && typeof o.from === 'string' && isTool(o.tool))
    .map((o) => ({ from: o.from, tool: o.tool, name: toolName(o.tool) }));
}

/** The actions of a card's two buttons. */
export const acceptAction = (card) => ({ type: 'ransomAccept', from: card.from });
export const rejectAction = (card) => ({ type: 'ransomReject', from: card.from });
export const withdrawAction = () => ({ type: 'ransomWithdraw' });

/**
 * The short lines for the two players involved when an offer closes, from MY private events of
 * one update (oldest first): accepted, rejected, withdrawn, lapsed. A replaced offer says
 * "withdrawn" to its old recipient only (the offerer replaced it themself; a new offer to the
 * same recipient says nothing, the new card shows).
 * @param {object[]} events the events of one update as this device received them
 * @param {string | null} me my seat
 * @returns {string[]}
 */
export function ransomNotices(events, me) {
  if (!me) return [];
  const mine = (events ?? []).filter((e) => e && e.visibility === 'private' && Array.isArray(e.to) && e.to.includes(me));
  const out = [];
  mine.forEach((e, i) => {
    if (e.type === 'ransomPaid') {
      out.push(e.from === me ? t('ransom.ransomAcceptedMine') : t('ransom.ransomAcceptedOther'));
    } else if (e.type === 'ransomClosed') {
      if (e.reason === 'rejected') out.push(t('ransom.ransomRejected'));
      else if (e.reason === 'withdrawn') out.push(t('ransom.ransomWithdrawn'));
      else if (e.reason === 'replaced') {
        const renewed = mine.slice(i + 1).some((n) => n.type === 'ransomOffered' && n.from === e.from && n.recipient === e.recipient);
        if (e.recipient === me && !renewed) out.push(t('ransom.ransomWithdrawn'));
      } else out.push(t('ransom.ransomLapsed')); // jailEnded, eliminated, removed
    }
  });
  return out.filter((text, i) => out.indexOf(text) === i);
}

/** A refused ransom action as one short line (never a raw code). */
export function ransomErrorText(error) {
  if (error?.code === 'OFFER_NOT_FUNDED') return t('ransom.ransomNotFunded');
  if (error?.code === 'NO_OFFER' || error?.code === 'NOT_JAILED') return t('ransom.ransomGone');
  return t('ransom.ransomRefused');
}
