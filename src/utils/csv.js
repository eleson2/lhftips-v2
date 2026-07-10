/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 */
export function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build one guesses.csv row (username,timestamp,date,home_team,away_team,
 * home_score,away_score,scorer,raw_text) from a parsed guess.
 */
export function guessToCsvRow(guess, username, timestamp) {
  return [
    escapeCSV(username),
    escapeCSV(timestamp || ''),
    guess.date,
    escapeCSV(guess.homeTeam),
    escapeCSV(guess.awayTeam),
    guess.homeScore,
    guess.awayScore,
    escapeCSV(guess.scorer || ''),
    escapeCSV(guess.rawText)
  ].join(',');
}
