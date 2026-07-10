import axios from 'axios';
import * as cheerio from 'cheerio';
import { matchTeam, isLulea, isKnownTeam } from '../utils/team-matcher.js';

const BASE_URL = 'https://stats.swehockey.se';

/**
 * Parse matches from the schedule page
 * The swehockey schedule has a complex structure where:
 * - Result links contain the game ID in href (Game/Events/ID)
 * - Teams are in the cell before the result, formatted as "Home\n-\nAway"
 * - Date appears once per day and applies to subsequent games
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {object[]} - Array of match data
 */
export function parseSchedulePage($) {
  const matches = [];
  let currentDate = null;

  // Process all rows in order to track the current date
  $('tr').each((i, row) => {
    const $row = $(row);
    const rowText = $row.text();

    // Check if this row contains a date
    const dateMatch = rowText.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      currentDate = dateMatch[1];
    }

    // Identify the teams cell: a <td> reading "Home - Away" where BOTH sides are
    // known teams. This works whether or not the game has been played (unplayed
    // fixtures have no result link to anchor on). The known-team check also
    // rejects lookalike cells such as a "5 - 2" score.
    let homeTeam = null;
    let awayTeam = null;
    $row.find('td').each((j, td) => {
      if (homeTeam) return;
      const cellText = $(td).text().replace(/\s+/g, ' ').trim();
      const m = cellText.match(/^(.+?)\s+-\s+(.+)$/);
      if (!m) return;
      if (isKnownTeam(m[1].trim()) && isKnownTeam(m[2].trim())) {
        homeTeam = matchTeam(m[1].trim());
        awayTeam = matchTeam(m[2].trim());
      }
    });

    if (!homeTeam || !awayTeam) return; // not a game row
    if (!currentDate) return; // no date context yet
    // Only include Luleå matches
    if (!isLulea(homeTeam) && !isLulea(awayTeam)) return;

    // Result, game id and overtime are optional — absent for unplayed fixtures.
    let homeScore = null;
    let awayScore = null;
    let isOvertime = false;
    let gameId = null;

    const $resultLink = $row.find('a[href*="Game/Events"]');
    if ($resultLink.length > 0) {
      const gameIdMatch = ($resultLink.attr('href') || '').match(/Game\/Events\/(\d+)/);
      if (gameIdMatch) gameId = parseInt(gameIdMatch[1], 10);

      const resultMatch = $resultLink.text().trim().match(/(\d+)\s*-\s*(\d+)/);
      if (resultMatch) {
        homeScore = parseInt(resultMatch[1], 10);
        awayScore = parseInt(resultMatch[2], 10);
      }

      // Overtime shows as 4 period scores like "(1-0, 2-1, 0-1, 0-1)".
      const periodText = $resultLink.closest('td').next('td').text();
      if (periodText.match(/\([^)]+,[^)]+,[^)]+,[^)]+\)/)) {
        isOvertime = true;
      }
    }

    // Get time from row
    const timeMatch = rowText.match(/(\d{2}:\d{2})/);
    const matchTime = timeMatch ? timeMatch[1] : null;

    matches.push({
      matchDate: currentDate,
      matchTime,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      isOvertime,
      luleaIsHome: isLulea(homeTeam),
      swehockeyGameId: gameId
    });
  });

  return matches;
}

/**
 * Scrape the schedule for a season
 * @param {number} scheduleId - Swehockey schedule ID
 * @returns {Promise<object[]>} - Array of match data
 */
export async function scrapeSchedule(scheduleId) {
  const url = `${BASE_URL}/ScheduleAndResults/Schedule/${scheduleId}`;

  console.log(`Scraping schedule from: ${url}`);

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8'
    },
    timeout: 30000
  });

  const $ = cheerio.load(response.data);
  const matches = parseSchedulePage($);

  console.log(`Found ${matches.length} Luleå matches`);
  return matches;
}

/**
 * Parse goals from the game events page
 * The swehockey events page has goals in table rows with format:
 * Cell 0: Time (e.g., "13:53")
 * Cell 1: Score (e.g., "1-0 (EQ)")
 * Cell 2: Team abbreviation (e.g., "LHF")
 * Cell 3: Player info (e.g., "29. Gustafsson, Erik (2) ...")
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {object[]} - Array of goal data
 */
function parseGoalsFromPage($) {
  const goals = [];

  $('tr').each((i, row) => {
    const $row = $(row);
    const cells = $row.find('td');

    if (cells.length < 4) return;

    // Check if this is a goal row - cell 1 should have score pattern like "1-0"
    const scoreCell = $(cells[1]).text().trim();
    const scoreMatch = scoreCell.match(/^(\d+)-(\d+)/);
    if (!scoreMatch) return;

    const time = $(cells[0]).text().trim();
    const team = $(cells[2]).text().trim();
    const playerText = $(cells[3]).text().trim().replace(/\s+/g, ' ');

    // Parse player: "29. LastName, FirstName (goals) ..."
    const playerMatch = playerText.match(/(\d+)\.\s*([A-Za-zÅÄÖåäö'-]+),?\s*([A-Za-zÅÄÖåäö'-]*)/);

    if (playerMatch) {
      const lastName = playerMatch[2];
      const firstName = playerMatch[3] || '';
      const playerName = firstName ? `${firstName} ${lastName}` : lastName;

      // Determine period from time (rough estimate)
      const timeMatch = time.match(/(\d+):(\d+)/);
      let period = null;
      if (timeMatch) {
        const minutes = parseInt(timeMatch[1], 10);
        if (minutes <= 20) period = 1;
        else if (minutes <= 40) period = 2;
        else if (minutes <= 60) period = 3;
        else period = 4; // OT
      }

      goals.push({
        playerName,
        team,
        goalTime: time,
        period
      });
    }
  });

  return goals;
}

/**
 * Scrape goalscorers for a specific game
 * @param {number} gameId - Swehockey game ID
 * @returns {Promise<object[]>} - Array of goalscorer data
 */
export async function scrapeGameEvents(gameId) {
  const url = `${BASE_URL}/Game/Events/${gameId}`;

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8'
    },
    timeout: 30000
  });

  const $ = cheerio.load(response.data);
  const goals = parseGoalsFromPage($);

  console.log(`Found ${goals.length} goals`);
  return goals;
}

/**
 * Scrape full details for all matches in a season
 * @param {number} scheduleId - Swehockey schedule ID
 * @param {object} options - Options
 * @param {function} options.onMatch - Callback for each match
 * @returns {Promise<object[]>} - Array of match data with goalscorers
 */
export async function scrapeSeasonWithDetails(scheduleId, options = {}) {
  const { onMatch = null } = options;

  const matches = await scrapeSchedule(scheduleId);
  const results = [];

  for (const match of matches) {
    let goalscorers = [];

    if (match.swehockeyGameId && match.homeScore !== null) {
      try {
        // Wait a bit to be respectful
        await new Promise(resolve => setTimeout(resolve, 500));

        goalscorers = await scrapeGameEvents(match.swehockeyGameId);
      } catch (error) {
        console.error(`Error scraping game ${match.swehockeyGameId}:`, error.message);
      }
    }

    const result = {
      ...match,
      goalscorers
    };

    results.push(result);

    if (onMatch) {
      onMatch(result);
    }
  }

  return results;
}
