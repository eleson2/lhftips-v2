import { readFileSync } from 'fs';
import { parse as parseCSV } from 'csv-parse/sync';
import { getOrCreateUser, getMatchByDateAndTeams, upsertGuess } from '../db/queries.js';
import { beginTransaction, commit, rollback } from '../db/database.js';
import { parseISO, isBefore, parse } from 'date-fns';
import { ReviewCollector, REVIEW } from '../utils/review.js';

/**
 * Check if a guess was posted before match start
 */
function isGuessValid(postTimestamp, matchDate, matchTime) {
  if (!postTimestamp) return true; // Assume valid if no timestamp

  try {
    const postDate = parseISO(postTimestamp);
    const matchTimeStr = matchTime || '00:00';
    const matchDateTime = parse(
      `${matchDate} ${matchTimeStr}`,
      'yyyy-MM-dd HH:mm',
      new Date()
    );
    return isBefore(postDate, matchDateTime);
  } catch {
    return true; // Assume valid on parse error
  }
}

/**
 * Import guesses from CSV file
 * @param {string} csvFile - Path to CSV file
 * @param {object} options - Command options
 */
export async function importGuesses(csvFile, options = {}) {
  const { from: fromDate = null, dryRun = false } = options;

  console.log(`\nImporting guesses from: ${csvFile}`);
  if (fromDate) {
    console.log(`Only importing matches from: ${fromDate}`);
  }
  console.log('');

  // Read and parse CSV file
  let records;
  try {
    const content = readFileSync(csvFile, 'utf-8');
    records = parseCSV(content, {
      columns: true,
      skip_empty_lines: true,
      comment: '#',
      trim: true,
      relax_quotes: true,
      relax_column_count: true
    });
  } catch (error) {
    console.error(`Error reading/parsing CSV: ${error.message}`);
    process.exit(1);
  }

  if (records.length === 0) {
    console.log('CSV file is empty or has no data rows.');
    return;
  }

  // Verify required columns exist
  const firstRecord = records[0];
  if (!('username' in firstRecord) || !('date' in firstRecord)) {
    console.error('Invalid CSV format. Expected columns: username,timestamp,date,home_team,away_team,home_score,away_score,scorer,raw_text');
    process.exit(1);
  }

  // Process data rows
  let savedCount = 0;
  let skippedInvalid = 0;
  let skippedNoMatch = 0;
  let skippedDate = 0;
  let skippedAfterMatch = 0;
  const review = new ReviewCollector();

  // Use transaction for bulk import (only if not dry run)
  if (!dryRun) {
    beginTransaction();
  }

  try {
    for (const record of records) {
      const username = record.username || '';
      const timestamp = record.timestamp || '';
      const date = record.date || '';
      const homeTeam = record.home_team || '';
      const awayTeam = record.away_team || '';
      const homeScore = record.home_score ? parseInt(record.home_score, 10) : null;
      const awayScore = record.away_score ? parseInt(record.away_score, 10) : null;
      const scorer = record.scorer || '';
      const rawText = record.raw_text || '';

      // Skip if missing required fields
      if (!username || !date || !homeTeam || !awayTeam || homeScore === null || awayScore === null) {
        skippedInvalid++;
        review.add(REVIEW.INCOMPLETE, { username, date, detail: 'missing required field(s)', raw: rawText });
        continue;
      }

      // Skip if before fromDate filter
      if (fromDate && date < fromDate) {
        skippedDate++;
        continue;
      }

      // Find matching match in database
      const match = await getMatchByDateAndTeams(date, homeTeam, awayTeam);

      if (!match) {
        if (!dryRun) {
          console.log(`  No match found: ${date} ${homeTeam} vs ${awayTeam}`);
        }
        skippedNoMatch++;
        review.add(REVIEW.DATE_NO_FIXTURE, {
          username, date, detail: `${homeTeam} vs ${awayTeam}`, raw: rawText,
        });
        continue;
      }

      // Check if guess was posted before match start
      const isValid = isGuessValid(timestamp, match.match_date, match.match_time);

      if (!isValid) {
        skippedAfterMatch++;
        review.add(REVIEW.LATE, {
          username, date, detail: `posted ${timestamp} vs match ${match.match_date} ${match.match_time || ''}`.trim(),
          raw: rawText,
        });
        continue;
      }

      if (dryRun) {
        console.log(`  ${username}: ${date} ${homeTeam} ${homeScore}-${awayScore} ${awayTeam}${scorer ? ', ' + scorer : ''}`);
      } else {
        // Get or create user
        const user = await getOrCreateUser(username);

        // Save guess
        const result = await upsertGuess(
          user.id,
          match.id,
          timestamp,
          rawText,
          homeScore,
          awayScore,
          scorer || null,
          true
        );

        if (result.changes > 0) {
          savedCount++;
        }
      }
    }

    // Commit transaction
    if (!dryRun) {
      commit();
    }
  } catch (error) {
    // Rollback on error
    if (!dryRun) {
      rollback();
    }
    throw error;
  }

  console.log(`\nResults:`);
  console.log(`  Imported: ${dryRun ? '(dry run)' : savedCount}`);
  console.log(`  Skipped (invalid/marked with #): ${skippedInvalid}`);
  console.log(`  Skipped (no match in database): ${skippedNoMatch}`);
  console.log(`  Skipped (posted after match): ${skippedAfterMatch}`);
  if (fromDate) {
    console.log(`  Skipped (before ${fromDate}): ${skippedDate}`);
  }

  console.log(`\nReview:`);
  review.printSummary();
  if (review.count > 0 && !dryRun) {
    const path = review.writeReport('review-report.txt');
    console.log(`  Wrote ${path}`);
  }

  if (dryRun) {
    console.log('\nDry run - no data was saved');
  }
}

export default importGuesses;
