#!/usr/bin/env node

import { Command } from 'commander';
import { initDatabase, closeDatabase } from './db/database.js';
import { loadConfig, validateConfig, getConfigPath } from './config.js';
import scrapeGuesses from './commands/scrape-guesses.js';
import importGuesses from './commands/import-guesses.js';
import scrapeResults from './commands/scrape-results.js';
import calculateScores from './commands/calculate-scores.js';
import generateReport from './commands/report.js';
import syncRoster from './commands/sync-roster.js';
import mapPlayer from './commands/map-player.js';
import generateStandings from './commands/standings.js';
import publishStandings from './commands/publish-standings.js';
import reviewGuesses from './commands/review-guesses.js';

const program = new Command();

program
  .name('lhftips')
  .description('Hockey prediction competition scoring for Luleå Hockey Forum')
  .version('1.0.0');

// Initialize database command
program
  .command('init')
  .description('Initialize the database')
  .action(async () => {
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully.');
    closeDatabase();
  });

// Config command - show current configuration
program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    const validation = validateConfig(config);

    console.log(`\nConfiguration file: ${getConfigPath()}`);
    console.log('\nCurrent settings:');
    console.log(`  Forum URL:     ${config.forumUrl || '(not set)'}`);
    console.log(`  Swehockey URL: ${config.swehockeyUrl || '(not set)'}`);
    console.log(`  Team:          ${config.team || '(not set)'}`);

    if (!validation.valid) {
      console.log('\nWarnings:');
      for (const error of validation.errors) {
        console.log(`  - ${error}`);
      }
    }

    console.log('\nEdit config/settings.json to change these values.');
  });

// Scrape commands
const scrapeCmd = program
  .command('scrape')
  .description('Scrape data from external sources');

scrapeCmd
  .command('guesses')
  .description('Scrape guesses from forum and save to CSV file (resumes from the saved cursor by default)')
  .option('-o, --output <file>', 'Output CSV file', 'guesses.csv')
  .option('-p, --start-page <n>', 'Start from page number (overrides the saved cursor)')
  .option('-m, --max-pages <n>', 'Maximum pages to scrape', '100')
  .option('-a, --append', 'Append to existing CSV file')
  .option('--fresh', 'Ignore the saved cursor and re-scrape the whole thread from page 1')
  .action(async (options) => {
    await scrapeGuesses({
      output: options.output,
      startPage: options.startPage ? parseInt(options.startPage, 10) : null,
      maxPages: parseInt(options.maxPages, 10),
      append: options.append,
      fresh: options.fresh
    });
  });

scrapeCmd
  .command('results')
  .description('Scrape match results from swehockey')
  .option('--no-goalscorers', 'Skip scraping goalscorers')
  .option('--dry-run', 'Preview without saving')
  .action(async (options) => {
    await initDatabase();
    await scrapeResults({
      includeGoalscorers: options.goalscorers !== false,
      dryRun: options.dryRun
    });
    closeDatabase();
  });

// Sync commands
const syncCmd = program
  .command('sync')
  .description('Sync reference data (roster, ...)');

syncCmd
  .command('roster')
  .description('Sync the club roster into the player registry')
  .option('--url <url>', 'Roster page URL (defaults to config.rosterUrl)')
  .option('--season <season>', 'Season label, e.g. 2026-27 (defaults to current)')
  .option('--new-season', 'Between-seasons reconcile: deactivate players no longer on the roster')
  .option('--dry-run', 'Preview the registry diff without saving')
  .action(async (options) => {
    await syncRoster({
      url: options.url,
      season: options.season,
      mode: options.newSeason ? 'new-season' : 'in-season',
      dryRun: options.dryRun
    });
  });

// Import commands
const importCmd = program
  .command('import')
  .description('Import data from files');

importCmd
  .command('guesses <csvfile>')
  .description('Import guesses from CSV file into database')
  .option('--from <date>', 'Only import matches from this date (YYYY-MM-DD)')
  .option('--dry-run', 'Preview without saving')
  .action(async (csvfile, options) => {
    await initDatabase();
    await importGuesses(csvfile, {
      from: options.from,
      dryRun: options.dryRun
    });
    closeDatabase();
  });

// Review UI: fix/dismiss unparsed guesses (# lines) in the CSV
program
  .command('review')
  .description('Open a local web UI to fix unparsed guesses and rule on unresolved goalscorers')
  .option('-f, --file <file>', 'Guesses CSV file', 'guesses.csv')
  .option('-p, --port <n>', 'Local port for the UI', '4321')
  .option('-d, --db <file>', 'Database file (for the scorer queue)', 'lhftips.db')
  .option('--no-open', 'Do not open the browser automatically')
  .action(async (options) => {
    await reviewGuesses({
      file: options.file,
      port: parseInt(options.port, 10),
      db: options.db,
      open: options.open
    });
  });

// Map a nickname/spelling to a canonical player (clears SCORER_UNMATCHED)
program
  .command('map-player <canonical> <spelling>')
  .description('Map a nickname/spelling to a canonical player in the registry')
  .action(async (canonical, spelling) => {
    await mapPlayer(canonical, spelling);
  });

// Calculate scores command
program
  .command('calculate')
  .description('Calculate scores for guesses')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--match <id>', 'Calculate for specific match only')
  .option('--dry-run', 'Preview without saving')
  .action(async (options) => {
    await initDatabase();
    await calculateScores({
      from: options.from,
      to: options.to,
      matchId: options.match,
      dryRun: options.dryRun
    });
    closeDatabase();
  });

// Standings command - forum-ready leaderboard post
program
  .command('standings')
  .description('Generate a forum-ready standings post (monospace, to paste into the thread)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--round <label>', 'Round label, e.g. "omgång 12" (default: auto from played games)')
  .option('-o, --output <file>', 'Output file', 'standings.txt')
  .action(async (options) => {
    await initDatabase();
    await generateStandings({
      from: options.from,
      to: options.to,
      round: options.round,
      output: options.output
    });
    closeDatabase();
  });

// Publish standings to the forum thread (dry-run by default; --preview / --post)
program
  .command('publish')
  .description('Publish standings to the forum thread (dry-run by default; needs LHF_FORUM_USER/PASS)')
  .requiredOption('--target <url>', 'Forum thread URL to post to')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--round <label>', 'Round label, e.g. "omgång 12"')
  .option('--subject <text>', 'Post subject (default: reply subject from the form)')
  .option('--preview', 'Stage C: submit to the Preview endpoint (publishes nothing)')
  .option('--post', 'Stage E: actually publish (also requires --confirm)')
  .option('--confirm', 'Confirm a real --post')
  .option('--dump-form <file>', 'Save the raw reply-form HTML (for Stage-A fixtures)')
  .action(async (options) => {
    await initDatabase();
    await publishStandings({
      target: options.target,
      from: options.from,
      to: options.to,
      round: options.round,
      subject: options.subject,
      preview: options.preview,
      post: options.post,
      confirm: options.confirm,
      dumpForm: options.dumpForm
    });
    closeDatabase();
  });

// Report command
program
  .command('report')
  .description('Generate score reports')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--user <name>', 'Show details for specific user')
  .option('--limit <n>', 'Limit leaderboard results', '50')
  .action(async (options) => {
    await initDatabase();
    await generateReport({
      from: options.from,
      to: options.to,
      user: options.user,
      limit: parseInt(options.limit, 10)
    });
    closeDatabase();
  });

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('Error:', error.message);
  closeDatabase();
  process.exit(1);
});

// Parse arguments
program.parse();
