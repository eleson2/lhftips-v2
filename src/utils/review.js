import { writeFileSync } from 'fs';

/**
 * Review reason codes. Each flags a guess that the pipeline could not resolve
 * with full confidence and that a human may want to look at. See docs for the
 * per-reason "held from scoring" semantics.
 */
export const REVIEW = {
  UNPARSEABLE: 'UNPARSEABLE',       // a forum post that produced no valid guess
  INCOMPLETE: 'INCOMPLETE',         // parsed row missing required fields
  DATE_NO_FIXTURE: 'DATE_NO_FIXTURE', // no scheduled Luleå game matches date+teams
  TEAM_LOW_CONF: 'TEAM_LOW_CONF',   // teams matched only weakly
  LATE: 'LATE',                     // posted after the match had started
  DUPLICATE: 'DUPLICATE',           // superseded by a later guess for same match
  SCORER_UNMATCHED: 'SCORER_UNMATCHED', // named a scorer that matched no real goalscorer
};

const REASON_HELP = {
  [REVIEW.UNPARSEABLE]: 'Post could not be parsed into a guess — held from scoring. Fix the CSV line (drop the leading #) if it is a real guess.',
  [REVIEW.INCOMPLETE]: 'Parsed but missing required fields — held from scoring. Complete the row and re-import.',
  [REVIEW.DATE_NO_FIXTURE]: 'No scheduled game matches this date + teams — held from scoring. Check the date/teams, or scrape results first.',
  [REVIEW.TEAM_LOW_CONF]: 'Team names matched only weakly — verify they are correct.',
  [REVIEW.LATE]: 'Guess was posted after the match started — held from scoring.',
  [REVIEW.DUPLICATE]: 'A later guess for the same match superseded this one — informational.',
  [REVIEW.SCORER_UNMATCHED]: 'Named a scorer that matched no actual goalscorer — only the scorer point is withheld. If it is a nickname for a real scorer, run: map-player "<Canonical Name>" "<spelling>" then re-run calculate.',
};

/**
 * Accumulates review items and writes a grouped report.
 */
export class ReviewCollector {
  constructor() {
    /** @type {{reason:string, username?:string, date?:string, detail?:string, raw?:string}[]} */
    this.items = [];
  }

  add(reason, info = {}) {
    this.items.push({ reason, ...info });
  }

  get count() {
    return this.items.length;
  }

  countsByReason() {
    const counts = {};
    for (const it of this.items) counts[it.reason] = (counts[it.reason] || 0) + 1;
    return counts;
  }

  /** Print a short summary to the console. */
  printSummary() {
    if (this.items.length === 0) {
      console.log('  Review: nothing flagged.');
      return;
    }
    console.log(`  Review: ${this.items.length} item(s) flagged`);
    for (const [reason, n] of Object.entries(this.countsByReason())) {
      console.log(`    ${reason}: ${n}`);
    }
  }

  /**
   * Write a human-readable grouped report. Every flagged row appears; the ones
   * needing manual effort are grouped under their reason with guidance.
   */
  writeReport(path = 'review-report.txt') {
    const lines = [];
    lines.push('LHFTips review report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total flagged: ${this.items.length}`);
    lines.push('');

    const byReason = new Map();
    for (const it of this.items) {
      if (!byReason.has(it.reason)) byReason.set(it.reason, []);
      byReason.get(it.reason).push(it);
    }

    for (const [reason, items] of byReason) {
      lines.push(`## ${reason} (${items.length})`);
      if (REASON_HELP[reason]) lines.push(`   ${REASON_HELP[reason]}`);
      lines.push('');
      for (const it of items) {
        const who = it.username ? `${it.username}` : '(unknown)';
        const when = it.date ? ` ${it.date}` : '';
        const detail = it.detail ? ` — ${it.detail}` : '';
        lines.push(`   - ${who}${when}${detail}`);
        if (it.raw) lines.push(`       raw: ${String(it.raw).replace(/\s+/g, ' ').trim().slice(0, 160)}`);
      }
      lines.push('');
    }

    writeFileSync(path, lines.join('\n') + '\n');
    return path;
  }
}

export default ReviewCollector;
