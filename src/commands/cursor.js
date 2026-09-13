import { loadConfig } from '../config.js';
import {
  loadScrapeState, setScrapeState, clearScrapeState, extractThreadId,
} from '../utils/scrape-state.js';

/**
 * Inspect and move the forum scrape cursor.
 *
 * The cursor is what makes scraping incremental: it records the highest post id
 * already read for a thread, and ordinary runs only ever move it forward. This
 * command is the deliberate override — "go back and read the thread again from
 * post nn" — for when a parser fix, a changed post, or a bad earlier run means
 * old posts need re-reading.
 */
export async function cursorCommand(action, value, options = {}) {
  const config = loadConfig();

  if (!config.forumUrl) {
    console.error('Forum URL not configured. Edit config/settings.json');
    process.exit(1);
  }

  const threadId = extractThreadId(config.forumUrl);
  const current = loadScrapeState(config.forumUrl);

  const show = (label, state) => {
    if (!state) {
      console.log(`  ${label}: (none — the next scrape starts from page 1)`);
      return;
    }
    console.log(`  ${label}: last post id ${state.lastPostId}, page ${state.lastPage}` +
      (state.updatedAt ? `  (set ${state.updatedAt.slice(0, 19).replace('T', ' ')})` : ''));
  };

  console.log(`\nThread ${threadId ?? '(unrecognised URL)'} — ${config.forumUrl}`);

  if (action === 'show') {
    show('Cursor', current);
    if (current) {
      console.log('\nThe next `scrape guesses` reads from page ' +
        `${current.lastPage} and keeps only posts with id > ${current.lastPostId}.`);
    }
    return;
  }

  if (action === 'reset') {
    show('Was', current);
    const had = clearScrapeState(config.forumUrl);
    console.log(had ? '  Now: (none)' : '  Nothing to reset.');
    console.log('\nThe next `scrape guesses` will read the whole thread from page 1.');
    console.log('Existing CSV rows for re-read posts are replaced, not duplicated.');
    return;
  }

  // action === 'set'
  const postId = Number.parseInt(value, 10);
  if (!Number.isInteger(postId) || postId < 0) {
    console.error('Usage: cursor set <post-id> [--page <n>]');
    process.exit(1);
  }

  const page = options.page ? Math.max(1, parseInt(options.page, 10)) : 1;

  show('Was', current);
  // Stored as postId - 1 so that the NEXT scrape includes the post the user
  // named, rather than starting just after it.
  const now = setScrapeState(config.forumUrl, { lastPostId: Math.max(0, postId - 1), lastPage: page });
  if (!now) {
    console.error('Could not derive a thread id from the configured forum URL.');
    process.exit(1);
  }

  console.log(`  Now: last post id ${now.lastPostId}, page ${now.lastPage}`);
  console.log(`\nThe next \`scrape guesses\` re-reads the thread from post ${postId} onward,`);
  console.log(`starting at page ${page}.`);
  if (!options.page) {
    console.log('No page was given, so it sweeps from page 1 — pass --page <n> if you');
    console.log('know roughly where that post is and want to save the fetches.');
  }
  console.log('\nRows already in the CSV for re-read posts are replaced, not duplicated.');
  console.log('Then re-run: import guesses + calculate --force');
}

export default cursorCommand;
