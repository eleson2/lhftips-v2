import { playersMatch } from './player-matcher.js';

// Scoring constants
export const POINTS = {
  EXACT_RESULT: 3,
  CORRECT_OUTCOME: 1,
  CORRECT_SCORER: 1,
  CORRECT_LULEA_GOALS: 1,
  CORRECT_GOALS_CONCEDED: 1
};

/**
 * Get Luleå's score from a match based on whether they're home or away
 * @param {object} match - Match object with home_score, away_score, lulea_is_home
 * @returns {number|null}
 */
export function getLuleaScore(match) {
  if (match.home_score === null || match.away_score === null) return null;
  return match.lulea_is_home === 1 ? match.home_score : match.away_score;
}

/**
 * Get opponent's score from a match
 * @param {object} match - Match object
 * @returns {number|null}
 */
export function getOpponentScore(match) {
  if (match.home_score === null || match.away_score === null) return null;
  return match.lulea_is_home === 1 ? match.away_score : match.home_score;
}

/**
 * Get predicted Luleå score from a guess
 * @param {object} guess - Guess object with predicted_home_score, predicted_away_score
 * @param {object} match - Match object with lulea_is_home
 * @returns {number|null}
 */
export function getPredictedLuleaScore(guess, match) {
  if (guess.predicted_home_score === null || guess.predicted_away_score === null) return null;
  return match.lulea_is_home === 1 ? guess.predicted_home_score : guess.predicted_away_score;
}

/**
 * Get predicted opponent score from a guess
 * @param {object} guess - Guess object
 * @param {object} match - Match object
 * @returns {number|null}
 */
export function getPredictedOpponentScore(guess, match) {
  if (guess.predicted_home_score === null || guess.predicted_away_score === null) return null;
  return match.lulea_is_home === 1 ? guess.predicted_away_score : guess.predicted_home_score;
}

/**
 * Check if the guess has the exact correct result
 * @param {object} guess - Guess object
 * @param {object} match - Match object
 * @returns {number} - Points awarded (3 or 0)
 */
export function checkExactResult(guess, match) {
  const exactHome = guess.predicted_home_score === match.home_score;
  const exactAway = guess.predicted_away_score === match.away_score;
  return (exactHome && exactAway) ? POINTS.EXACT_RESULT : 0;
}

/**
 * Determine outcome from Luleå's perspective
 * @param {number} luleaScore
 * @param {number} opponentScore
 * @returns {'win'|'loss'|'draw'}
 */
export function determineOutcome(luleaScore, opponentScore) {
  if (luleaScore > opponentScore) return 'win';
  if (luleaScore < opponentScore) return 'loss';
  return 'draw';
}

/**
 * Check if the guess has the correct outcome (win/loss/draw)
 * @param {object} guess - Guess object
 * @param {object} match - Match object
 * @returns {number} - Points awarded (1 or 0)
 */
export function checkOutcome(guess, match) {
  const actualLulea = getLuleaScore(match);
  const actualOpponent = getOpponentScore(match);
  const predictedLulea = getPredictedLuleaScore(guess, match);
  const predictedOpponent = getPredictedOpponentScore(guess, match);

  if (actualLulea === null || predictedLulea === null) return 0;

  const actualOutcome = determineOutcome(actualLulea, actualOpponent);
  const predictedOutcome = determineOutcome(predictedLulea, predictedOpponent);

  return (actualOutcome === predictedOutcome) ? POINTS.CORRECT_OUTCOME : 0;
}

/**
 * Check if the guess has a correct goalscorer
 * @param {string|null} predictedScorer - Predicted scorer name
 * @param {string[]} luleaScorerNames - Array of actual Luleå scorer names
 * @returns {number} - Points awarded (1 or 0)
 */
export function checkScorer(predictedScorer, luleaScorerNames) {
  if (!predictedScorer || luleaScorerNames.length === 0) return 0;

  for (const scorerName of luleaScorerNames) {
    if (playersMatch(predictedScorer, scorerName)) {
      return POINTS.CORRECT_SCORER;
    }
  }
  return 0;
}

/**
 * Check if the guess has the correct number of Luleå goals
 * @param {object} guess - Guess object
 * @param {object} match - Match object
 * @returns {number} - Points awarded (1 or 0)
 */
export function checkLuleaGoals(guess, match) {
  const actualLulea = getLuleaScore(match);
  const predictedLulea = getPredictedLuleaScore(guess, match);

  if (actualLulea === null || predictedLulea === null) return 0;
  return (predictedLulea === actualLulea) ? POINTS.CORRECT_LULEA_GOALS : 0;
}

/**
 * Check if the guess has the correct number of goals conceded
 * @param {object} guess - Guess object
 * @param {object} match - Match object
 * @returns {number} - Points awarded (1 or 0)
 */
export function checkGoalsConceded(guess, match) {
  const actualOpponent = getOpponentScore(match);
  const predictedOpponent = getPredictedOpponentScore(guess, match);

  if (actualOpponent === null || predictedOpponent === null) return 0;
  return (predictedOpponent === actualOpponent) ? POINTS.CORRECT_GOALS_CONCEDED : 0;
}

/**
 * Calculate complete score breakdown for a guess
 * @param {object} guess - Guess object
 * @param {object} match - Match object
 * @param {string[]} luleaScorerNames - Array of Luleå scorer names
 * @returns {object} - Score breakdown with all categories and total
 */
export function calculateScore(guess, match, luleaScorerNames) {
  // Check if match has a result
  if (match.home_score === null || match.away_score === null) {
    return { exactResult: 0, outcome: 0, scorer: 0, luleaGoals: 0, luleaConceded: 0, total: 0 };
  }

  // Check if prediction is valid
  if (guess.predicted_home_score === null || guess.predicted_away_score === null) {
    return { exactResult: 0, outcome: 0, scorer: 0, luleaGoals: 0, luleaConceded: 0, total: 0 };
  }

  const exactResult = checkExactResult(guess, match);
  const outcome = checkOutcome(guess, match);
  const scorer = checkScorer(guess.predicted_scorer, luleaScorerNames);
  const luleaGoals = checkLuleaGoals(guess, match);
  const luleaConceded = checkGoalsConceded(guess, match);
  const total = exactResult + outcome + scorer + luleaGoals + luleaConceded;

  return { exactResult, outcome, scorer, luleaGoals, luleaConceded, total };
}
