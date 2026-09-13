import { anthropicProvider } from './anthropic-provider.js';
import { ollamaScorerProvider } from './ollama-provider.js';

/**
 * The provider contract every AI backend implements — swap PROVIDER below
 * to point at a different provider (OpenAI, a local model, etc.) without
 * touching any caller. A provider takes raw forum post text and returns a
 * best-effort structured guess reconstruction.
 *
 * @typedef {{ isGuess: boolean, reasoning: string, suggestion: string }} AIDiagnosis
 * @typedef {(rawText: string, defaultYear: number) => Promise<AIDiagnosis>} AIProvider
 */

/** @type {AIProvider} */
const PROVIDER = anthropicProvider;

/**
 * Ask the configured AI provider to draft a guess reconstruction for a post
 * the local regex parser (guess-diagnose.js) couldn't handle.
 * @param {string} rawText
 * @param {number} defaultYear
 * @returns {Promise<AIDiagnosis>}
 */
export function diagnoseGuessWithAI(rawText, defaultYear) {
  return PROVIDER(rawText, defaultYear);
}

/**
 * The second provider contract: scorer resolution. Given what a user wrote as
 * their predicted goalscorer and the players who actually scored that game, a
 * provider proposes which one was meant.
 *
 * Deliberately a SUGGESTION contract, not a decision one. The result is shown
 * in the review UI for a human to accept, override or reject; nothing here ever
 * awards or withholds a point. See docs/player-matching.md.
 *
 * @typedef {{ player: string|null, candidateIndex: number|null, confidence: number, reasoning: string, model: string }} AIScorerSuggestion
 * @typedef {(guessedScorer: string, candidates: string[], opts?: object) => Promise<AIScorerSuggestion>} AIScorerProvider
 */

/** @type {AIScorerProvider} */
const SCORER_PROVIDER = ollamaScorerProvider;

/**
 * Ask the configured AI provider which actual goalscorer a guessed spelling
 * most likely refers to.
 * @param {string} guessedScorer
 * @param {string[]} candidates - players who actually scored
 * @param {object} [opts]
 * @returns {Promise<AIScorerSuggestion>}
 */
export function suggestScorerWithAI(guessedScorer, candidates, opts) {
  return SCORER_PROVIDER(guessedScorer, candidates, opts);
}

export { AIProviderDisabledError } from './errors.js';
