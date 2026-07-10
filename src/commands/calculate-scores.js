import {
  getMatches,
  getGuessesByMatch,
  getGoalscorers,
  upsertScore
} from '../db/queries.js';
import { isLulea } from '../utils/team-matcher.js';
import { calculateScore } from '../utils/scoring.js';
import { matchScorer } from '../utils/player-matcher.js';
import { loadRegistry, saveRegistry, learnVariation } from '../utils/player-registry.js';
import { ReviewCollector, REVIEW } from '../utils/review.js';

/**
 * Calculate scores command handler
 * @param {object} options - Command options
 */
export async function calculateScores(options = {}) {
  const { dryRun = false, matchId = null, from: fromDate = null, to: toDate = null } = options;

  console.log(`\nCalculating scores`);
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

  const review = new ReviewCollector();
  const registry = loadRegistry(); // for auto-learning confident scorer spellings

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

      const scores = calculateScore(guess, match, luleaScorerNames);

      // Scorer review + conservative auto-learning. Only relevant when the user
      // named a scorer and the game was actually played with known scorers.
      if (guess.predicted_scorer && luleaScorerNames.length > 0) {
        const sm = matchScorer(guess.predicted_scorer, luleaScorerNames);
        if (!sm.matched) {
          // The only thing generic matching can't resolve: surface it, withhold
          // just the scorer point (already 0), let a human map the nickname.
          review.add(REVIEW.SCORER_UNMATCHED, {
            username: guess.forum_username,
            date: match.match_date,
            detail: `guessed "${guess.predicted_scorer}", actual: [${luleaScorerNames.join(', ')}]`,
          });
        } else if (!dryRun && sm.canonical && !sm.ambiguous && sm.confidence >= 0.85) {
          // Confident, unambiguous match to a known player: remember this spelling.
          const added = learnVariation(registry, sm.canonical, guess.predicted_scorer, {
            game: match.swehockey_game_id ?? match.id,
            date: match.match_date,
          });
          if (added) learnedCount++;
        }
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

  // Persist any newly learned scorer spellings.
  if (!dryRun && learnedCount > 0) {
    saveRegistry(registry);
  }

  console.log(`\nResults:`);
  console.log(`  Matches with results: ${matches.filter(m => m.home_score !== null).length}`);
  console.log(`  Guesses scored: ${scoredGuesses}`);
  console.log(`  Total points awarded: ${totalPoints}`);
  if (scoredGuesses > 0) {
    console.log(`  Average points per guess: ${(totalPoints / scoredGuesses).toFixed(2)}`);
  }
  console.log(`  Scorer spellings learned: ${dryRun ? '(dry run)' : learnedCount}`);

  console.log(`\nReview:`);
  review.printSummary();
  if (review.count > 0 && !dryRun) {
    const path = review.writeReport('review-report.txt');
    console.log(`  Wrote ${path}`);
  }

  if (dryRun) {
    console.log('\nDry run - scores not saved to database');
  }
}

export default calculateScores;
