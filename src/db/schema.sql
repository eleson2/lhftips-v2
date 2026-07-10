-- Forum users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  forum_username TEXT UNIQUE NOT NULL
);

-- Matches from swehockey
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  swehockey_game_id INTEGER,
  match_date DATE NOT NULL,
  match_time TIME,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  is_overtime INTEGER DEFAULT 0,
  lulea_is_home INTEGER,
  UNIQUE(match_date, home_team, away_team)
);

-- Goalscorers per match
CREATE TABLE IF NOT EXISTS goalscorers (
  id INTEGER PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  period INTEGER,
  goal_time TEXT
);

-- User guesses
CREATE TABLE IF NOT EXISTS guesses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  match_id INTEGER REFERENCES matches(id),
  post_timestamp DATETIME NOT NULL,
  raw_text TEXT NOT NULL,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  predicted_scorer TEXT,
  is_valid INTEGER DEFAULT 1,
  UNIQUE(user_id, match_id)
);

-- Calculated scores
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  guess_id INTEGER REFERENCES guesses(id) UNIQUE,
  exact_result_pts INTEGER DEFAULT 0,
  outcome_pts INTEGER DEFAULT 0,
  scorer_pts INTEGER DEFAULT 0,
  lulea_goals_pts INTEGER DEFAULT 0,
  lulea_conceded_pts INTEGER DEFAULT 0,
  total_pts INTEGER DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_goalscorers_match ON goalscorers(match_id);
CREATE INDEX IF NOT EXISTS idx_guesses_user ON guesses(user_id);
CREATE INDEX IF NOT EXISTS idx_guesses_match ON guesses(match_id);
CREATE INDEX IF NOT EXISTS idx_scores_guess ON scores(guess_id);
