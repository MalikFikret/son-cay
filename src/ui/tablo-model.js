// Pure helpers of the Tablo panel (no DOM): what each row and each breakdown line says. The data
// comes from the room layer (getLastMatch / summarizeMatch for "Bu maç", the session table of
// watchLobby for "Oturum"); this file only turns it into display values.

import { SHOT_KINDS } from '../rooms/index.js';
import { modeLabel } from './components.js';
import { t } from './i18n/i18n.js';

const MINUS = '−';

/** "+2", "−1" (a real minus sign) or "0". */
export function formatSigned(points) {
  const n = Number.isFinite(points) ? points : 0;
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${-n}`;
  return '0';
}

// Locale keys, read when shown (a text read at import would stay in the first language).
const SHOT_LABELS = Object.freeze({
  liveOnOther: 'tablo.lineLiveOnOther',
  blankOnOther: 'tablo.lineBlankOnOther',
  blankOnSelf: 'tablo.lineBlankOnSelf',
  liveOnSelf: 'tablo.lineLiveOnSelf',
});

/** The status line under a name: "Kazandı", "N. turda çıktı", ... */
export function statusText(row, result) {
  if (row.status === 'won') return t('tablo.won');
  if (row.status === 'eliminated') return t('tablo.outInRound', row.outRound);
  if (row.status === 'removed') return t('tablo.removedInRound', row.outRound);
  return result === 'draw' ? t('tablo.draw') : '';
}

/**
 * The lines of a row's points breakdown, in the order of the design:
 * [{ label, count, points }], the total last. `count` is "N kez", "—" or "".
 * @param {object} row a summarizeMatch row
 * @param {string} mode 'classic' | 'custom'
 */
export function breakdownLines(row, mode) {
  const b = row.breakdown;
  const times = (count) => (count > 0 ? t('tablo.times', count) : '—');
  const lines = SHOT_KINDS.map((kind) => ({ label: t(SHOT_LABELS[kind]), count: times(b[kind].count), points: formatSigned(b[kind].points) }));
  lines.push({ label: t('tablo.lineEliminations'), count: times(b.eliminations.count), points: formatSigned(b.eliminations.points) });
  lines.push({ label: t('tablo.lineRounds', b.rounds.count), count: '', points: formatSigned(b.rounds.points) });
  lines.push({ label: t('tablo.lineWin'), count: '—', points: b.win.points === 0 ? '—' : formatSigned(b.win.points) });
  if (mode === 'custom' || b.predictions.count > 0) {
    lines.push({ label: t('tablo.linePredictions'), count: times(b.predictions.count), points: formatSigned(b.predictions.points) });
  }
  lines.push({ label: t('tablo.lineTotal'), count: '', points: String(row.points), total: true });
  return lines;
}

/**
 * The "Bu maç" view of a summary: header and rows with rank, name, status and tea glasses.
 * @param {object | null} summary getLastMatch result
 * @param {string} mySeat
 */
export function matchView(summary, mySeat) {
  if (!summary) return null;
  return {
    header: t('tablo.matchHeader', summary.n, summary.rounds, modeLabel(summary.mode)),
    rows: summary.rows.map((row, i) => ({
      ...row,
      rank: i + 1,
      displayName: row.name ?? t('tablo.leftPlayer'),
      me: row.seatId === mySeat && row.name !== null,
      out: row.status === 'eliminated' || row.status === 'removed',
      statusText: statusText(row, summary.result),
      // Tea glasses (life) only for the players still in at the end.
      glasses: row.status === 'won' || row.status === 'alive'
        ? { full: Math.max(0, row.hp), total: Math.max(summary.startHp, row.hp) }
        : null,
      lines: breakdownLines(row, summary.mode),
    })),
  };
}

/**
 * The "Oturum" view of the session table: header and ranked rows with names.
 * @param {{ matches: number, rows: Array<{ seatId, points, matches, wins, last }> }} session
 * @param {Record<string, string>} names seat id -> current name
 * @param {string} mySeat
 */
export function sessionView(session, names, mySeat) {
  return {
    header: session.matches > 0 ? t('tablo.sessionHeader', session.matches) : t('tablo.noSessionYet'),
    rows: session.rows.map((row, i) => ({
      ...row,
      rank: i + 1,
      displayName: names[row.seatId] ?? '',
      me: row.seatId === mySeat,
      lastText: row.last === null ? '' : formatSigned(row.last),
    })),
  };
}

/**
 * The live "Bu maç" view during a match (decision 47), from summarizeView of this device's view
 * and events: header with the tur, the players still in and the mode; living players on top
 * ("oyunda", "bağlantı yok" when absent), then the latest to go out. After the end it is the
 * same as the finished-match view (winner first). Only public information.
 * @param {object} summary summarizeView result
 * @param {{ mySeat: string, names: Record<string, string>, present: (seatId) => boolean,
 *   round: number, ended: boolean }} info
 */
export function liveMatchView(summary, { mySeat, names, present, round, ended }) {
  if (!summary) return null;
  const named = { ...summary, rows: summary.rows.map((row) => ({ ...row, name: names[row.seatId] ?? null })) };
  const view = matchView(named, mySeat);
  if (ended) return view;
  const alive = summary.rows.filter((row) => row.status === 'alive').length;
  return {
    header: t('liveTablo.liveHeader', round, alive, summary.rows.length, modeLabel(summary.mode)),
    footnote: t('liveTablo.liveFootnote'),
    rows: view.rows.map((row) => (row.status === 'alive'
      ? { ...row, statusText: present(row.seatId) ? t('liveTablo.inGame') : t('liveTablo.absentInGame') }
      : row)),
  };
}
