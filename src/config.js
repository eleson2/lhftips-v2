import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '..', 'config', 'settings.json');

const DEFAULT_CONFIG = {
  forumUrl: '',
  swehockeyUrl: '',
  rosterUrl: 'https://www.luleahockey.se/herr-laget-2026-2027',
  team: 'Luleå HF',
  // AI assistance is suggestion-only (see src/parsers/ai/index.js) — it never
  // awards a point. Turning it off just empties the "Ask AI" button.
  aiEnabled: true,
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.1:8b',
  ollamaTimeoutMs: 60000,
  // Seconds the model stays in VRAM after a call. Short by default so it does
  // not sit on ~5 GB of an 8 GB card; '30m' if you want it warm for a long
  // review session and are not gaming.
  ollamaKeepAlive: '60s'
};

/**
 * Load configuration from settings.json
 * @returns {object} Configuration object
 */
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch (error) {
    console.error('Error reading config file:', error.message);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to settings.json
 * @param {object} config - Configuration object
 */
export function saveConfig(config) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving config file:', error.message);
  }
}

/**
 * Get the config file path for display
 * @returns {string} Config file path
 */
export function getConfigPath() {
  return CONFIG_PATH;
}

/**
 * Extract schedule ID from swehockey URL
 * @param {string} url - Full swehockey URL
 * @returns {number|null} Schedule ID or null
 */
export function extractScheduleId(url) {
  if (!url) return null;
  const match = url.match(/\/Schedule\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Validate configuration
 * @param {object} config - Configuration object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];

  if (!config.forumUrl) {
    errors.push('forumUrl is not set');
  } else if (!config.forumUrl.startsWith('http')) {
    errors.push('forumUrl must be a valid URL');
  }

  if (!config.swehockeyUrl) {
    errors.push('swehockeyUrl is not set');
  } else if (!extractScheduleId(config.swehockeyUrl)) {
    errors.push('swehockeyUrl must contain a valid schedule ID (e.g., .../Schedule/18263)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
