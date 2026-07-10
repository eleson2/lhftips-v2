# LHFTips Database Documentation

Technical documentation for the LHFTips SQLite database schema.

## Overview

LHFTips uses SQLite (via sql.js) for data persistence. The database file `lhftips.db` is created in the project root.

## Schema Diagram

```
┌─────────────────────┐
│       users         │
├─────────────────────┤
│ PK id               │
│ UK forum_username   │
└──────────┬──────────┘
           │
           │ 1                          ┌─────────────────────┐
           │                            │      matches        │
           │                            ├─────────────────────┤
           │                            │ PK id               │
           │                            │    swehockey_game_id│
           │                            │    match_date       │
           │                            │    match_time       │
           │                            │    home_team        │
           │                            │    away_team        │
           │                            │    home_score       │
           │                            │    away_score       │
           │                            │    is_overtime      │
           │                            │    lulea_is_home    │
           │                            │ UK (match_date,     │
           │                            │     home_team,      │
           │                            │     away_team)      │
           │                            └──────────┬──────────┘
           │                                       │
           │                              ┌────────┴────────┐
           │                              │ 1               │ 1
           │                              ▼ *               ▼ *
           │                   ┌─────────────────┐  ┌─────────────────┐
           │                   │   goalscorers   │  │     guesses     │
           │                   ├─────────────────┤  ├─────────────────┤
           │                   │ PK id           │  │ PK id           │
           │                   │ FK match_id     │  │ FK user_id      │◄───┘
           │                   │    player_name  │  │ FK match_id     │
           │                   │    team         │  │    post_        │
           │                   │    period       │  │     timestamp   │
           │                   │    goal_time    │  │    raw_text     │
           │                   └─────────────────┘  │    predicted_   │
           │                                        │     home_score  │
           └────────────────────────────────────────│    predicted_   │
                                                    │     away_score  │
                                                    │    predicted_   │
                                                    │     scorer      │
                                                    │    is_valid     │
                                                    │ UK (user_id,    │
                                                    │     match_id)   │
                                                    └────────┬────────┘
                                                             │
                                                             │ 1
                                                             ▼ 1
                                                    ┌─────────────────┐
                                                    │     scores      │
                                                    ├─────────────────┤
                                                    │ PK id           │
                                                    │ UK guess_id     │
                                                    │    exact_       │
                                                    │     result_pts  │
                                                    │    outcome_pts  │
                                                    │    scorer_pts   │
                                                    │    lulea_       │
                                                    │     goals_pts   │
                                                    │    lulea_       │
                                                    │     conceded_pts│
                                                    │    total_pts    │
                                                    └─────────────────┘

Legend: PK = Primary Key, FK = Foreign Key, UK = Unique Key
```

## Table Definitions

### users

Forum users who have submitted predictions.

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  forum_username TEXT UNIQUE NOT NULL
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY | Auto-increment identifier |
| forum_username | TEXT | UNIQUE, NOT NULL | Forum username exactly as displayed |

---

### matches

Hockey matches scraped from swehockey.se.

```sql
CREATE TABLE matches (
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
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY | Auto-increment identifier |
| swehockey_game_id | INTEGER | | Swehockey game ID for events lookup |
| match_date | DATE | NOT NULL | Match date (YYYY-MM-DD) |
| match_time | TIME | | Match start time (HH:MM) |
| home_team | TEXT | NOT NULL | Home team canonical name |
| away_team | TEXT | NOT NULL | Away team canonical name |
| home_score | INTEGER | | Final home score (NULL if not played) |
| away_score | INTEGER | | Final away score (NULL if not played) |
| is_overtime | INTEGER | DEFAULT 0 | 1 if OT/SO, 0 if regulation |
| lulea_is_home | INTEGER | | 1 if Luleå is home, 0 if away |

---

### goalscorers

Goals scored in each match.

```sql
CREATE TABLE goalscorers (
  id INTEGER PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  period INTEGER,
  goal_time TEXT
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY | Auto-increment identifier |
| match_id | INTEGER | FK → matches(id) | Which match this goal was in |
| player_name | TEXT | NOT NULL | Scorer's name |
| team | TEXT | NOT NULL | Team that scored |
| period | INTEGER | | Period (1, 2, 3, 4=OT) |
| goal_time | TEXT | | Time of goal (MM:SS) |

---

### guesses

User predictions parsed from forum posts.

```sql
CREATE TABLE guesses (
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
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY | Auto-increment identifier |
| user_id | INTEGER | FK → users(id) | Who made the prediction |
| match_id | INTEGER | FK → matches(id) | Which match was predicted |
| post_timestamp | DATETIME | NOT NULL | When the prediction was posted |
| raw_text | TEXT | NOT NULL | Original prediction text |
| predicted_home_score | INTEGER | | Predicted home goals |
| predicted_away_score | INTEGER | | Predicted away goals |
| predicted_scorer | TEXT | | Predicted Luleå goalscorer |
| is_valid | INTEGER | DEFAULT 1 | 1 if before match, 0 if after |

---

### scores

Calculated points for each prediction.

```sql
CREATE TABLE scores (
  id INTEGER PRIMARY KEY,
  guess_id INTEGER REFERENCES guesses(id) UNIQUE,
  exact_result_pts INTEGER DEFAULT 0,
  outcome_pts INTEGER DEFAULT 0,
  scorer_pts INTEGER DEFAULT 0,
  lulea_goals_pts INTEGER DEFAULT 0,
  lulea_conceded_pts INTEGER DEFAULT 0,
  total_pts INTEGER DEFAULT 0
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY | Auto-increment identifier |
| guess_id | INTEGER | FK, UNIQUE | One score per guess |
| exact_result_pts | INTEGER | DEFAULT 0 | 0 or 3 |
| outcome_pts | INTEGER | DEFAULT 0 | 0 or 1 |
| scorer_pts | INTEGER | DEFAULT 0 | 0 or 1 |
| lulea_goals_pts | INTEGER | DEFAULT 0 | 0 or 1 |
| lulea_conceded_pts | INTEGER | DEFAULT 0 | 0 or 1 |
| total_pts | INTEGER | DEFAULT 0 | Sum (0-7) |

---

## Indexes

```sql
CREATE INDEX idx_matches_date ON matches(match_date);
CREATE INDEX idx_goalscorers_match ON goalscorers(match_id);
CREATE INDEX idx_guesses_user ON guesses(user_id);
CREATE INDEX idx_guesses_match ON guesses(match_id);
CREATE INDEX idx_scores_guess ON scores(guess_id);
```

## Common Queries

### Leaderboard

```sql
SELECT
  u.forum_username,
  COUNT(s.id) as matches_guessed,
  SUM(s.total_pts) as total_points,
  ROUND(CAST(SUM(s.total_pts) AS FLOAT) / COUNT(s.id), 2) as avg_points
FROM scores s
JOIN guesses g ON s.guess_id = g.id
JOIN users u ON g.user_id = u.id
JOIN matches m ON g.match_id = m.id
WHERE g.is_valid = 1
  AND m.match_date >= '2024-09-01'
  AND m.match_date <= '2025-05-01'
GROUP BY u.id
ORDER BY total_points DESC;
```

### User Match History

```sql
SELECT
  m.match_date,
  m.home_team || ' ' || m.home_score || '-' || m.away_score || ' ' || m.away_team as result,
  g.predicted_home_score || '-' || g.predicted_away_score as prediction,
  s.total_pts
FROM scores s
JOIN guesses g ON s.guess_id = g.id
JOIN matches m ON g.match_id = m.id
JOIN users u ON g.user_id = u.id
WHERE u.forum_username = 'Ransen67'
ORDER BY m.match_date;
```

### Match Statistics

```sql
SELECT
  COUNT(*) as total_matches,
  SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END) as played
FROM matches;
```

## Backup

```bash
# Copy database file
cp lhftips.db lhftips.db.backup

# Export to SQL
sqlite3 lhftips.db .dump > backup.sql
```
