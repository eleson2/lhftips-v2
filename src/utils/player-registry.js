import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeName, getLastName, foldAccents } from './name-normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REGISTRY_PATH = join(__dirname, '..', '..', 'data', 'player-registry.json');

export function getRegistryPath() {
  return REGISTRY_PATH;
}

/**
 * @typedef {Object} RegistryEntry
 * @property {number|null} number
 * @property {string|null} position
 * @property {string[]} variations   deterministic + manual alternate spellings
 * @property {string[]} seasonsActive
 * @property {boolean} active
 * @property {string} source         'roster' | 'manual' | ...
 * @property {{variation:string, game?:number, date?:string}[]} learned  auto-learned, with provenance
 */

/**
 * Load the registry. Returns an empty shell if the file does not exist yet.
 * @returns {{ season: string|null, players: Record<string, RegistryEntry> }}
 */
export function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return { season: null, players: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    return { season: raw.season ?? null, players: raw.players ?? {} };
  } catch (error) {
    console.error(`Warning: could not read registry ${REGISTRY_PATH}: ${error.message}`);
    return { season: null, players: {} };
  }
}

export function saveRegistry(registry) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Deterministically derive alternate spellings from a full name. These are the
 * variants a matcher can rely on without any human input: last name, and
 * first-initial + last name, in both accented and accent-folded forms.
 * @param {string} fullName
 * @returns {string[]} lowercase variants (excluding the plain full name)
 */
export function generateVariants(fullName) {
  const set = new Set();
  const lower = fullName.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!lower) return [];

  const parts = lower.split(' ');
  const last = getLastName(lower);

  const addBoth = (s) => {
    if (s) {
      set.add(s);
      set.add(foldAccents(s));
    }
  };

  addBoth(last);
  if (parts.length >= 2 && parts[0].length > 0) {
    const initial = parts[0][0];
    addBoth(`${initial}. ${last}`);
    addBoth(`${initial} ${last}`);
  }
  // The full accented→folded form, in case the canonical is stored accented.
  addBoth(lower);

  set.delete('');
  return [...set];
}

function findEntryKeyByName(players, name) {
  const target = name.toLowerCase();
  for (const canon of Object.keys(players)) {
    if (canon.toLowerCase() === target) return canon;
  }
  return null;
}

/**
 * Merge a scraped roster into the registry.
 *
 * mode 'in-season'  : additive only. Add new players, refresh existing ones,
 *                     but NEVER deactivate anyone — a traded-away player still
 *                     scored in earlier games this season.
 * mode 'new-season' : full reconcile. Carry over returning players (and their
 *                     learned variations), add newcomers, and mark players no
 *                     longer on the roster as inactive (kept, never deleted).
 *
 * @param {object} registry
 * @param {{number:number|null, name:string, position:string|null}[]} rosterPlayers
 * @param {{ mode?: 'in-season'|'new-season', season: string }} opts
 * @returns {{ registry: object, diff: object }}
 */
export function mergeRoster(registry, rosterPlayers, { mode = 'in-season', season }) {
  if (!season) throw new Error('mergeRoster requires a season');
  const players = registry.players || (registry.players = {});
  const diff = { added: [], returning: [], updated: [], deactivated: [], untouched: 0 };
  const rosterNames = new Set();

  for (const rp of rosterPlayers) {
    rosterNames.add(rp.name.toLowerCase());
    const genVars = generateVariants(rp.name);
    const existingKey = findEntryKeyByName(players, rp.name);

    if (existingKey) {
      const e = players[existingKey];
      const wasActive = e.active;
      if (rp.number != null) e.number = rp.number;
      if (rp.position != null) e.position = rp.position;
      e.active = true;
      e.seasonsActive = e.seasonsActive || [];
      if (!e.seasonsActive.includes(season)) e.seasonsActive.push(season);
      const vset = new Set(e.variations || []);
      for (const v of genVars) vset.add(v);
      e.variations = [...vset];
      if (!wasActive) diff.returning.push(rp.name);
      else diff.updated.push(rp.name);
    } else {
      players[rp.name] = {
        number: rp.number ?? null,
        position: rp.position ?? null,
        variations: genVars,
        seasonsActive: [season],
        active: true,
        source: 'roster',
        learned: [],
      };
      diff.added.push(rp.name);
    }
  }

  for (const canon of Object.keys(players)) {
    if (rosterNames.has(canon.toLowerCase())) continue;
    const e = players[canon];
    if (mode === 'new-season' && e.active) {
      e.active = false;
      diff.deactivated.push(canon);
    } else {
      diff.untouched += 1; // in-season: never touch departed players
    }
  }

  if (mode === 'new-season' || !registry.season) registry.season = season;
  return { registry, diff };
}

/**
 * Record an auto-learned spelling for a player, with provenance, if it is not
 * already known. Conservative by contract: callers must only invoke this on a
 * high-confidence, unambiguous match.
 * @returns {boolean} true if a new variation was added
 */
export function learnVariation(registry, canonical, spelling, provenance = {}) {
  const e = registry.players?.[canonical];
  if (!e) return false;
  const norm = normalizeName(spelling);
  if (!norm) return false;

  const known = new Set([
    normalizeName(canonical),
    ...(e.variations || []).map(normalizeName),
    ...(e.learned || []).map((l) => normalizeName(l.variation)),
  ]);
  if (known.has(norm)) return false;

  e.learned = e.learned || [];
  e.learned.push({ variation: spelling, ...provenance });
  return true;
}

/**
 * Build a normalized-spelling → canonical-name lookup. A spelling that maps to
 * more than one canonical name is flagged AMBIGUOUS so the matcher can refuse
 * to resolve it via the registry and fall back to per-game evidence instead.
 * @param {object} registry
 * @returns {{ map: Map<string, string|symbol>, AMBIGUOUS: symbol }}
 */
export function buildLookup(registry) {
  const AMBIGUOUS = Symbol('ambiguous');
  const map = new Map();
  const add = (norm, canon) => {
    if (!norm) return;
    const cur = map.get(norm);
    if (cur === undefined) map.set(norm, canon);
    else if (cur !== canon) map.set(norm, AMBIGUOUS);
  };

  for (const [canon, e] of Object.entries(registry.players || {})) {
    add(normalizeName(canon), canon);
    for (const v of e.variations || []) add(normalizeName(v), canon);
    for (const l of e.learned || []) add(normalizeName(l.variation), canon);
  }
  return { map, AMBIGUOUS };
}
