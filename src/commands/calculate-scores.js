import {
  getMatches,
  getGuessesByMatch,
  getGoalscorers,
  getScoredGuessIds,
  upsertScore
} from '../db/queries.js';
import { beginTransaction, commit, rollback } from '../db/database.js';
import { isLulea } from '../utils/team-matcher.js';
import { calculateScore } from '../utils/scoring.js';
import { matchScorer } from '../utils/player-matcher.js';
import { loadRegistry, saveRegistry, learnVariation } from '../utils/player-registry.js';
import { ReviewCollector, REVIEW } from '../utils/review.js';
import { loadVerdicts, findVerdict, verdictOverride } from '../utils/scorer-verdicts.js';
import { CONFIDENT } from '../utils/scorer-cases.js';

/**
 * Calculate scores command handler
 * @param {object} options - Command options
 */
export async function calculateScores(options = {}) {
  const { dryRun = false, matchId = null, from: fromDate = null, to: toDate = null, force = false } = options;

  console.log(`\nCalculating scores${force ? ' (forced: recomputing everything)' : ''}`);
  if (fromDate || toDate) {
    console.log(`Date range: ${fromDate || 'start'} to ${toDate || 'end'}`);
  }
  console.log('');

  // Get all matches (optionally filtered by date)
  let matches = await getMatches(fromDate, toDate);

  if (matchId) {
    // Filter to specific match if requested
    const match = matches.find(m => m.id === parseInt(matchId, 10));
    if (!match) {
      console.error(`Match ID ${matchId} not found.`);
      process.exit(1);
    }
    matches = [match];
  }

  let totalGuesses = 0;
  let scoredGuesses = 0;
  let totalPoints = 0;
  let learnedCount = 0;
  let verdictCount = 0;
  let skippedAlreadyScored = 0;

  // Incremental by default: a guess that already carries a score is not scored
  // again. Anything that CHANGES a score — a scorer verdict, a map-player
  // mapping, a corrected result — therefore needs `calculate --force`, which is
  // what those commands tell you to run.
  const alreadyScored = force ? new Set() : await getScoredGuessIds();

  const review = new ReviewCollector();
  const registry = loadRegistry(); // for auto-learning confident scorer spellings
  const verdicts = loadVerdicts(); // human judgement on scorers — overrides the matcher

  // One transaction around the whole pass. Without it every upsertScore exports
  // the entire database to disk (see prepare().run in db/database.js), which is
  // where essentially all of the runtime went.
  if (!dryRun) beginTransaction();

  try {
  for (const match of matches) {
    // Skip matches without results
    if (match.home_score === null) {
      continue;
    }

    // Get Luleå scorers for this match
    const allGoalscorers = await getGoalscorers(match.id);
    const luleaTeam = match.lulea_is_home ? match.home_team : match.away_team;

    const luleaScorerNames = allGoalscorers
      .filter(g => isLulea(g.team) || g.team === luleaTeam)
      .map(g => g.player_name);

    // Get all guesses for this match
    const guesses = await getGuessesByMatch(match.id);

    for (const guess of guesses) {
      totalGuesses++;

      // A human verdict on this guess's scorer, if one has been recorded. It is
      // keyed on (user, match) and tied to the spelling it was decided about, so
      // an edited guess comes back `stale` and is re-surfaced rather than
      // silently inheriting the old ruling.
      const found = guess.predicted_scorer
        ? findVerdict(verdicts, {
            username: guess.forum_username,
            date: match.match_date,
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            guessedScorer: guess.predicted_scorer,
          })
        : { verdict: null, stale: false };

      const scores = calculateScore(guess, match, luleaScorerNames, verdictOverride(found.verdict));
      if (found.verdict) verdictCount++;

      // Scorer review + conservative auto-learning. Only relevant when the user
      // named a scorer and the game was actually played with known scorers.
      if (guess.predicted_scorer && luleaScorerNames.length > 0) {
        const sm = matchScorer(guess.predicted_scorer, luleaScorerNames);
        const detail = `guessed "${guess.predicted_scorer}", actual: [${luleaScorerNames.join(', ')}]`;

        if (found.stale) {
          const old = verdicts.verdicts[found.key];
          review.add(REVIEW.SCORER_VERDICT_STALE, {
            username: guess.forum_username,
            date: match.match_date,
            detail: `${detail} — earlier verdict "${old.verdict}" was about "${old.guessedScorer}", not applied`,
          });
        } else if (found.verdict) {
          // Settled by a human. Nothing to review, and nothing to auto-learn —
          // a verdict is a one-off ruling; generalising a nickname is a separate,
          // deliberate act (`map-player`, offered in the review UI).
        } else if (!sm.matched) {
          // The only thing generic matching can't resolve: surface it, withhold
          // just the scorer point (already 0), let a human rule on it.
          review.add(REVIEW.SCORER_UNMATCHED, {
            username: guess.forum_username,
            date: match.match_date,
            detail,
          });
        } else if (sm.ambiguous) {
          review.add(REVIEW.SCORER_AMBIGUOUS, {
            username: guess.forum_username,
            date: match.match_date,
            detail: `${detail} — best match "${sm.actualName}" (${sm.method})`,
          });
        } else if (sm.confidence < CONFIDENT) {
          review.add(REVIEW.SCORER_LOW_CONF, {
            username: guess.forum_username,
            date: match.match_date,
            detail: `${detail} — matched "${sm.actualName}" on ${sm.method} at only ${sm.confidence.toFixed(2)}`,
          });
        } else if (!dryRun && sm.canonical) {
          // Confident, unambiguous match to a known player: remember this spelling.
          const added = learnVariation(registry, sm.canonical, guess.predicted_scorer, {
            game: match.swehockey_game_id ?? match.id,
            date: match.match_date,
          });
          if (added) learnedCount++;
        }
      }

      // Already scored on an earlier run — the review pass above still ran, so
      // nothing disappears from the report, but there is no work to redo here.
      if (alreadyScored.has(guess.id)) {
        skippedAlreadyScored++;
        continue;
      }

      if (dryRun) {
        if (scores.total > 0) {
          console.log(`${guess.forum_username}: ${match.home_team} ${guess.predicted_home_score}-${guess.predicted_away_score} ${match.away_team}`);
          console.log(`  Actual: ${match.home_score}-${match.away_score}${match.is_overtime ? ' (OT)' : ''}`);
          console.log(`  Points: ${scores.total} (exact:${scores.exactResult} outcome:${scores.outcome} scorer:${scores.scorer} goals:${scores.luleaGoals} conceded:${scores.luleaConceded})`);
        }
      } else {
        // Save score to database
        await upsertScore(
          guess.id,
          scores.exactResult,
          scores.outcome,
          scores.scorer,
          scores.luleaGoals,
          scores.luleaConceded,
          scores.total
        );
      }

      scoredGuesses++;
      totalPoints += scores.total;
    }
  }
  } catch (error) {
    if (!dryRun) rollback();
    throw error;
  }
  if (!dryRun) commit();

  // Persist any newly learned scorer spellings.
  if (!dryRun && learnedCount > 0) {
    saveRegistry(registry);
  }

  console.log(`\nResults:`);
  console.log(`  Matches with results: ${matches.filter(m => m.home_score !== null).length}`);
  console.log(`  Guesses scored: ${scoredGuesses}`);
  if (skippedAlreadyScored > 0) {
    console.log(`  Skipped (already scored): ${skippedAlreadyScored}`);
  }
  console.log(`  Total points awarded: ${totalPoints}`);
  if (scoredGuesses > 0) {
    console.log(`  Average points per guess: ${(totalPoints / scoredGuesses).toFixed(2)}`);
  }
  console.log(`  Scorer spellings learned: ${dryRun ? '(dry run)' : learnedCount}`);
  if (verdictCount > 0) {
    console.log(`  Human scorer verdicts applied: ${verdictCount}`);
  }

  console.log(`\nReview:`);
  review.printSummary();
  if (review.count > 0 && !dryRun) {
    const path = review.writeReport('review-report.txt');
    console.log(`  Wrote ${path}`);
  }

  if (dryRun) {
    console.log('\nDry run - scores not saved to database');
  }

  if (skippedAlreadyScored > 0 && !force) {
    console.log(`\nScoring is incremental: ${skippedAlreadyScored} guess(es) already had a score and were left alone.`);
    console.log('After recording a scorer verdict, a map-player mapping, or a corrected');
    console.log('result, re-run with --force so those reach the guesses they affect.');
  }
}

export default calculateScores;
