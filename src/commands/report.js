import Table from 'cli-table3';
import { getLeaderboard, getUserStats, getMatchStats } from '../db/queries.js';

/**
 * Generate leaderboard report
 * @param {object} options - Report options
 */
export async function generateReport(options = {}) {
  const { from: fromDate = null, to: toDate = null, user = null, limit = 50 } = options;

  console.log(`\nLHFTips Report`);

  if (fromDate || toDate) {
    console.log(`Date range: ${fromDate || 'start'} to ${toDate || 'end'}`);
  } else {
    console.log('All matches');
  }

  console.log('');

  if (user) {
    // Generate user-specific report
    await generateUserReport(user, fromDate, toDate);
  } else {
    // Generate leaderboard
    await generateLeaderboardReport(fromDate, toDate, limit);
  }
}

/**
 * Generate leaderboard table
 */
async function generateLeaderboardReport(fromDate, toDate, limit) {
  const leaderboard = await getLeaderboard(fromDate, toDate);
  const matchStats = await getMatchStats(fromDate, toDate);

  if (leaderboard.length === 0) {
    console.log('No scored guesses found for this period.');
    return;
  }

  const table = new Table({
    head: ['#', 'User', 'Matches', 'Total', 'Exact', 'Outcome', 'Scorer', 'LHF Goals', 'Conceded', 'Avg'],
    style: {
      head: ['cyan'],
      border: ['grey']
    },
    colAligns: ['right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
  });

  const displayData = leaderboard.slice(0, limit);

  displayData.forEach((row, idx) => {
    table.push([
      idx + 1,
      row.forum_username,
      row.matches_guessed,
      row.total_points,
      row.exact_results,
      row.outcomes,
      row.scorers,
      row.lulea_goals,
      row.lulea_conceded,
      row.avg_points
    ]);
  });

  console.log(table.toString());

  if (leaderboard.length > limit) {
    console.log(`\n(Showing top ${limit} of ${leaderboard.length} users)`);
  }

  // Summary stats
  const totalMatches = Math.max(...leaderboard.map(r => r.matches_guessed));
  const totalParticipants = leaderboard.length;
  const maxPoints = Math.max(...leaderboard.map(r => r.total_points));

  console.log('\n--- Summary ---');
  console.log(`Total participants: ${totalParticipants}`);
  console.log(`Matches in database: ${matchStats.total_matches} (${matchStats.played_matches} played)`);
  console.log(`Max matches guessed: ${totalMatches}`);
  console.log(`Highest total score: ${maxPoints}`);
}

/**
 * Generate user-specific report
 */
async function generateUserReport(username, fromDate, toDate) {
  const userStats = await getUserStats(username, fromDate, toDate);

  if (userStats.length === 0) {
    console.log(`No scored guesses found for user "${username}".`);
    return;
  }

  console.log(`User: ${username}`);
  console.log('');

  const table = new Table({
    head: ['Date', 'Match', 'Guess', 'Result', 'Pts', 'Exact', 'Out', 'Scr', 'LHF', 'Con'],
    style: {
      head: ['cyan'],
      border: ['grey']
    },
    colWidths: [12, 25, 8, 10, 5, 6, 5, 5, 5, 5]
  });

  let totalPoints = 0;

  for (const row of userStats) {
    const matchStr = `${row.home_team.substring(0, 10)} v ${row.away_team.substring(0, 10)}`;
    const guessStr = `${row.predicted_home_score}-${row.predicted_away_score}`;
    const resultStr = `${row.home_score}-${row.away_score}${row.is_overtime ? '*' : ''}`;

    table.push([
      row.match_date,
      matchStr,
      guessStr,
      resultStr,
      row.total_pts,
      row.exact_result_pts,
      row.outcome_pts,
      row.scorer_pts,
      row.lulea_goals_pts,
      row.lulea_conceded_pts
    ]);

    totalPoints += row.total_pts;
  }

  console.log(table.toString());

  console.log('\n--- Summary ---');
  console.log(`Matches guessed: ${userStats.length}`);
  console.log(`Total points: ${totalPoints}`);
  console.log(`Average points: ${(totalPoints / userStats.length).toFixed(2)}`);

  // Point breakdown
  const exactResults = userStats.filter(r => r.exact_result_pts > 0).length;
  const outcomes = userStats.filter(r => r.outcome_pts > 0).length;
  const scorers = userStats.filter(r => r.scorer_pts > 0).length;

  console.log('');
  console.log(`Exact results: ${exactResults} (${((exactResults / userStats.length) * 100).toFixed(1)}%)`);
  console.log(`Correct outcomes: ${outcomes} (${((outcomes / userStats.length) * 100).toFixed(1)}%)`);
  console.log(`Correct scorers: ${scorers} (${((scorers / userStats.length) * 100).toFixed(1)}%)`);
}

export default generateReport;
