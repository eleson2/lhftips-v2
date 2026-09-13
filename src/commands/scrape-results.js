import { upsertMatch, getMatch, getGoalscorers, clearGoalscorers, addGoalscorer } from '../db/queries.js';
import { scrapeSchedule, scrapeGameEvents } from '../scrapers/swehockey-scraper.js';
import { loadConfig, validateConfig, extractScheduleId } from '../config.js';

/**
 * Decide whether a game's events page still needs fetching.
 *
 * Re-reading the events page of a game played in October, every time the
 * scraper runs in March, is the bulk of the work in a late-season run and
 * learns nothing. This is the rule that avoids it, kept pure so the decision is
 * testable without a network or a database.
 *
 * Fetch when: the game is played AND (we hold no goalscorers for it, or its
 * result has moved since we last looked, or a refresh was asked for).
 *
 * @param {{ homeScore:number|null, awayScore:number|null, isOvertime:number|boolean, swehockeyGameId:number|null }} scraped
 *        the row just read from the schedule
 * @param {{ home_score:number|null, away_score:number|null, is_overtime:number }|null} stored
 *        what the database held BEFORE this run's upsert, or null if new
 * @param {number} storedGoalCount  goalscorers already recorded for it
 * @param {boolean} refresh         --refresh-goalscorers was passed
 * @returns {boolean}
 */
export function needsGoalscorerFetch(scraped, stored, storedGoalCount, refresh = false) {
  if (!scraped.swehockeyGameId) return false;   // nothing to fetch by
  if (scraped.homeScore === null) return false; // not played yet
  if (refresh) return true;
  if (!stored) return true;                     // never seen before
  if (storedGoalCount === 0) return true;       // played, but we hold no goals

  const scoreMoved =
    stored.home_score !== scraped.homeScore ||
    stored.away_score !== scraped.awayScore ||
    Boolean(stored.is_overtime) !== Boolean(scraped.isOvertime);

  return scoreMoved;
}

/**
 * Scrape results command handler
 * @param {object} options - Command options
 */
export async function scrapeResults(options = {}) {
  const { includeGoalscorers = true, dryRun = false, refreshGoalscorers = false } = options;

  // Load and validate config
  const config = loadConfig();

  if (!config.swehockeyUrl) {
    console.error('Swehockey URL not configured. Edit config/settings.json');
    process.exit(1);
  }

  const scheduleId = extractScheduleId(config.swehockeyUrl);
  if (!scheduleId) {
    console.error('Invalid swehockey URL. Should contain /Schedule/XXXXX');
    console.error(`Current URL: ${config.swehockeyUrl}`);
    process.exit(1);
  }

  console.log(`\nScraping results from swehockey`);
  console.log(`URL: ${config.swehockeyUrl}`);
  console.log('');

  // Scrape schedule
  const matches = await scrapeSchedule(scheduleId);

  console.log(`Found ${matches.length} Luleå matches`);

  if (dryRun) {
    console.log('\nDry run - not saving to database');
    console.log('\nMatches:');
    for (const match of matches.slice(0, 10)) {
      const score = match.homeScore !== null
        ? `${match.homeScore}-${match.awayScore}${match.isOvertime ? ' (OT)' : ''}`
        : 'TBD';
      console.log(`  ${match.matchDate}: ${match.homeTeam} ${score} ${match.awayTeam}`);
    }
    if (matches.length > 10) {
      console.log(`  ... and ${matches.length - 10} more`);
    }
    return;
  }

  // Save matches to database.
  //
  // The stored score is read BEFORE upserting, because it is what decides
  // whether this game's goalscorers still need fetching. After the upsert the
  // stored score always equals the scraped one, so the comparison has to happen
  // here or not at all.
  let savedCount = 0;
  let updatedCount = 0;
  const needGoalscorers = [];
  let skippedGoalscorers = 0;

  for (const match of matches) {
    const before = await getMatch(match.matchDate, match.homeTeam, match.awayTeam);
    const result = await upsertMatch(match);

    if (result.changes > 0) {
      if (result.lastInsertRowid) {
        savedCount++;
      } else {
        updatedCount++;
      }
    }

    if (!includeGoalscorers) continue;
    if (!match.swehockeyGameId || match.homeScore === null) continue;

    const storedGoals = before ? (await getGoalscorers(before.id)).length : 0;

    if (needsGoalscorerFetch(match, before, storedGoals, refreshGoalscorers)) {
      needGoalscorers.push(match);
    } else {
      skippedGoalscorers++;
    }
  }

  console.log(`\nMatches:`);
  console.log(`  New: ${savedCount}`);
  console.log(`  Updated: ${updatedCount}`);

  // Scrape goalscorers if requested
  if (includeGoalscorers) {
    if (skippedGoalscorers > 0) {
      console.log(`\nGoalscorers already stored for ${skippedGoalscorers} unchanged game(s) — not re-fetched.`);
    }

    if (needGoalscorers.length === 0) {
      console.log('Nothing new to fetch.');
      return;
    }

    console.log(`\nScraping goalscorers for ${needGoalscorers.length} game(s)...`);

    let goalsCount = 0;
    let matchesWithGoals = 0;

    for (const match of needGoalscorers) {
      try {
        // Get the match from database to get its ID
        const dbMatch = await getMatch(match.matchDate, match.homeTeam, match.awayTeam);
        if (!dbMatch) continue;

        // Wait to be respectful
        await new Promise(resolve => setTimeout(resolve, 500));

        const goalscorers = await scrapeGameEvents(match.swehockeyGameId);

        if (goalscorers.length > 0) {
          // Clear existing goalscorers and add new ones
          await clearGoalscorers(dbMatch.id);

          for (const goal of goalscorers) {
            await addGoalscorer(
              dbMatch.id,
              goal.playerName,
              goal.team || 'Unknown',
              goal.period,
              goal.goalTime
            );
          }

          goalsCount += goalscorers.length;
          matchesWithGoals++;

          console.log(`  ${match.matchDate}: ${match.homeTeam} vs ${match.awayTeam} - ${goalscorers.length} goals`);
        }
      } catch (error) {
        console.error(`  Error scraping game ${match.swehockeyGameId}:`, error.message);
      }
    }

    console.log(`\nGoalscorers:`);
    console.log(`  Total goals: ${goalsCount}`);
    console.log(`  Matches with goals: ${matchesWithGoals}`);
  }
}

export default scrapeResults;
