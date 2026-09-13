import { getDatabase } from '../db/database.js';
import { collectScorerCases } from '../utils/scorer-cases.js';
import { loadVerdicts } from '../utils/scorer-verdicts.js';
import {
  loadSuggestions, saveSuggestions, getSuggestion, setSuggestion, questionKey, getSuggestionsPath
} from '../utils/scorer-suggestions.js';
import { suggestScorerWithAI, AIProviderDisabledError } from '../parsers/ai/index.js';

/**
 * Batch step: ask the local model about every scorer awaiting judgement, and
 * cache the answers so the review UI opens with them already filled in.
 *
 * This is deliberately its own command rather than something `calculate` does.
 * It is the slow, optional half of the loop — you run it once, walk away, and
 * come back to a queue that is ready to be read rather than one that makes you
 * wait a second per card. Nothing it writes affects a score: suggestions are
 * only ever pre-filled answers for a human to accept, change or ignore.
 *
 * @param {object} options
 */
export async function suggestScorers(options = {}) {
  const { db = 'lhftips.db', force = false, limit = null, from = null, to = null } = options;

  await getDatabase(db);

  const verdicts = loadVerdicts();
  let cases = await collectScorerCases(verdicts, { from, to, pendingOnly: true });

  if (cases.length === 0) {
    console.log('\nNothing awaiting judgement — no suggestions needed.');
    return;
  }

  const store = loadSuggestions();

  // One model call per distinct QUESTION, not per case: the same nickname in the
  // same game asked by five users is one question with one answer.
  const questions = new Map();
  for (const c of cases) {
    const key = questionKey(c.guessedScorer, c.candidates);
    if (!questions.has(key)) questions.set(key, { ...c, cases: 0 });
    questions.get(key).cases += 1;
  }

  let todo = [...questions.values()];
  if (!force) todo = todo.filter(q => !getSuggestion(store, q.guessedScorer, q.candidates));
  if (limit) todo = todo.slice(0, limit);

  const cached = questions.size - todo.length;
  console.log(`\n${cases.length} scorer(s) awaiting judgement across ${questions.size} distinct question(s).`);
  if (cached > 0) console.log(`  ${cached} already have a cached suggestion${force ? ' (re-asking anyway)' : ' — skipping'}.`);
  if (todo.length === 0) {
    console.log('\nNothing to ask. Run `review` and open the Scorers tab.');
    return;
  }
  console.log(`  Asking the model about ${todo.length}. The first call loads the model (~1 min).\n`);

  let resolved = 0;
  let declined = 0;
  let failed = 0;

  for (const [i, q] of todo.entries()) {
    const prefix = `  [${i + 1}/${todo.length}] "${q.guessedScorer}"`;
    try {
      const r = await suggestScorerWithAI(q.guessedScorer, q.candidates);
      setSuggestion(store, q.guessedScorer, q.candidates, r);
      // Persist as we go: a long batch interrupted halfway keeps its work.
      saveSuggestions(store);

      if (r.player) {
        resolved++;
        console.log(`${prefix} -> ${r.player} (${r.confidence})`);
      } else if (r.rejected) {
        declined++;
        console.log(`${prefix} -> none (model said ${r.rejected.player}, rejected as implausible)`);
      } else {
        declined++;
        console.log(`${prefix} -> none of these`);
      }
    } catch (error) {
      if (error instanceof AIProviderDisabledError) {
        console.log(`\n${error.message}`);
        return;
      }
      failed++;
      console.log(`${prefix} -> FAILED: ${error.message}`);
    }
  }

  console.log(`\nDone. ${resolved} suggested, ${declined} declined, ${failed} failed.`);
  console.log(`Cached in ${getSuggestionsPath()}`);
  console.log('\nNow run `review` and open the Scorers tab — every card is pre-filled.');
  console.log('Suggestions are proposals only; nothing is scored until you save a verdict.');
}

export default suggestScorers;
