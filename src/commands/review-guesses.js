import http from 'http';
import { exec } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseGuess } from '../parsers/guess-parser.js';
import { diagnoseGuess } from '../parsers/guess-diagnose.js';
import { diagnoseGuessWithAI, suggestScorerWithAI, AIProviderDisabledError } from '../parsers/ai/index.js';
import { getDatabase } from '../db/database.js';
import { collectScorerCases } from '../utils/scorer-cases.js';
import {
  loadVerdicts, saveVerdicts, setVerdict, removeVerdict, VERDICT
} from '../utils/scorer-verdicts.js';
import { loadRegistry, saveRegistry, learnVariation } from '../utils/player-registry.js';
import { reloadRegistry } from '../utils/player-matcher.js';
import { guessToCsvRow } from '../utils/csv.js';
import {
  readLines, writeLines, listPending, parseCommentLine, applyFix, applyDismiss
} from '../utils/review-file.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_PATH = join(__dirname, '../ui/review-ui.html');

/** Validate fix text: every non-empty line must parse as a guess. */
function validateFixText(text, defaultYear) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l);
  const results = lines.map(line => {
    const g = parseGuess(line, defaultYear);
    if (!g) return { ok: false, summary: `does not parse: "${line.substring(0, 60)}"` };
    return {
      ok: true,
      guess: g,
      summary: `${g.date}  ${g.homeTeam} ${g.homeScore}-${g.awayScore} ${g.awayTeam}${g.scorer ? '  (' + g.scorer + ')' : ''}`
    };
  });
  return { ok: results.length > 0 && results.every(r => r.ok), lines: results };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/**
 * Read the file and resolve the pending comment at `index`, or send a 409
 * and return null. Shared by /api/fix and /api/dismiss, which both start by
 * re-reading the file and re-validating the target line is still pending.
 */
function loadPendingComment(file, index, res) {
  const lines = readLines(file);
  const comment = parseCommentLine(lines[index]);
  if (!comment) {
    sendJson(res, 409, { error: `Line ${index + 1} is not a pending review item` });
    return null;
  }
  return { lines, comment };
}

/**
 * Review command: serve a local web UI for fixing unparsed guesses.
 * Fixed rows are written into the CSV directly below their commented
 * original; handled comment lines are re-marked #[fixed]/#[dismissed].
 */
export async function reviewGuesses(options = {}) {
  const { file = 'guesses.csv', port = 4321, open = true, db = 'lhftips.db' } = options;

  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const defaultYear = new Date().getFullYear();

  // The scorer queue reads from the database (matches, guesses, goalscorers);
  // the parse queue reads from the CSV. Both are re-read per request so an
  // external `calculate` run is reflected without restarting the UI.
  const hasDb = existsSync(db);
  if (hasDb) await getDatabase(db);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(UI_PATH, 'utf-8'));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/items') {
        // Re-read on every request so external edits are always reflected
        const lines = readLines(file);
        const items = listPending(lines).map(item => {
          const diagnosis = diagnoseGuess(item.content, defaultYear);
          const foundCount = Object.values(diagnosis.found).filter(Boolean).length;
          return { ...item, diagnosis, foundCount };
        });
        // Likely-fixable first: complete parses, then by number of found pieces
        items.sort((a, b) => {
          if (a.diagnosis.complete !== b.diagnosis.complete) return a.diagnosis.complete ? -1 : 1;
          return b.foundCount - a.foundCount;
        });
        sendJson(res, 200, { file, items });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/preview') {
        const { text } = await readBody(req);
        sendJson(res, 200, validateFixText(text, defaultYear));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/fix') {
        const { index, expect, text } = await readBody(req);
        const validation = validateFixText(text, defaultYear);
        if (!validation.ok) {
          sendJson(res, 400, { error: 'Fix text does not parse', lines: validation.lines });
          return;
        }
        const pending = loadPendingComment(file, index, res);
        if (!pending) return;
        const { lines, comment } = pending;
        const rows = validation.lines.map(l => guessToCsvRow(l.guess, comment.username, comment.timestamp));
        writeLines(file, applyFix(lines, index, expect, rows));
        console.log(`  fixed: ${comment.username} -> ${rows.length} row(s)`);
        sendJson(res, 200, { ok: true, rows });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/ai-suggest') {
        // Only meaningful for lines the local parser genuinely couldn't
        // handle — the caller (UI) only shows this action for those, and
        // this route re-derives that itself rather than trusting the client.
        const { index } = await readBody(req);
        const pending = loadPendingComment(file, index, res);
        if (!pending) return;
        const { comment } = pending;
        const diagnosis = diagnoseGuess(comment.content, defaultYear);
        if (diagnosis.complete) {
          sendJson(res, 400, { error: 'This line already parses with the local parser — AI assistance is for unparseable lines only' });
          return;
        }
        try {
          const result = await diagnoseGuessWithAI(comment.content, defaultYear);
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          if (error instanceof AIProviderDisabledError) {
            sendJson(res, 200, { ok: false, enabled: false, message: error.message });
          } else {
            sendJson(res, 502, { ok: false, enabled: true, error: error.message });
          }
        }
        return;
      }

      // ---- Scorer adjudication -------------------------------------------
      // AI proposes, a human decides, the decision persists. Nothing in this
      // block awards a point directly: every route writes to the verdict store,
      // and `calculate` applies it on the next run.

      if (req.method === 'GET' && req.url.startsWith('/api/scorers')) {
        if (!hasDb) {
          sendJson(res, 200, { available: false, message: `No database at ${db} — run import + calculate first`, items: [] });
          return;
        }
        const all = req.url.includes('all=1');
        const verdicts = loadVerdicts();
        const items = await collectScorerCases(verdicts, { pendingOnly: !all });
        sendJson(res, 200, { available: true, items });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/scorer-ai') {
        const { guessedScorer, candidates } = await readBody(req);
        if (!guessedScorer || !Array.isArray(candidates) || candidates.length === 0) {
          sendJson(res, 400, { error: 'guessedScorer and a non-empty candidates array are required' });
          return;
        }
        try {
          const result = await suggestScorerWithAI(guessedScorer, candidates);
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          if (error instanceof AIProviderDisabledError) {
            sendJson(res, 200, { ok: false, enabled: false, message: error.message });
          } else {
            sendJson(res, 502, { ok: false, enabled: true, error: error.message });
          }
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/api/scorer-verdict') {
        const {
          username, date, homeTeam, awayTeam, guessedScorer,
          verdict, resolvedTo = null, note = '', ai = null, mapPlayer = false
        } = await readBody(req);

        if (!username || !date || !homeTeam || !awayTeam || !guessedScorer) {
          sendJson(res, 400, { error: 'username, date, homeTeam, awayTeam and guessedScorer are required' });
          return;
        }
        if (verdict !== VERDICT.CORRECT && verdict !== VERDICT.INCORRECT) {
          sendJson(res, 400, { error: `verdict must be "${VERDICT.CORRECT}" or "${VERDICT.INCORRECT}"` });
          return;
        }

        const store = loadVerdicts();
        const record = setVerdict(store, { username, date, homeTeam, awayTeam, guessedScorer, verdict, resolvedTo, note, ai });
        saveVerdicts(store);

        // Optionally generalise the ruling: teach the registry that this
        // spelling means this player, so the matcher resolves it by itself
        // everywhere from now on and no further verdicts are needed.
        let mapped = false;
        if (mapPlayer && resolvedTo) {
          const registry = loadRegistry();
          mapped = learnVariation(registry, resolvedTo, guessedScorer, { source: 'review', date });
          if (mapped) {
            saveRegistry(registry);
            reloadRegistry();
          }
        }

        console.log(`  scorer verdict: ${username} ${date} "${guessedScorer}" -> ${verdict}${resolvedTo ? ` (${resolvedTo})` : ''}${mapped ? ' [mapped in registry]' : ''}`);
        sendJson(res, 200, { ok: true, record, mapped });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/scorer-clear') {
        const { key } = await readBody(req);
        if (!key) {
          sendJson(res, 400, { error: 'key is required' });
          return;
        }
        const store = loadVerdicts();
        const removed = removeVerdict(store, key);
        if (removed) saveVerdicts(store);
        console.log(`  scorer verdict cleared: ${key}${removed ? '' : ' (was not set)'}`);
        sendJson(res, 200, { ok: true, removed });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/dismiss') {
        const { index, expect } = await readBody(req);
        const pending = loadPendingComment(file, index, res);
        if (!pending) return;
        const { lines, comment } = pending;
        writeLines(file, applyDismiss(lines, index, expect));
        console.log(`  dismissed: ${comment.username}`);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.message.includes('has changed') ? 409 : 500;
      sendJson(res, status, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const url = `http://127.0.0.1:${port}/`;
  const pending = listPending(readLines(file)).length;
  let scorerPending = 0;
  if (hasDb) {
    try {
      scorerPending = (await collectScorerCases(loadVerdicts(), { pendingOnly: true })).length;
    } catch (error) {
      console.error(`  (could not read the scorer queue: ${error.message})`);
    }
  }
  console.log(`\nReview UI — ${pending} unparsed guess(es) in ${file}, ${scorerPending} scorer(s) awaiting judgement`);
  console.log(`Open: ${url}`);
  console.log('Press Ctrl+C to stop.\n');

  if (open) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
}

export default reviewGuesses;
