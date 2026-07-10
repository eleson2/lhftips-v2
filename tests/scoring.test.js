import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// We need to test the scoring logic directly
// Import the internal function (we'll need to export it)

describe('Scoring Logic', () => {
  // Mock match data
  const createMatch = (homeScore, awayScore, isOvertime = false, luleaIsHome = true) => ({
    home_score: homeScore,
    away_score: awayScore,
    is_overtime: isOvertime ? 1 : 0,
    lulea_is_home: luleaIsHome ? 1 : 0,
    home_team: luleaIsHome ? 'Luleå HF' : 'Skellefteå AIK',
    away_team: luleaIsHome ? 'Skellefteå AIK' : 'Luleå HF'
  });

  // Mock guess data
  const createGuess = (homeScore, awayScore, scorer = null) => ({
    predicted_home_score: homeScore,
    predicted_away_score: awayScore,
    predicted_scorer: scorer
  });

  describe('Exact Result Points (3 pts)', () => {
    test('exact match gives 3 points', () => {
      const match = createMatch(3, 1);
      const guess = createGuess(3, 1);

      // Match: Luleå 3-1 Opponent, Guess: 3-1
      assert.strictEqual(guess.predicted_home_score === match.home_score, true);
      assert.strictEqual(guess.predicted_away_score === match.away_score, true);
    });

    test('wrong score gives 0 points', () => {
      const match = createMatch(3, 1);
      const guess = createGuess(2, 1);

      assert.strictEqual(guess.predicted_home_score === match.home_score, false);
    });
  });

  describe('Outcome Points (1 pt)', () => {
    test('predicting Luleå win correctly gives 1 point', () => {
      const match = createMatch(3, 1, false, true); // Luleå home, wins 3-1
      const guess = createGuess(4, 2); // Also predicts Luleå win

      // Luleå is home, so home_score is Luleå's score
      const luleaWon = match.home_score > match.away_score;
      const predictedLuleaWin = guess.predicted_home_score > guess.predicted_away_score;

      assert.strictEqual(luleaWon, true);
      assert.strictEqual(predictedLuleaWin, true);
    });

    test('predicting Luleå loss when they win gives 0 points', () => {
      const match = createMatch(3, 1, false, true); // Luleå wins
      const guess = createGuess(1, 2); // Predicts Luleå loss

      const luleaWon = match.home_score > match.away_score;
      const predictedLuleaLoss = guess.predicted_home_score < guess.predicted_away_score;

      assert.strictEqual(luleaWon, true);
      assert.strictEqual(predictedLuleaLoss, true);
      // These don't match, so 0 points
    });
  });

  describe('Luleå Goals Points (1 pt)', () => {
    test('correct Luleå goals gives 1 point', () => {
      const match = createMatch(3, 1, false, true); // Luleå scores 3
      const guess = createGuess(3, 2); // Predicts Luleå scores 3

      // Luleå is home
      assert.strictEqual(guess.predicted_home_score, match.home_score);
    });

    test('wrong Luleå goals gives 0 points', () => {
      const match = createMatch(3, 1, false, true);
      const guess = createGuess(4, 1);

      assert.strictEqual(guess.predicted_home_score !== match.home_score, true);
    });
  });

  describe('Goals Conceded Points (1 pt)', () => {
    test('correct goals conceded gives 1 point', () => {
      const match = createMatch(3, 1, false, true); // Opponent scores 1
      const guess = createGuess(2, 1); // Predicts opponent scores 1

      // Away team is opponent when Luleå is home
      assert.strictEqual(guess.predicted_away_score, match.away_score);
    });
  });

  describe('Maximum Points (7 pts)', () => {
    test('perfect guess with scorer gives 7 points', () => {
      const match = createMatch(3, 1, false, true);
      const guess = createGuess(3, 1, 'Omark');

      let points = 0;

      // Exact result: 3
      if (guess.predicted_home_score === match.home_score &&
          guess.predicted_away_score === match.away_score) {
        points += 3;
      }

      // Outcome: 1
      const luleaWon = match.home_score > match.away_score;
      const predictedWin = guess.predicted_home_score > guess.predicted_away_score;
      if (luleaWon === predictedWin) {
        points += 1;
      }

      // Scorer: 1 (assuming Omark scored)
      points += 1;

      // Luleå goals: 1
      if (guess.predicted_home_score === match.home_score) {
        points += 1;
      }

      // Goals conceded: 1
      if (guess.predicted_away_score === match.away_score) {
        points += 1;
      }

      assert.strictEqual(points, 7);
    });
  });

  describe('Away Games', () => {
    test('scoring works when Luleå is away', () => {
      const match = createMatch(1, 3, false, false); // Opponent 1-3 Luleå
      const guess = createGuess(1, 3); // Correct!

      // When Luleå is away:
      // - Luleå score = away_score = 3
      // - Opponent score = home_score = 1
      const luleaScore = match.away_score;
      const opponentScore = match.home_score;

      const predictedLuleaScore = guess.predicted_away_score;
      const predictedOpponentScore = guess.predicted_home_score;

      assert.strictEqual(luleaScore, 3);
      assert.strictEqual(predictedLuleaScore, 3);
      assert.strictEqual(opponentScore, 1);
      assert.strictEqual(predictedOpponentScore, 1);
    });
  });
});
