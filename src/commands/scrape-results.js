import { upsertMatch, getMatch, clearGoalscorers, addGoalscorer } from '../db/queries.js';
import { scrapeSchedule, scrapeGameEvents } from '../scrapers/swehockey-scraper.js';
import { loadConfig, validateConfig, extractScheduleId } from '../config.js';

/**
 * Scrape results command handler
 * @param {object} options - Command options
 */
export async function scrapeResults(options = {}) {
  const { includeGoalscorers = true, dryRun = false } = options;

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

  // Save matches to database
  let savedCount = 0;
  let updatedCount = 0;

  for (const match of matches) {
    const result = await upsertMatch(match);

    if (result.changes > 0) {
      if (result.lastInsertRowid) {
        savedCount++;
      } else {
        updatedCount++;
      }
    }
  }

  console.log(`\nMatches:`);
  console.log(`  New: ${savedCount}`);
  console.log(`  Updated: ${updatedCount}`);

  // Scrape goalscorers if requested
  if (includeGoalscorers) {
    console.log('\nScraping goalscorers...');

    let goalsCount = 0;
    let matchesWithGoals = 0;

    for (const match of matches) {
      if (!match.swehockeyGameId || match.homeScore === null) {
        continue;
      }

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
