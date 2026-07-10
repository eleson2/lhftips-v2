/**
 * Debug logging utility
 * Enable debug output by setting DEBUG=lhftips environment variable
 * For specific modules, use DEBUG=lhftips:parser or DEBUG=lhftips:matcher
 */

const DEBUG = process.env.DEBUG || '';
const isEnabled = DEBUG.includes('lhftips');

/**
 * Create a debug logger for a specific module
 * @param {string} module - Module name (e.g., 'parser', 'matcher', 'scraper')
 * @returns {Function} - Debug logging function
 */
export function createDebugger(module) {
  const moduleEnabled = isEnabled || DEBUG.includes(`lhftips:${module}`);
  const prefix = `[lhftips:${module}]`;

  return function debug(message, ...args) {
    if (moduleEnabled) {
      console.debug(prefix, message, ...args);
    }
  };
}

/**
 * Pre-configured debuggers for common modules
 */
export const debugParser = createDebugger('parser');
export const debugMatcher = createDebugger('matcher');
export const debugScraper = createDebugger('scraper');
export const debugDb = createDebugger('db');

/**
 * Log a skipped item with reason (useful for parser debugging)
 * @param {string} module - Module name
 * @param {string} item - Item that was skipped
 * @param {string} reason - Reason for skipping
 */
export function logSkipped(module, item, reason) {
  const debug = createDebugger(module);
  debug(`Skipped: "${item}" - ${reason}`);
}

/**
 * Log a match attempt result
 * @param {string} module - Module name
 * @param {string} input - Input that was being matched
 * @param {string|null} result - Match result or null
 * @param {string} [method] - Matching method used
 */
export function logMatch(module, input, result, method = 'unknown') {
  const debug = createDebugger(module);
  if (result) {
    debug(`Matched: "${input}" -> "${result}" (${method})`);
  } else {
    debug(`No match: "${input}" (${method})`);
  }
}
