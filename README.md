# LHFTips - Hockey Prediction Competition Scorer

A CLI application for collecting and scoring hockey game predictions from Luleå Hockey Forum. Scrapes predictions from forum threads and match results from swehockey.se, then calculates scores based on prediction accuracy.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [Scoring System](#scoring-system)
- [Guess Format](#guess-format)
- [Database Model](#database-model)
- [Examples](#examples)

## Installation

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Clone or download the project
cd LHFTips

# Install dependencies
npm install

# Initialize the database
node src/index.js init
```

## Quick Start

```bash
# 1. Initialize database
node src/index.js init

# 2. Edit config/settings.json with your URLs (see Configuration below)

# 3. Scrape match results from swehockey
node src/index.js scrape results

# 4. Scrape guesses from forum
node src/index.js scrape guesses

# 5. Calculate scores
node src/index.js calculate

# 6. View leaderboard
node src/index.js report
```

## Configuration

All configuration is stored in `config/settings.json`. Edit this file directly:

```json
{
  "forumUrl": "https://www.luleahockeyforum.com/t2534-tips-2024-2025",
  "swehockeyUrl": "https://stats.swehockey.se/ScheduleAndResults/Schedule/18263",
  "team": "Luleå HF"
}
```

| Field | Description | Example |
|-------|-------------|---------|
| `forumUrl` | Full URL to the forum prediction thread | `https://www.luleahockeyforum.com/t2534-...` |
| `swehockeyUrl` | Full URL to the swehockey schedule page | `https://stats.swehockey.se/ScheduleAndResults/Schedule/18263` |
| `team` | Team to track (used for scoring) | `Luleå HF` |

### Finding the Swehockey URL

1. Go to [stats.swehockey.se](https://stats.swehockey.se)
2. Navigate to the league (SHL, HockeyAllsvenskan, etc.)
3. Click on "Schedule" or find the team schedule
4. Copy the full URL from your browser

### View Current Configuration

```bash
node src/index.js config
```

## CLI Commands

### Initialize Database

```bash
node src/index.js init
```

Creates the SQLite database file (`lhftips.db`) with all required tables.

### Show Configuration

```bash
node src/index.js config
```

Displays current settings from `config/settings.json`.

### Scrape Data

#### Scrape match results

```bash
node src/index.js scrape results [options]
```

| Option | Description |
|--------|-------------|
| `--no-goalscorers` | Skip scraping individual goalscorers |
| `--dry-run` | Preview without saving to database |

#### Scrape guesses from forum

```bash
node src/index.js scrape guesses [options]
```

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Output CSV file (default: `guesses.csv`) |
| `-p, --start-page <n>` | Start from a specific page number (overrides the saved cursor) |
| `-m, --max-pages <n>` | Maximum forum pages to scrape (default: 100) |
| `-a, --append` | Append to the existing CSV file instead of overwriting |
| `--fresh` | Ignore the saved cursor and re-scrape the whole thread from page 1 |

**Incremental scraping:** by default this command resumes from a saved
per-thread cursor (`data/scrape-state.json`, keyed by forum thread id) rather
than re-fetching and re-parsing the whole thread every time. The cursor
tracks both the last page reached (so old pages aren't re-fetched) and the
highest forum post id seen (so even an overlapping page never gets
re-parsed — post ids only ever increase). Use `--fresh` for a one-off full
re-scrape (e.g. after fixing a parser bug and wanting to regenerate the
whole CSV).

#### Review and fix unparsed guesses

```bash
node src/index.js review [options]
```

Opens a local web UI (default `http://127.0.0.1:4321/`) listing every
pending `#` line in the CSV. Each item shows the original post text, badges
for which pieces were recognized (datum/lag/resultat/målskytt), and an edit
box prefilled with the best-guess reconstruction — posts that parse with the
*current* parser (after parser improvements) are one-click accepts. Saving a
fix validates the text through the real parser, inserts the corrected CSV
row **directly below the commented original**, and re-marks the comment
`#[fixed]`. Dismissing chatter re-marks it `#[dismissed]`. Both markers
still start with `#`, so `import guesses` ignores them as before, and
handled items never reappear in the UI.

| Option | Description |
|--------|-------------|
| `-f, --file <file>` | Guesses CSV file (default: `guesses.csv`) |
| `-p, --port <n>` | Local port for the UI (default: 4321) |
| `--no-open` | Don't open the browser automatically |

### Calculate Scores

```bash
node src/index.js calculate [options]
```

| Option | Description |
|--------|-------------|
| `--from <date>` | Start date (YYYY-MM-DD) |
| `--to <date>` | End date (YYYY-MM-DD) |
| `--match <id>` | Calculate for specific match ID only |
| `--dry-run` | Preview scores without saving |

### Generate Reports

#### Full leaderboard

```bash
node src/index.js report
```

#### Date range report (e.g., playoffs)

```bash
node src/index.js report --from 2025-03-15 --to 2025-05-01
```

#### Individual user report

```bash
node src/index.js report --user "Ransen67"
```

| Option | Description |
|--------|-------------|
| `--from <date>` | Start date (YYYY-MM-DD) |
| `--to <date>` | End date (YYYY-MM-DD) |
| `--user <name>` | Show details for specific user |
| `--limit <n>` | Limit leaderboard rows (default: 50) |

## Scoring System

Each match prediction can earn a maximum of **7 points**:

| Points | Criteria | Description |
|--------|----------|-------------|
| 3 | Exact Result | Predicted score matches exactly (e.g., 3-1 = 3-1) |
| 1 | Correct Outcome | Predicted win/loss/draw matches actual outcome for Luleå |
| 1 | Correct Scorer | Predicted goalscorer scored at least one goal |
| 1 | Luleå Goals | Predicted number of Luleå goals is correct |
| 1 | Goals Conceded | Predicted goals against Luleå is correct |

### Scoring Examples

**Match result: Luleå 4-2 Skellefteå (Omark scored)**

| Prediction | Exact | Outcome | Scorer | LHF Goals | Conceded | Total |
|------------|-------|---------|--------|-----------|----------|-------|
| 4-2, Omark | 3 | 1 | 1 | 1 | 1 | **7** |
| 3-2, Omark | 0 | 1 | 1 | 0 | 1 | **3** |
| 4-1, Emanuelsson | 0 | 1 | 0 | 1 | 0 | **2** |
| 2-3, Omark | 0 | 0 | 1 | 0 | 0 | **1** |

## Guess Format

### Expected Format

```
YYYY-MM-DD, Home Team - Away Team, X-Y, Scorer Name
```

### Examples

```
2024-09-14, Oskarshamn - Luleå, 1-3, Linus Omark
2024-09-16, Luleå - Skellefteå, 3-2, Emanuelsson
2024-09-21, LHF - Frölunda, 4-1, Brännström
```

### Format Tolerance

The parser handles various input styles:

| Variation | Example |
|-----------|---------|
| Date formats | `2024-09-14`, `14/09/2024`, `14/9`, `14.09` |
| Team abbreviations | `LHF`, `Luleå`, `Lansen`, `SAIK`, `Skansen` |
| Score separators | `3-1`, `3 - 1`, `3:1` |
| Field separators | Comma, semicolon, or mixed |
| Colon before score | `Luleå - Timrå: 3-4, Hanzl` (`:` treated like `,`) |
| Scorer glued to score | `3-4 Hanzl` (no comma between score and scorer) |
| Scorer optional | Can omit scorer for 6 max points |

See [`docs/PIPELINE.md`](docs/PIPELINE.md) for a diagram of the full
scrape → parse → import → calculate → publish flow.

### Team Name Aliases

| Canonical Name | Accepted Aliases |
|----------------|------------------|
| Luleå HF | LHF, Luleå, Lansen, Lulea |
| Skellefteå AIK | SAIK, Skellefteå, Skansen |
| Frölunda HC | FHC, Frölunda, Frolunda, Indansen |
| Färjestad BK | FBK, Färjestad, Farjestad |
| Djurgårdens IF | DIF, Djurgården, Djurgarden |
| Rögle BK | RBK, Rögle, Rogle |
| Växjö Lakers | VXL, Växjö, Lakers |
| IK Oskarshamn | IKO, Oskarshamn |
| HV71 | HV, HV71 |
| And more... | |

### Duplicate Guess Handling

When a user posts multiple guesses for the same match:
- Only guesses posted **before** match start time are valid
- The **latest** valid guess is used for scoring
- Guesses posted after match start are discarded

## Database Model

### Entity Relationship Diagram

```
┌─────────────────────┐
│       users         │
├─────────────────────┤
│ PK id               │
│ UK forum_username   │
└──────────┬──────────┘
           │
           │ 1
           │
           │                       ┌─────────────────────┐
           │                       │      matches        │
           │                       ├─────────────────────┤
           │                       │ PK id               │
           │                       │    swehockey_       │
           │                       │     game_id         │
           │                       │    match_date       │
           │                       │    match_time       │
           │                       │    home_team        │
           │                       │    away_team        │
           │                       │    home_score       │
           │                       │    away_score       │
           │                       │    is_overtime      │
           │                       │    lulea_is_home    │
           │                       └──────────┬──────────┘
           │                                  │
           │                         ┌────────┴────────┐
           │                         │ 1               │ 1
           │                         │                 │
           │                         ▼ *               ▼ *
           │              ┌─────────────────┐  ┌─────────────────┐
           │              │   goalscorers   │  │                 │
           │              ├─────────────────┤  │                 │
           │              │ PK id           │  │                 │
           │              │ FK match_id     │  │                 │
           │              │    player_name  │  │                 │
           │              │    team         │  │                 │
           │              │    period       │  │                 │
           │              │    goal_time    │  │                 │
           │              └─────────────────┘  │                 │
           │                                   │                 │
           │ *                                 │                 │
           └───────────────────────────────────┤                 │
                                               │                 │
                                    ┌──────────┴──────────┐      │
                                    │      guesses        │      │
                                    ├─────────────────────┤      │
                                    │ PK id               │◄─────┘
                                    │ FK user_id          │
                                    │ FK match_id         │
                                    │    post_timestamp   │
                                    │    raw_text         │
                                    │    predicted_       │
                                    │     home_score      │
                                    │    predicted_       │
                                    │     away_score      │
                                    │    predicted_scorer │
                                    │    is_valid         │
                                    └──────────┬──────────┘
                                               │
                                               │ 1
                                               │
                                               ▼ 1
                                    ┌─────────────────────┐
                                    │       scores        │
                                    ├─────────────────────┤
                                    │ PK id               │
                                    │ FK guess_id (UK)    │
                                    │    exact_result_pts │
                                    │    outcome_pts      │
                                    │    scorer_pts       │
                                    │    lulea_goals_pts  │
                                    │    lulea_conceded_  │
                                    │     pts             │
                                    │    total_pts        │
                                    └─────────────────────┘
```

### Tables

| Table | Description |
|-------|-------------|
| `users` | Forum users who submitted predictions |
| `matches` | Hockey matches from swehockey |
| `goalscorers` | Goals scored in each match |
| `guesses` | User predictions for matches |
| `scores` | Calculated points for each prediction |

## Examples

### Complete Workflow

```bash
# Initial setup
node src/index.js init

# Edit config/settings.json with your URLs

# Daily update routine
node src/index.js scrape results
node src/index.js scrape guesses
node src/index.js calculate

# View results
node src/index.js report
```

### Sample Leaderboard Output

```
┌───┬────────────────┬─────────┬───────┬───────┬─────────┬────────┬───────────┬──────────┬──────┐
│ # │ User           │ Matches │ Total │ Exact │ Outcome │ Scorer │ LHF Goals │ Conceded │ Avg  │
├───┼────────────────┼─────────┼───────┼───────┼─────────┼────────┼───────────┼──────────┼──────┤
│ 1 │ HockeyKansen   │      52 │   187 │    24 │      38 │     21 │        32 │       28 │ 3.60 │
│ 2 │ Ransen67       │      51 │   178 │    21 │      36 │     23 │        30 │       26 │ 3.49 │
│ 3 │ BlåvittBlod    │      50 │   165 │    18 │      34 │     19 │        31 │       25 │ 3.30 │
└───┴────────────────┴─────────┴───────┴───────┴─────────┴────────┴───────────┴──────────┴──────┘

--- Summary ---
Total participants: 47
Matches in database: 52 (52 played)
Max matches guessed: 52
Highest total score: 187
```

### Date Range Reports

```bash
# Regular season only
node src/index.js report --from 2024-09-14 --to 2025-03-14

# Playoffs only
node src/index.js report --from 2025-03-15 --to 2025-05-15

# Specific month
node src/index.js report --from 2024-12-01 --to 2024-12-31
```

### Dry Run Mode

Preview what would be scraped/calculated without modifying the database:

```bash
# Preview scraping
node src/index.js scrape results --dry-run
node src/index.js scrape guesses --dry-run

# Preview score calculation
node src/index.js calculate --dry-run
```

## Development

### Running Tests

```bash
npm test
```

### Project Structure

```
LHFTips/
├── config/
│   └── settings.json       # Configuration (edit this!)
├── src/
│   ├── index.js            # CLI entry point
│   ├── config.js           # Config loader
│   ├── commands/           # Command handlers
│   ├── scrapers/           # Web scraping logic
│   ├── parsers/            # Input parsing
│   ├── db/                 # Database layer
│   └── utils/              # Utility functions
├── tests/                  # Unit tests
└── lhftips.db             # SQLite database (generated)
```

## Troubleshooting

### Common Issues

**"Forum URL not configured"**
- Edit `config/settings.json` and set the `forumUrl` field

**"Invalid swehockey URL"**
- Make sure the URL contains `/Schedule/` followed by a number
- Example: `https://stats.swehockey.se/ScheduleAndResults/Schedule/18263`

**Empty leaderboard**
- Ensure results are scraped before guesses
- Run `calculate` after both scraping commands
- Check `--dry-run` output to verify data is being parsed

**Guesses not matching**
- Verify guess format follows expected pattern
- Check that team names are recognized
- Ensure dates match actual match dates in the database

## License

MIT
