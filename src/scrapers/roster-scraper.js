import axios from 'axios';
import * as cheerio from 'cheerio';
import { createDebugger } from '../utils/debug.js';

const debug = createDebugger('roster');

// Map Swedish position-group headings to canonical position codes.
// Only used as metadata; matching never depends on position.
const POSITION_HEADINGS = [
  { re: /m[åa]lvakt/i, position: 'goalie' },
  { re: /back/i, position: 'defense' },
  { re: /forward|anfall/i, position: 'forward' },
];

function headingToPosition(text) {
  for (const { re, position } of POSITION_HEADINGS) {
    if (re.test(text)) return position;
  }
  return null;
}

/**
 * A roster line looks like: " 34 Joel Lassinantti - 2027/28 (NY)"
 * - leading jersey number
 * - full name (may itself contain a hyphen, e.g. "Jakob Ihs-Wozniak")
 * - " - YYYY/YY" contract-until marker (anchors the end of the name)
 * - optional "(NY)" = nyförvärv / new signing
 */
const PLAYER_LINE = /^\s*(\d{1,3})\s+(.+?)\s+-\s+\d{4}\/\d{2}\s*(\(NY\))?\s*$/;

/**
 * Parse the roster HTML into a list of players.
 * @param {string} html - Raw page HTML
 * @returns {{ number: number|null, name: string, position: string|null, isNew: boolean }[]}
 */
export function parseRosterHtml(html) {
  const $ = cheerio.load(html);
  const players = [];
  const seen = new Set();
  let currentPosition = null;

  // Walk the body in document order so each player inherits the most recent
  // position heading above it.
  $('body *').each((i, el) => {
    const tag = $(el).prop('tagName');
    if (!tag) return;

    if (/^H[1-6]$/.test(tag)) {
      const pos = headingToPosition($(el).text());
      if (pos) currentPosition = pos;
      return;
    }

    if (tag !== 'P' && tag !== 'A' && tag !== 'LI' && tag !== 'SPAN') return;

    // Only consider an element's OWN direct text, so we don't re-match a
    // player line via its ancestors.
    const directText = $(el)
      .contents()
      .filter((j, n) => n.type === 'text')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const m = directText.match(PLAYER_LINE);
    if (!m) return;

    const number = m[1] ? parseInt(m[1], 10) : null;
    const name = m[2].replace(/\s+/g, ' ').trim();
    const isNew = Boolean(m[3]);

    const key = `${number}|${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    players.push({ number, name, position: currentPosition, isNew });
  });

  debug(`Parsed ${players.length} players from roster HTML`);
  return players;
}

/**
 * Fetch and parse the current roster from the club site.
 * @param {string} url - Roster page URL
 * @returns {Promise<{ number: number|null, name: string, position: string|null, isNew: boolean }[]>}
 */
export async function scrapeRoster(url) {
  if (!url) throw new Error('Roster URL not configured (set rosterUrl in config/settings.json)');

  debug(`Fetching roster from ${url}`);
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LHFTips/1.0)' },
    timeout: 20000,
  });

  const players = parseRosterHtml(String(res.data));
  if (players.length === 0) {
    throw new Error(
      `No players parsed from ${url}. The page layout may have changed — check roster-scraper.js.`
    );
  }
  return players;
}

export default scrapeRoster;
