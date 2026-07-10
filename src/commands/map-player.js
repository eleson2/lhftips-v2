import { loadRegistry, saveRegistry, getRegistryPath } from '../utils/player-registry.js';
import { normalizeName } from '../utils/name-normalize.js';

/**
 * Manually map a spelling/nickname to a canonical player in the registry.
 * This is how a human "clears" a SCORER_UNMATCHED review item: after mapping,
 * re-run `calculate` and the scorer point will be awarded.
 *
 * @param {string} canonical - Exact canonical player name (as in the registry)
 * @param {string} spelling - The nickname/spelling to attach
 */
export async function mapPlayer(canonical, spelling) {
  if (!canonical || !spelling) {
    console.error('Usage: map-player "<Canonical Name>" "<spelling>"');
    process.exit(1);
  }

  const registry = loadRegistry();
  const players = registry.players || {};

  // Resolve canonical case-insensitively.
  const key = Object.keys(players).find((c) => c.toLowerCase() === canonical.toLowerCase());
  if (!key) {
    console.error(`No player "${canonical}" in the registry.`);
    console.error('Run `sync roster` first, or check the exact name in data/player-registry.json.');
    process.exit(1);
  }

  const entry = players[key];
  const norm = normalizeName(spelling);
  const known = new Set([
    normalizeName(key),
    ...(entry.variations || []).map(normalizeName),
    ...(entry.learned || []).map((l) => normalizeName(l.variation)),
  ]);

  if (known.has(norm)) {
    console.log(`"${spelling}" is already mapped to ${key}. Nothing to do.`);
    return;
  }

  entry.variations = entry.variations || [];
  entry.variations.push(spelling.toLowerCase());
  saveRegistry(registry);

  console.log(`Mapped "${spelling}" -> ${key}`);
  console.log(`Saved ${getRegistryPath()}`);
  console.log('Re-run `calculate` to award any withheld scorer points.');
}

export default mapPlayer;
