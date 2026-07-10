import { extractGuessesFromPost, parseDate, parseTeams, toScore } from './guess-parser.js';

/**
 * Best-effort diagnosis of a forum post that (at scrape time) failed to parse.
 * Used by the review UI to show WHY it failed and to prefill the fix input.
 *
 * If the text parses cleanly with the current parser (which may have improved
 * since the CSV was written), returns complete:true with a canonical
 * reconstruction — a one-click accept in the UI.
 *
 * Otherwise scans for the individual pieces (date, teams, score, scorer) and
 * assembles a suggestion with placeholders for whatever is missing.
 *
 * @param {string} text - The raw post content
 * @param {number} defaultYear - Default year for date parsing
 * @returns {{ complete: boolean, found: object, suggestion: string }}
 */
export function diagnoseGuess(text, defaultYear = new Date().getFullYear()) {
  const guesses = extractGuessesFromPost(text, defaultYear);
  if (guesses.length > 0) {
    return {
      complete: true,
      found: { date: true, teams: true, score: true, scorer: guesses.every(g => g.scorer) },
      suggestion: guesses
        .map(g => `${g.date}, ${g.homeTeam} - ${g.awayTeam}, ${g.homeScore}-${g.awayScore}${g.scorer ? ', ' + g.scorer : ''}`)
        .join('\n')
    };
  }

  // Rules/announcement posts (posted once at the start of every season)
  // always include a quoted "Exempelvis '2026-09-19, ...'" sample guess in
  // the instructions. Scan only the text before that marker so the sample
  // is never mistaken for a real guess.
  const exampleIdx = text.search(/exempel/i);
  const scanText = exampleIdx === -1 ? text : text.slice(0, exampleIdx);

  // Date: tolerate stray spaces / doubled dashes ("2023 -09-28", "2023--09-21")
  let date = null;
  let afterDate = scanText;
  const dm = scanText.match(/\d{4}\s*-{1,2}\s*\d{1,2}\s*-{1,2}\s*\d{1,2}/);
  if (dm) {
    date = parseDate(dm[0].replace(/\s+/g, '').replace(/-{2,}/g, '-'), defaultYear);
    if (date) afterDate = scanText.slice(dm.index + dm[0].length);
  }
  if (!date) {
    const dm2 = scanText.match(/\b\d{1,2}[/.]\d{1,2}\b/);
    if (dm2) {
      date = parseDate(dm2[0], defaultYear);
      if (date) afterDate = scanText.slice(dm2.index + dm2[0].length);
    }
  }

  // Score/teams: search only a short window right after the anchor (the
  // date if found, else the start of the post). Real guesses are one-liners,
  // so a nearby " - " is trustworthy; a stray " - " found deep inside long
  // prose (rules text, standings dumps) is not — bounding the window keeps
  // the short-post case working while ignoring those false matches.
  const SEARCH_WINDOW = 150;
  const searchArea = afterDate.slice(0, SEARCH_WINDOW);

  let score = null;
  let scorer = null;
  let teamSegment = searchArea;
  const sm = searchArea.match(/(\d{1,2})\s*[-:–]\s*(\d{1,2})/);
  if (sm) {
    score = toScore(sm[1], sm[2]);
    teamSegment = searchArea.slice(0, sm.index);
    scorer = afterDate.slice(sm.index + sm[0].length).replace(/^[\s,;:.]+/, '');
    // Stop at the first sentence/quote boundary rather than a blind char
    // cap, so trailing prose never gets glued onto the scorer name.
    const stop = scorer.search(/["'”)\]\n]|\.\s|!\s/);
    if (stop !== -1) scorer = scorer.slice(0, stop);
    scorer = scorer.trim() || null;
    if (scorer && scorer.length > 60) scorer = scorer.slice(0, 60).trim();
  }

  // Teams: whatever sits between date and score
  teamSegment = teamSegment.replace(/^[\s,;:.]+|[\s,;:.]+$/g, '');
  const teams = teamSegment ? parseTeams(teamSegment) : null;

  const suggestion =
    [
      date ?? 'ÅÅÅÅ-MM-DD',
      teams ? `${teams.home} - ${teams.away}` : (teamSegment || 'Hemmalag - Bortalag'),
      score ? `${score.home}-${score.away}` : 'X-Y'
    ].join(', ') + (scorer ? `, ${scorer}` : '');

  return {
    complete: false,
    found: { date: Boolean(date), teams: Boolean(teams), score: Boolean(score), scorer: Boolean(scorer) },
    suggestion
  };
}
