import { getDatabase, prepare } from './database.js';

// User queries
export async function getOrCreateUser(username) {
  const db = await getDatabase();
  const existing = prepare('SELECT * FROM users WHERE forum_username = ?').get(username);
  if (existing) return existing;

  const stmt = prepare('INSERT INTO users (forum_username) VALUES (?)');
  const result = stmt.run(username);
  return { id: result.lastInsertRowid, forum_username: username };
}

export async function getUser(username) {
  const db = await getDatabase();
  const stmt = prepare('SELECT * FROM users WHERE forum_username = ?');
  return stmt.get(username);
}

// Match queries
export async function upsertMatch(matchData) {
  const db = await getDatabase();

  // Check if match exists
  const existing = prepare(`
    SELECT id FROM matches
    WHERE match_date = ? AND home_team = ? AND away_team = ?
  `).get(matchData.matchDate, matchData.homeTeam, matchData.awayTeam);

  if (existing) {
    // Update existing match
    prepare(`
      UPDATE matches SET
        swehockey_game_id = ?,
        match_time = ?,
        home_score = ?,
        away_score = ?,
        is_overtime = ?,
        lulea_is_home = ?
      WHERE id = ?
    `).run(
      matchData.swehockeyGameId,
      matchData.matchTime,
      matchData.homeScore,
      matchData.awayScore,
      matchData.isOvertime ? 1 : 0,
      matchData.luleaIsHome ? 1 : 0,
      existing.id
    );
    return { changes: 1, lastInsertRowid: null };
  } else {
    // Insert new match
    const stmt = prepare(`
      INSERT INTO matches (
        swehockey_game_id, match_date, match_time,
        home_team, away_team, home_score, away_score, is_overtime, lulea_is_home
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      matchData.swehockeyGameId,
      matchData.matchDate,
      matchData.matchTime,
      matchData.homeTeam,
      matchData.awayTeam,
      matchData.homeScore,
      matchData.awayScore,
      matchData.isOvertime ? 1 : 0,
      matchData.luleaIsHome ? 1 : 0
    );
  }
}

export async function getMatch(matchDate, homeTeam, awayTeam) {
  const db = await getDatabase();
  const stmt = prepare(`
    SELECT * FROM matches
    WHERE match_date = ? AND home_team = ? AND away_team = ?
  `);
  return stmt.get(matchDate, homeTeam, awayTeam);
}

export async function getMatchById(matchId) {
  const db = await getDatabase();
  const stmt = prepare('SELECT * FROM matches WHERE id = ?');
  return stmt.get(matchId);
}

export async function getMatches(fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = 'SELECT * FROM matches WHERE 1=1';
  const params = [];

  if (fromDate) {
    query += ' AND match_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    query += ' AND match_date <= ?';
    params.push(toDate);
  }

  query += ' ORDER BY match_date, match_time';

  const stmt = prepare(query);
  return stmt.all(...params);
}

export async function getMatchByDateAndTeams(matchDate, team1, team2) {
  const db = await getDatabase();
  // Try both orderings since we might not know home/away
  const stmt = prepare(`
    SELECT * FROM matches
    WHERE match_date = ?
    AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))
  `);
  return stmt.get(matchDate, team1, team2, team2, team1);
}

// Goalscorer queries
export async function addGoalscorer(matchId, playerName, team, period, goalTime) {
  const db = await getDatabase();
  const stmt = prepare(`
    INSERT INTO goalscorers (match_id, player_name, team, period, goal_time)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(matchId, playerName, team, period, goalTime);
}

export async function getGoalscorers(matchId) {
  const db = await getDatabase();
  const stmt = prepare('SELECT * FROM goalscorers WHERE match_id = ?');
  return stmt.all(matchId);
}

export async function clearGoalscorers(matchId) {
  const db = await getDatabase();
  const stmt = prepare('DELETE FROM goalscorers WHERE match_id = ?');
  return stmt.run(matchId);
}

/**
 * Does the incoming guess come from a later post than the stored one?
 *
 * Post ids decide it whenever both sides have one: they are integers the forum
 * hands out in order, so there are no ties and no formats to read. Timestamps
 * are the fallback, and a poor one — they have minute resolution, so a user who
 * corrects a guess within the same minute compares equal and loses, and any
 * post whose date the board renders in a shape the scraper cannot read arrives
 * blank, which loses to everything.
 */
export function isLaterPost(postId, postTimestamp, existing) {
  if (postId != null && existing.post_id != null) return postId > existing.post_id;
  return postTimestamp > existing.post_timestamp;
}

// Guess queries
export async function upsertGuess(userId, matchId, postTimestamp, rawText, homeScore, awayScore, scorer, isValid, postId = null) {
  const db = await getDatabase();

  // Check if there's an existing guess
  const existing = prepare(`
    SELECT * FROM guesses WHERE user_id = ? AND match_id = ?
  `).get(userId, matchId);

  if (existing) {
    // A later post replaces the stored guess. So does the same post read
    // again, when what it says has changed: a hand-corrected row keeps the id
    // of the post it fixes, and the corrected version is the one that counts.
    const samePostChanged = postId != null && postId === existing.post_id && (
      rawText !== existing.raw_text ||
      homeScore !== existing.predicted_home_score ||
      awayScore !== existing.predicted_away_score ||
      (scorer ?? null) !== (existing.predicted_scorer ?? null)
    );
    if ((isLaterPost(postId, postTimestamp, existing) || samePostChanged) && isValid) {
      const stmt = prepare(`
        UPDATE guesses SET
          post_id = ?,
          post_timestamp = ?,
          raw_text = ?,
          predicted_home_score = ?,
          predicted_away_score = ?,
          predicted_scorer = ?,
          is_valid = ?
        WHERE id = ?
      `);
      return stmt.run(postId, postTimestamp, rawText, homeScore, awayScore, scorer, isValid ? 1 : 0, existing.id);
    }

    // Same guess, but we now know which post it came from. Record that without
    // touching the guess itself, so the next comparison can use the id — a
    // re-import of unchanged rows is otherwise the one moment the id would
    // never be filled in.
    if (postId != null && existing.post_id == null) {
      prepare('UPDATE guesses SET post_id = ? WHERE id = ?').run(postId, existing.id);
    }
    return { changes: 0 };
  }

  const stmt = prepare(`
    INSERT INTO guesses (
      user_id, match_id, post_id, post_timestamp, raw_text,
      predicted_home_score, predicted_away_score, predicted_scorer, is_valid
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, matchId, postId, postTimestamp, rawText, homeScore, awayScore, scorer, isValid ? 1 : 0);
}

export async function getGuessesByMatch(matchId) {
  const db = await getDatabase();
  const stmt = prepare(`
    SELECT g.*, u.forum_username
    FROM guesses g
    JOIN users u ON g.user_id = u.id
    WHERE g.match_id = ? AND g.is_valid = 1
  `);
  return stmt.all(matchId);
}

// Score queries
export async function upsertScore(guessId, exactResult, outcome, scorer, luleaGoals, luleaConceded, total) {
  const db = await getDatabase();

  // Check if score exists
  const existing = prepare('SELECT id FROM scores WHERE guess_id = ?').get(guessId);

  if (existing) {
    prepare(`
      UPDATE scores SET
        exact_result_pts = ?,
        outcome_pts = ?,
        scorer_pts = ?,
        lulea_goals_pts = ?,
        lulea_conceded_pts = ?,
        total_pts = ?
      WHERE guess_id = ?
    `).run(exactResult, outcome, scorer, luleaGoals, luleaConceded, total, guessId);
    return { changes: 1 };
  }

  const stmt = prepare(`
    INSERT INTO scores (
      guess_id, exact_result_pts, outcome_pts, scorer_pts,
      lulea_goals_pts, lulea_conceded_pts, total_pts
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(guessId, exactResult, outcome, scorer, luleaGoals, luleaConceded, total);
}

/**
 * The ids of every guess that already carries a score.
 *
 * One query rather than a lookup per guess: `calculate` uses this to skip
 * guesses it has already scored, and asking the database 1000 times would cost
 * more than the scoring it is trying to avoid.
 *
 * @returns {Promise<Set<number>>}
 */
export async function getScoredGuessIds() {
  const db = await getDatabase();
  const rows = prepare('SELECT guess_id FROM scores').all();
  return new Set(rows.map(r => r.guess_id));
}

export async function getLeaderboard(fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = `
    SELECT
      u.forum_username,
      COUNT(s.id) as matches_guessed,
      SUM(s.total_pts) as total_points,
      SUM(s.exact_result_pts) as exact_results,
      SUM(s.outcome_pts) as outcomes,
      SUM(s.scorer_pts) as scorers,
      SUM(s.lulea_goals_pts) as lulea_goals,
      SUM(s.lulea_conceded_pts) as lulea_conceded,
      ROUND(CAST(SUM(s.total_pts) AS FLOAT) / COUNT(s.id), 2) as avg_points
    FROM scores s
    JOIN guesses g ON s.guess_id = g.id
    JOIN users u ON g.user_id = u.id
    JOIN matches m ON g.match_id = m.id
    WHERE g.is_valid = 1
  `;

  const params = [];

  if (fromDate) {
    query += ' AND m.match_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    query += ' AND m.match_date <= ?';
    params.push(toDate);
  }

  query += `
    GROUP BY u.id
    ORDER BY total_points DESC, avg_points DESC
  `;

  const stmt = prepare(query);
  return stmt.all(...params);
}

// Standings for the forum post. Max points per guess is 7 (see scoring model:
// exact 3 + outcome 1 + scorer 1 + Luleå goals 1 + conceded 1).
export async function getStandings(fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = `
    SELECT
      u.forum_username AS name,
      SUM(s.total_pts) AS points,
      COUNT(s.id) AS rounds,
      SUM(CASE WHEN s.total_pts = 7 THEN 1 ELSE 0 END) AS full,
      ROUND(CAST(SUM(s.total_pts) AS FLOAT) / COUNT(s.id), 2) AS ppg,
      SUM(s.scorer_pts) AS scorers,
      SUM(CASE WHEN s.exact_result_pts > 0 THEN 1 ELSE 0 END) AS results,
      SUM(CASE WHEN m.match_date = latest.d THEN s.total_pts END) AS last_round
    FROM scores s
    JOIN guesses g ON s.guess_id = g.id
    JOIN users u ON g.user_id = u.id
    JOIN matches m ON g.match_id = m.id
    CROSS JOIN latest
    WHERE g.is_valid = 1
  `;
  // latest = the most recent scored game in range; users who skipped it get NULL.
  let range = '';
  const params = [];
  if (fromDate) { range += ' AND m.match_date >= ?'; params.push(fromDate); }
  if (toDate) { range += ' AND m.match_date <= ?'; params.push(toDate); }
  query = `
    WITH latest AS (
      SELECT MAX(m.match_date) AS d
      FROM scores s
      JOIN guesses g ON s.guess_id = g.id
      JOIN matches m ON g.match_id = m.id
      WHERE g.is_valid = 1${range}
    )` + query + range + ' GROUP BY u.id ORDER BY points DESC, ppg DESC';
  return prepare(query).all(...params, ...params);
}

// The perfect (7-point) guesses, for the "Fullpoängare" section.
export async function getPerfectGuesses(fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = `
    SELECT
      u.forum_username AS name,
      m.match_date AS date,
      m.home_team, m.away_team, m.home_score, m.away_score,
      g.predicted_scorer AS scorer
    FROM scores s
    JOIN guesses g ON s.guess_id = g.id
    JOIN users u ON g.user_id = u.id
    JOIN matches m ON g.match_id = m.id
    WHERE g.is_valid = 1 AND s.total_pts = 7
  `;
  const params = [];
  if (fromDate) { query += ' AND m.match_date >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND m.match_date <= ?'; params.push(toDate); }
  query += ' ORDER BY m.match_date, u.forum_username';
  return prepare(query).all(...params);
}

// Number of played Luleå games (= omgång count) and the latest result date.
export async function getResultMeta(fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = `
    SELECT COUNT(*) AS played, MAX(match_date) AS lastDate
    FROM matches
    WHERE home_score IS NOT NULL
  `;
  const params = [];
  if (fromDate) { query += ' AND match_date >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND match_date <= ?'; params.push(toDate); }
  return prepare(query).get(...params);
}

export async function getUserStats(username, fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = `
    SELECT
      m.match_date,
      m.home_team,
      m.away_team,
      m.home_score,
      m.away_score,
      m.is_overtime,
      g.predicted_home_score,
      g.predicted_away_score,
      g.predicted_scorer,
      s.exact_result_pts,
      s.outcome_pts,
      s.scorer_pts,
      s.lulea_goals_pts,
      s.lulea_conceded_pts,
      s.total_pts
    FROM scores s
    JOIN guesses g ON s.guess_id = g.id
    JOIN users u ON g.user_id = u.id
    JOIN matches m ON g.match_id = m.id
    WHERE u.forum_username = ? AND g.is_valid = 1
  `;

  const params = [username];

  if (fromDate) {
    query += ' AND m.match_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    query += ' AND m.match_date <= ?';
    params.push(toDate);
  }

  query += ' ORDER BY m.match_date';

  const stmt = prepare(query);
  return stmt.all(...params);
}

export async function getMatchStats(fromDate = null, toDate = null) {
  const db = await getDatabase();
  let query = `
    SELECT
      COUNT(*) as total_matches,
      SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END) as played_matches
    FROM matches WHERE 1=1
  `;
  const params = [];

  if (fromDate) {
    query += ' AND match_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    query += ' AND match_date <= ?';
    params.push(toDate);
  }

  const stmt = prepare(query);
  return stmt.get(...params);
}
