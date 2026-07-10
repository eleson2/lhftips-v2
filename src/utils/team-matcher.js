import Fuse from 'fuse.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logMatch } from './debug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load team aliases from JSON config file
function loadTeamAliases() {
  const aliasPath = join(__dirname, '../../data/team-aliases.json');
  try {
    const content = readFileSync(aliasPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Warning: Could not load team aliases from ${aliasPath}: ${error.message}`);
    return {};
  }
}

const TEAM_ALIASES = loadTeamAliases();

// Build reverse lookup for quick matching
const aliasToCanonical = new Map();
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  aliasToCanonical.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) {
    aliasToCanonical.set(alias.toLowerCase(), canonical);
  }
}

// Build fuse index for fuzzy matching
const allTeamNames = [];
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  allTeamNames.push({ name: canonical, canonical });
  for (const alias of aliases) {
    allTeamNames.push({ name: alias, canonical });
  }
}

const fuse = new Fuse(allTeamNames, {
  keys: ['name'],
  threshold: 0.4,
  includeScore: true
});

/**
 * Resolve a team name to a KNOWN canonical team, or null if it isn't one.
 * Unlike matchTeam this never falls back to the original string, so it can be
 * used to test whether a piece of text is really a team (e.g. distinguishing a
 * "Home - Away" cell from a "5 - 2" score cell).
 * @param {string} teamName
 * @returns {string|null}
 */
export function resolveKnownTeam(teamName) {
  if (!teamName) return null;

  const normalized = teamName.trim().toLowerCase();

  if (aliasToCanonical.has(normalized)) {
    return aliasToCanonical.get(normalized);
  }

  const results = fuse.search(normalized);
  if (results.length > 0 && results[0].score < 0.4) {
    return results[0].item.canonical;
  }

  return null;
}

/**
 * True if the text resolves to a known team.
 * @param {string} teamName
 * @returns {boolean}
 */
export function isKnownTeam(teamName) {
  return resolveKnownTeam(teamName) !== null;
}

/**
 * Match a team name to its canonical form. Falls back to the trimmed original
 * when the name isn't recognised (preserves prior behaviour).
 * @param {string} teamName - The team name to match
 * @returns {string|null} - Canonical team name, original if unknown, null if empty
 */
export function matchTeam(teamName) {
  if (!teamName) return null;

  const known = resolveKnownTeam(teamName);
  if (known) {
    logMatch('matcher', teamName, known, 'known team');
    return known;
  }

  logMatch('matcher', teamName, null, 'no match found');
  return teamName.trim();
}

/**
 * Check if a team name refers to Luleå
 * @param {string} teamName - The team name to check
 * @returns {boolean}
 */
export function isLulea(teamName) {
  const canonical = matchTeam(teamName);
  return canonical === 'Luleå HF';
}

/**
 * Get all known team names
 * @returns {string[]}
 */
export function getAllTeams() {
  return Object.keys(TEAM_ALIASES);
}

export { TEAM_ALIASES };
