import { writeFileSync, existsSync, appendFileSync } from 'fs';
import { scrapeForumThread } from '../scrapers/forum-scraper.js';
import { extractGuessesFromPost } from '../parsers/guess-parser.js';
import { loadConfig } from '../config.js';
import { loadScrapeState, saveScrapeState } from '../utils/scrape-state.js';
import { guessToCsvRow } from '../utils/csv.js';

/**
 * Scrape guesses and output to CSV file
 * @param {object} options - Command options
 */
export async function scrapeGuesses(options = {}) {
  const {
    maxPages = 100,
    startPage = null,
    output = 'guesses.csv',
    append = false,
    fresh = false
  } = options;

  // Load config
  const config = loadConfig();

  if (!config.forumUrl) {
    console.error('Forum URL not configured. Edit config/settings.json');
    process.exit(1);
  }

  // Resume from the saved per-thread cursor unless --fresh was requested or
  // the caller passed an explicit --start-page.
  const cursor = fresh ? null : loadScrapeState(config.forumUrl);
  const effectiveStartPage = startPage ?? cursor?.lastPage ?? 1;
  const effectiveAppend = append || Boolean(cursor);
  const cutoffPostId = cursor?.lastPostId ?? 0;

  console.log(`\nScraping guesses from forum`);
  console.log(`URL: ${config.forumUrl}`);
  if (cursor) {
    console.log(`Resuming from saved cursor: page ${cursor.lastPage}, last post id ${cursor.lastPostId}`);
  } else if (effectiveStartPage > 1) {
    console.log(`Starting from page: ${effectiveStartPage}`);
  }
  if (effectiveAppend && !existsSync(output)) {
    console.log(`Warning: append mode is active but "${output}" doesn't exist yet — a fresh file will be created, but it won't contain any posts before page ${effectiveStartPage}. Run with --fresh if you intended a full re-scrape.`);
  }
  console.log(`Output file: ${output}`);
  console.log('');

  // Determine default year from current date
  const defaultYear = new Date().getFullYear();

  // Calculate starting offset (pages are 0-indexed with 50 posts per page)
  const startOffset = (effectiveStartPage - 1) * 50;

  // Modify URL to start from specific page if needed
  let startUrl = config.forumUrl;
  if (effectiveStartPage > 1) {
    // Forum URL pattern: /t2534p{offset}-...
    if (startUrl.match(/\/t(\d+)p\d+-/)) {
      startUrl = startUrl.replace(/\/t(\d+)p\d+-/, `/t$1p${startOffset}-`);
    } else {
      startUrl = startUrl.replace(/\/t(\d+)-/, `/t$1p${startOffset}-`);
    }
  }

  // Scrape forum posts
  let lastPageReached = effectiveStartPage;
  const posts = await scrapeForumThread(startUrl, {
    maxPages,
    onPage: (page, count) => {
      const actualPage = effectiveStartPage + page - 1;
      lastPageReached = actualPage;
      console.log(`  Page ${actualPage}: ${count} posts`);
    }
  });

  console.log(`\nTotal posts fetched: ${posts.length}`);

  // Never read/parse a post we've already processed. Posts without a
  // resolvable id are kept (fail open, not silently dropped).
  const newPosts = posts.filter(p => p.postId == null || p.postId > cutoffPostId);
  const skippedCount = posts.length - newPosts.length;
  if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} already-processed post(s) (id <= ${cutoffPostId}).`);
  }

  // Process posts and build CSV rows. Track the highest post id seen in the
  // same pass (whether it produced a guess or not) so a re-run never re-reads
  // it, instead of a second pass over `posts` afterward.
  const csvValidRows = [];
  const csvInvalidRows = [];
  let maxPostIdSeen = cutoffPostId;

  for (const post of newPosts) {
    if (post.postId > maxPostIdSeen) maxPostIdSeen = post.postId;

    const guesses = extractGuessesFromPost(post.content, defaultYear);

    if (guesses.length === 0) {
      // No parseable guesses - store raw line with # prefix for the review
      // UI. Include the post timestamp so a manual fix keeps the
      // posted-before-match check meaningful.
      const ts = post.timestamp ? ` @${post.timestamp}` : '';
      const rawLine = `${post.username}${ts}: ${post.content.substring(0, 300).replace(/\n/g, ' ')}`;
      csvInvalidRows.push('#' + rawLine.replace(/\n/g, ' '));
      continue;
    }

    for (const guess of guesses) {
      csvValidRows.push(guessToCsvRow(guess, post.username, post.timestamp));
    }
  }

  console.log(`\nParsed guesses:`);
  console.log(`  Valid: ${csvValidRows.length}`);
  console.log(`  Invalid (marked with #): ${csvInvalidRows.length}`);

  // Write CSV file
  const header = 'username,timestamp,date,home_team,away_team,home_score,away_score,scorer,raw_text';

  // Combine all rows
  const allCsvRows = [...csvValidRows, ...csvInvalidRows];

  if (allCsvRows.length === 0) {
    console.log(`\nNo new rows to write.`);
  } else if (effectiveAppend && existsSync(output)) {
    appendFileSync(output, '\n' + allCsvRows.join('\n'));
    console.log(`\nAppended ${allCsvRows.length} rows to ${output}`);
  } else {
    writeFileSync(output, header + '\n' + allCsvRows.join('\n'));
    console.log(`\nWrote ${allCsvRows.length} rows to ${output}`);
  }

  // Advance the cursor to the highest post id we've now seen.
  if (maxPostIdSeen > 0) {
    saveScrapeState(config.forumUrl, { lastPostId: maxPostIdSeen, lastPage: lastPageReached });
    console.log(`Saved cursor: page ${lastPageReached}, last post id ${maxPostIdSeen}`);
  }

  console.log(`\nNext steps:`);
  console.log(`  1. Review ${output} and fix any lines starting with #`);
  console.log(`  2. Run: node src/index.js import guesses ${output}`);
}

export default scrapeGuesses;
