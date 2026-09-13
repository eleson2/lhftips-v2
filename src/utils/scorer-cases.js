import { getMatches, getGuessesByMatch, getGoalscorers } from '../db/queries.js';
import { isLulea } from './team-matcher.js';
import { matchScorer } from './player-matcher.js';
import { findVerdict } from './scorer-verdicts.js';
import { loadSuggestions, getSuggestion } from './scorer-suggestions.js';

/**
 * How a scorer guess currently stands, before any human judgement.
 *
 * AUTO_MATCHED    the matcher resolved it confidently — no attention needed
 * UNMATCHED       matched no actual goalscorer — the scorer point is withheld
 * AMBIGUOUS       matched more than one actual goalscorer equally well
 * LOW_CONFIDENCE  matched, but only on a loose fuzzy score. The point is
 *                 awarded, but the pick may well be the wrong player, so it is
 *                 put in front of a human rather than trusted silently.
 * STALE_VERDICT   a verdict exists but the guess spelling changed under it
 */
export const CASE = {
  AUTO_MATCHED: 'AUTO_MATCHED',
  UNMATCHED: 'UNMATCHED',
  AMBIGUOUS: 'AMBIGUOUS',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  STALE_VERDICT: 'STALE_VERDICT',
};

/**
 * The bar above which a match is trusted without human eyes. Same 0.85 the
 * registry already uses before it will remember a spelling — a match too weak to
 * learn from is a match too weak to apply unseen.
 */
export const CONFIDENT = 0.85;

/** The goalscorers a guess is scored against for a given match. */
export function scorerCandidates(allGoalscorers, match) {
  const luleaTeam = match.lulea_is_home ? match.home_team : match.away_team;
  return allGoalscorers
    .filter(g => isLulea(g.team) || g.team === luleaTeam)
    .map(g => g.player_name);
}

/**
 * Walk played matches and describe every scorer guess: what the matcher made of
 * it, and what the human has already decided about it.
 *
 * This is the single source of truth for "what needs a human look", shared by
 * `calculate` (which applies verdicts) and the review UI (which collects them),
 * so the two can never disagree about the queue.
 *
 * @param {object} verdictStore - from loadVerdicts()
 * @param {{ from?:string|null, to?:string|null, pendingOnly?:boolean }} opts
 * @returns {Promise<Array<object>>}
 */
export async function collectScorerCases(verdictStore, { from = null, to = null, pendingOnly = true } = {}) {
  const matches = await getMatches(from, to);
  const suggestions = loadSuggestions(); // pre-computed by `suggest scorers`, if it has been run
  const cases = [];

  for (const match of matches) {
    if (match.home_score === null) continue; // not played yet

    const candidates = scorerCandidates(await getGoalscorers(match.id), match);
    if (candidates.length === 0) continue;

    for (const guess of await getGuessesByMatch(match.id)) {
      if (!guess.predicted_scorer) continue;

      const sm = matchScorer(guess.predicted_scorer, candidates);
      const found = findVerdict(verdictStore, {
        username: guess.forum_username,
        date: match.match_date,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        guessedScorer: guess.predicted_scorer,
      });

      let status;
      if (found.stale) status = CASE.STALE_VERDICT;
      else if (!sm.matched) status = CASE.UNMATCHED;
      else if (sm.ambiguous) status = CASE.AMBIGUOUS;
      else if (sm.confidence < CONFIDENT) status = CASE.LOW_CONFIDENCE;
      else status = CASE.AUTO_MATCHED;

      // A settled case is one the human has ruled on and nothing has moved under
      // it. Everything else is either auto-clean or waiting for judgement.
      const settled = found.verdict !== null;
      const needsAttention = !settled && status !== CASE.AUTO_MATCHED;

      if (pendingOnly && !needsAttention) continue;

      cases.push({
        key: found.key,
        username: guess.forum_username,
        date: match.match_date,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        matchLabel: `${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}`,
        guessedScorer: guess.predicted_scorer,
        candidates,
        status,
        autoMatch: sm.matched
          ? { player: sm.actualName, method: sm.method, confidence: Number(sm.confidence.toFixed(3)), ambiguous: sm.ambiguous }
          : null,
        suggestion: getSuggestion(suggestions, guess.predicted_scorer, candidates),
        verdict: found.verdict,
        staleVerdict: found.stale ? (verdictStore.verdicts?.[found.key] ?? null) : null,
        rawText: guess.raw_text,
      });
    }
  }

  return cases;
}
