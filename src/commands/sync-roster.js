import { scrapeRoster } from '../scrapers/roster-scraper.js';
import {
  loadRegistry,
  saveRegistry,
  mergeRoster,
  getRegistryPath,
} from '../utils/player-registry.js';
import { loadConfig } from '../config.js';

/**
 * Derive the current hockey season string (e.g. "2026-27").
 * Season is treated as starting in July.
 */
export function currentSeason(date = new Date()) {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 6 ? y : y - 1; // month is 0-indexed; 6 = July
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

function printList(label, names) {
  if (names.length === 0) return;
  console.log(`\n  ${label} (${names.length}):`);
  for (const n of names) console.log(`    + ${n}`);
}

/**
 * Sync the current club roster into the player registry.
 * @param {object} options
 * @param {'in-season'|'new-season'} [options.mode]
 * @param {string} [options.season]
 * @param {string} [options.url]
 * @param {boolean} [options.dryRun]
 */
export async function syncRoster(options = {}) {
  const config = loadConfig();
  const url = options.url || config.rosterUrl;
  const mode = options.mode || 'in-season';
  const season = options.season || currentSeason();

  if (!url) {
    console.error('Roster URL not configured. Set "rosterUrl" in config/settings.json or pass --url.');
    process.exit(1);
  }

  console.log(`\nSyncing roster`);
  console.log(`  URL:    ${url}`);
  console.log(`  Season: ${season}`);
  console.log(`  Mode:   ${mode}${mode === 'new-season' ? ' (departed players will be deactivated)' : ' (additive only)'}`);

  const rosterPlayers = await scrapeRoster(url);
  console.log(`\nScraped ${rosterPlayers.length} players from roster.`);

  const registry = loadRegistry();
  const before = Object.keys(registry.players).length;
  const { diff } = mergeRoster(registry, rosterPlayers, { mode, season });
  const after = Object.keys(registry.players).length;

  console.log(`\nRegistry diff:`);
  printList('New players added', diff.added);
  printList('Returning (reactivated)', diff.returning);
  printList('Refreshed (already active)', diff.updated);
  printList('Deactivated (no longer on roster)', diff.deactivated);
  console.log(`\n  Departed players left untouched: ${diff.untouched}`);
  console.log(`  Total players in registry: ${before} -> ${after}`);

  if (options.dryRun) {
    console.log(`\n[dry-run] No changes written. Registry: ${getRegistryPath()}`);
    return { diff, registry };
  }

  saveRegistry(registry);
  console.log(`\nSaved registry: ${getRegistryPath()}`);
  return { diff, registry };
}

export default syncRoster;
