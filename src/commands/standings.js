import { writeFileSync } from 'fs';
import { getStandings, getPerfectGuesses, getResultMeta } from '../db/queries.js';
import { renderStandings } from '../utils/standings-format.js';

/**
 * Build the forum-ready standings text (no side effects). Returns null if there
 * is nothing scored in range. Shared by the `standings` and `publish` commands.
 * @param {object} options - { from, to, round }
 * @returns {Promise<string|null>}
 */
export async function buildStandingsText(options = {}) {
  const { from = null, to = null, round = null } = options;

  const rows = await getStandings(from, to);
  if (rows.length === 0) return null;

  const perfectRaw = await getPerfectGuesses(from, to);
  const perfect = perfectRaw.map((p) => ({
    name: p.name,
    date: p.date,
    matchLabel: `${p.home_team} ${p.home_score}-${p.away_score} ${p.away_team}`,
    scorer: p.scorer || '',
  }));

  const meta = await getResultMeta(from, to);
  return renderStandings({
    rows,
    perfect,
    meta: {
      roundLabel: round || (meta.played ? `omgång ${meta.played}` : null),
      date: meta.lastDate || to || null,
    },
  });
}

/**
 * Generate a forum-ready standings post and write it to a file for pasting.
 * @param {object} options - { from, to, output, round }
 */
export async function generateStandings(options = {}) {
  const { output = 'standings.txt' } = options;
  const text = await buildStandingsText(options);

  if (text === null) {
    console.log('No scored guesses in range — nothing to post yet.');
    console.log('(Run import guesses + scrape results + calculate first.)');
    return;
  }

  writeFileSync(output, text + '\n');
  console.log(text);
  console.log(`\n---\nWrote ${output}. Copy the block above into the thread.`);
  return text;
}

export default generateStandings;
