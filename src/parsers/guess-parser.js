import { parse, isValid, format } from 'date-fns';
import { matchTeam, isLulea } from '../utils/team-matcher.js';
import { debugParser, logSkipped } from '../utils/debug.js';

/**
 * Parse a date string with tolerance for different formats
 * @param {string} dateStr - Date string to parse
 * @param {number} year - Default year if not specified
 * @returns {string|null} - ISO date string (YYYY-MM-DD) or null
 */
export function parseDate(dateStr, year = new Date().getFullYear()) {
  if (!dateStr) {
    debugParser('parseDate: empty input');
    return null;
  }

  const cleaned = dateStr.trim();

  // Common date formats to try
  const formats = [
    'yyyy-MM-dd',     // 2023-09-14
    'yy-MM-dd',       // 23-09-14
    'dd/MM/yyyy',     // 14/09/2023
    'dd/MM/yy',       // 14/09/23
    'dd/MM',          // 14/09
    'd/M/yyyy',       // 14/9/2023
    'd/M/yy',         // 14/9/23
    'd/M',            // 14/9
    'dd-MM-yyyy',     // 14-09-2023
    'dd-MM-yy',       // 14-09-23
    'dd-MM',          // 14-09
    'd-M-yyyy',       // 14-9-2023
    'd-M',            // 14-9
    'dd.MM.yyyy',     // 14.09.2023
    'dd.MM.yy',       // 14.09.23
    'dd.MM',          // 14.09
    'd.M',            // 14.9
  ];

  for (const fmt of formats) {
    try {
      const parsed = parse(cleaned, fmt, new Date(year, 0, 1));
      if (isValid(parsed)) {
        // If year wasn't in format, use provided year
        if (!fmt.includes('y') && parsed.getFullYear() === 2001) {
          parsed.setFullYear(year);
        }
        return format(parsed, 'yyyy-MM-dd');
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Build a { home, away } score object from two numeric-string captures.
 * @param {string} homeStr
 * @param {string} awayStr
 * @returns {{ home: number, away: number }}
 */
export function toScore(homeStr, awayStr) {
  return { home: parseInt(homeStr, 10), away: parseInt(awayStr, 10) };
}

/**
 * Parse a score string like "1-3", "1 - 3", "1:3"
 * @param {string} scoreStr - Score string
 * @returns {{ home: number, away: number }|null}
 */
export function parseScore(scoreStr) {
  if (!scoreStr) return null;

  const cleaned = scoreStr.trim();

  // Match patterns like "1-3", "1 - 3", "1:3", "1 : 3"
  const match = cleaned.match(/^(\d+)\s*[-:]\s*(\d+)$/);

  return match ? toScore(match[1], match[2]) : null;
}

/**
 * Parse a teams string like "Oskarshamn - Luleå" or "Osk-Luleå"
 * @param {string} teamsStr - Teams string
 * @returns {{ home: string, away: string }|null}
 */
export function parseTeams(teamsStr) {
  if (!teamsStr) return null;

  const cleaned = teamsStr.trim();

  // Split on common separators: " - ", "-", " mot ", " vs "
  const separators = [' - ', ' – ', ' — ', '-', '–', '—', ' mot ', ' vs ', ' vs. '];

  for (const sep of separators) {
    const parts = cleaned.split(sep);
    if (parts.length === 2) {
      const home = matchTeam(parts[0].trim());
      const away = matchTeam(parts[1].trim());

      if (home && away) {
        return { home, away };
      }
    }
  }

  return null;
}

/**
 * Parse a full guess line
 * Expected format: "2023-09-14, Oskarshamn - Luleå, 1-3, Linus Omark"
 *
 * Tolerances:
 * - Various date formats
 * - Various separators (, ; or newline)
 * - Flexible team name matching
 * - Optional scorer
 *
 * @param {string} guessLine - The guess line to parse
 * @param {number} defaultYear - Default year for date parsing
 * @returns {object|null} - Parsed guess or null if invalid
 */
export function parseGuess(guessLine, defaultYear = new Date().getFullYear()) {
  if (!guessLine || typeof guessLine !== 'string') {
    debugParser('parseGuess: invalid input type');
    return null;
  }

  const cleaned = guessLine.trim();
  if (!cleaned) {
    debugParser('parseGuess: empty input');
    return null;
  }

  debugParser(`Parsing: "${cleaned.substring(0, 50)}${cleaned.length > 50 ? '...' : ''}"`);

  // Normalize "Team: score" (colon used instead of comma right before a score)
  // to a comma, so it flows through the normal comma-split path below.
  // Also normalize "Team score" with no punctuation at all before the score
  // (just whitespace) the same way. The lookbehind-free version below only
  // fires when the character right before the whitespace is alphanumeric
  // (i.e. NOT already a comma), so it's a no-op on already well-formed input.
  const normalized = cleaned
    .replace(/:\s*(?=\d+\s*[-–—]\s*\d+)/g, ', ')
    .replace(/([A-Za-zÅÄÖåäö0-9])\s+(?=\d+\s*[-–—]\s*\d+)/g, '$1, ');

  // Try to split by common separators
  // First try comma, then semicolon, then try to identify parts
  let parts;

  if (normalized.includes(',')) {
    parts = normalized.split(',').map(p => p.trim()).filter(p => p);
  } else if (normalized.includes(';')) {
    parts = normalized.split(';').map(p => p.trim()).filter(p => p);
  } else {
    // Try to parse inline
    parts = [normalized];
  }

  if (parts.length < 3) {
    // Try to extract parts differently
    // Pattern: date teams score [scorer]
    const dateMatch = normalized.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)/);
    if (dateMatch) {
      const rest = normalized.substring(dateMatch[0].length).trim();
      // Try to find score pattern
      const scoreMatch = rest.match(/(\d+\s*[-:]\s*\d+)/);
      if (scoreMatch) {
        const scoreIdx = rest.indexOf(scoreMatch[0]);
        const teams = rest.substring(0, scoreIdx).replace(/^[,;\s]+|[,;\s]+$/g, '');
        const afterScore = rest.substring(scoreIdx + scoreMatch[0].length).replace(/^[,;\s]+/, '');

        parts = [dateMatch[0], teams, scoreMatch[0]];
        if (afterScore) parts.push(afterScore);
      }
    }
  }

  if (parts.length < 3) {
    logSkipped('parser', cleaned, 'could not split into 3+ parts');
    return null;
  }

  // Parse each part
  const date = parseDate(parts[0], defaultYear);
  if (!date) {
    logSkipped('parser', cleaned, `invalid date: "${parts[0]}"`);
    return null;
  }

  const teams = parseTeams(parts[1]);
  if (!teams) {
    logSkipped('parser', cleaned, `invalid teams: "${parts[1]}"`);
    return null;
  }

  let score = parseScore(parts[2]);

  // Scorer glued directly to the score with no separating comma, e.g. "2-5 Shinnimin".
  // Keep the entire remainder (not just the first word) as the scorer text.
  let inlineScorer = null;
  if (!score) {
    const loose = parts[2].trim().match(/^(\d+)\s*[-:]\s*(\d+)\s+(.+)$/s);
    if (loose) {
      score = toScore(loose[1], loose[2]);
      inlineScorer = loose[3].trim();
    }
  }

  if (!score) {
    logSkipped('parser', cleaned, `invalid score: "${parts[2]}"`);
    return null;
  }

  // Scorer is optional (4th part), or captured inline when glued to the score
  const scorer = parts.length > 3 ? parts[3].trim() : inlineScorer;

  // Determine if Luleå is home or away
  const luleaIsHome = isLulea(teams.home);
  const luleaIsAway = isLulea(teams.away);

  if (!luleaIsHome && !luleaIsAway) {
    logSkipped('parser', cleaned, `Luleå not found in teams: ${teams.home} vs ${teams.away}`);
    return null;
  }

  debugParser(`Parsed successfully: ${date} ${teams.home} ${score.home}-${score.away} ${teams.away}`);

  return {
    date,
    homeTeam: teams.home,
    awayTeam: teams.away,
    homeScore: score.home,
    awayScore: score.away,
    scorer,
    luleaIsHome,
    rawText: guessLine
  };
}

/**
 * Extract multiple guesses from a forum post text
 * @param {string} postText - Full text of a forum post
 * @param {number} defaultYear - Default year for date parsing
 * @returns {object[]} - Array of parsed guesses
 */
export function extractGuessesFromPost(postText, defaultYear = new Date().getFullYear()) {
  if (!postText) return [];

  const guesses = [];

  // Split by newlines and try to parse each line
  const lines = postText.split(/\n/).map(l => l.trim()).filter(l => l);

  for (const line of lines) {
    // Skip lines that are clearly not guesses
    if (line.length < 10) continue;
    if (line.startsWith('http')) continue;
    if (!line.match(/\d/)) continue; // Must contain a digit

    const parsed = parseGuess(line, defaultYear);
    if (parsed) {
      guesses.push(parsed);
    }
  }

  return guesses;
}
