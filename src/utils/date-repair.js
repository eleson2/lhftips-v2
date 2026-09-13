/**
 * Repairing typo'd guess dates.
 *
 * Posters mistype the date constantly, and almost always in one field only:
 *
 *   "023-10-14"  posted 2023-10-14   a digit dropped
 *   "1023-10-21" posted 2023-10-20   1 typed for 2
 *   "2923-12-26" posted 2023-12-26   9 typed for 0
 *   "2023-01-04" posted 2024-01-04   last year's year, written in January
 *   "2024-04-12" posted 2024-03-12   month 04 typed for 03
 *
 * All of them have the same ground truth: rule 2.3 requires a guess to be posted
 * on the day of the match or a few days before it, so the POST TIMESTAMP says
 * what the date must have been. The repair proposes the handful of single-field
 * corrections that the post time allows, and a candidate is only accepted if a
 * real scheduled fixture between those two teams exists on it.
 *
 * That fixture check is what makes this safe to do automatically: the repair can
 * never invent a date, only pick one the schedule already contains. Anything
 * ambiguous or unconfirmed is left alone and flagged for a human instead.
 */

/** Days after the post that a match may legitimately fall. */
const MAX_DAYS_AHEAD = 21;
/** How far before the post a match may fall — a guess posted on match day. */
const MAX_DAYS_BEHIND = 1;

function toParts(dateStr) {
  const m = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

function fmt({ year, month, day }) {
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month, 2)}-${p(day, 2)}`;
}

/** A real calendar date? (rejects 2026-02-30 and friends) */
function isRealDate({ year, month, day }) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function daysBetween(dateStr, postTimestamp) {
  const d = Date.parse(dateStr + 'T00:00:00Z');
  const t = Date.parse(String(postTimestamp).length <= 10
    ? postTimestamp + 'T00:00:00Z'
    : postTimestamp + 'Z');
  if (Number.isNaN(d) || Number.isNaN(t)) return null;
  // Compare whole days, ignoring the time of day the post was made.
  const tDay = Math.floor(t / 86400000) * 86400000;
  return Math.round((d - tDay) / 86400000);
}

/**
 * Is this date already consistent with when it was posted? If so there is
 * nothing to repair, whatever it looks like.
 */
export function plausibleForPost(dateStr, postTimestamp) {
  const offset = daysBetween(dateStr, postTimestamp);
  if (offset === null) return true; // no timestamp to judge against — leave it alone
  return offset >= -MAX_DAYS_BEHIND && offset <= MAX_DAYS_AHEAD;
}

/**
 * Single-field corrections the post timestamp makes possible, most likely first.
 * Deliberately conservative: only the year or the month is touched, never the
 * day, and never both at once except as a last resort.
 *
 * @param {string} dateStr - the date as written
 * @param {string} postTimestamp - when the post was made
 * @returns {string[]} candidate dates, deduped, excluding the original
 */
export function repairCandidates(dateStr, postTimestamp) {
  const parts = toParts(dateStr);
  const post = toParts(String(postTimestamp || '').slice(0, 10));
  if (!parts || !post) return [];

  const out = [];
  const push = (p) => {
    if (!isRealDate(p)) return;
    const s = fmt(p);
    if (s !== dateStr && !out.includes(s)) out.push(s);
  };

  // The year is wrong (by far the most common): take it from the post. The
  // +1 case covers a match in January guessed from a post made in December.
  push({ ...parts, year: post.year });
  push({ ...parts, year: post.year + 1 });

  // The month is wrong: take it from the post, and from the month after it
  // (a post late in one month for a game early in the next).
  push({ ...parts, month: post.month });
  push({ ...parts, month: post.month === 12 ? 1 : post.month + 1, year: post.month === 12 ? post.year + 1 : parts.year });

  // Last resort: both year and month from the post.
  push({ ...parts, year: post.year, month: post.month });

  return out;
}

/**
 * Try to repair a date that matched no fixture.
 *
 * @param {{date:string, timestamp:string, homeTeam:string, awayTeam:string}} guess
 * @param {(date:string, home:string, away:string) => Promise<object|undefined>} lookupFixture
 * @returns {Promise<{repaired:boolean, date:string|null, match:object|null, ambiguous:boolean, tried:string[]}>}
 */
export async function repairGuessDate(guess, lookupFixture) {
  const { date, timestamp, homeTeam, awayTeam } = guess;
  const none = { repaired: false, date: null, match: null, ambiguous: false, tried: [] };
  if (!date || !timestamp) return none;

  const candidates = repairCandidates(date, timestamp);
  if (candidates.length === 0) return none;

  const hits = [];
  for (const candidate of candidates) {
    // A repair must still obey rule 2.3 — a match cannot precede its guess.
    if (!plausibleForPost(candidate, timestamp)) continue;
    const match = await lookupFixture(candidate, homeTeam, awayTeam);
    if (match && !hits.some(h => h.date === candidate)) hits.push({ date: candidate, match });
  }

  if (hits.length === 0) return { ...none, tried: candidates };
  // More than one scheduled fixture fits — don't guess, let a human look.
  if (hits.length > 1) {
    return { repaired: false, date: null, match: null, ambiguous: true, tried: candidates };
  }

  return { repaired: true, date: hits[0].date, match: hits[0].match, ambiguous: false, tried: candidates };
}
