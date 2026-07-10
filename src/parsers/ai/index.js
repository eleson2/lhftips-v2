import { anthropicProvider } from './anthropic-provider.js';

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

export { AIProviderDisabledError } from './errors.js';
