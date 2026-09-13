import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeName } from './name-normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUGGESTIONS_PATH = join(__dirname, '..', '..', 'data', 'scorer-suggestions.json');

export function getSuggestionsPath() {
  return SUGGESTIONS_PATH;
}

/**
 * Suggestions are cached against the QUESTION, not the case: the guessed
 * spelling plus the exact set of players who scored. Two users who wrote the
 * same nickname for the same game ask the model the identical question, so they
 * share one answer and one model call. Change the spelling or the goalscorer
 * list and the key changes, so a stale answer can never be reused.
 *
 * @param {string} guessedScorer
 * @param {string[]} candidates
 * @returns {string}
 */
export function questionKey(guessedScorer, candidates) {
  const g = normalizeName(guessedScorer || '');
  const c = (candidates || []).map(normalizeName).sort().join('+');
  return `${g}|${c}`;
}

/** @returns {{ version:number, suggestions:Record<string,object> }} */
export function loadSuggestions() {
  if (!existsSync(SUGGESTIONS_PATH)) return { version: 1, suggestions: {} };
  try {
    const raw = JSON.parse(readFileSync(SUGGESTIONS_PATH, 'utf-8'));
    return { version: raw.version ?? 1, suggestions: raw.suggestions ?? {} };
  } catch (error) {
    console.error(`Warning: could not read suggestions ${SUGGESTIONS_PATH}: ${error.message}`);
    return { version: 1, suggestions: {} };
  }
}

/** Save with keys sorted so the file diffs cleanly. */
export function saveSuggestions(store) {
  const sorted = {};
  for (const k of Object.keys(store.suggestions || {}).sort()) sorted[k] = store.suggestions[k];
  writeFileSync(SUGGESTIONS_PATH, JSON.stringify({ version: store.version ?? 1, suggestions: sorted }, null, 2) + '\n');
}

export function getSuggestion(store, guessedScorer, candidates) {
  return store.suggestions?.[questionKey(guessedScorer, candidates)] ?? null;
}

export function setSuggestion(store, guessedScorer, candidates, suggestion) {
  store.suggestions = store.suggestions || {};
  store.suggestions[questionKey(guessedScorer, candidates)] = {
    ...suggestion,
    askedAt: new Date().toISOString(),
  };
}
