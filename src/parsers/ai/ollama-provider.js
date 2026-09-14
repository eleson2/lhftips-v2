import { loadConfig } from '../../config.js';
import { normalizeName, foldAccents } from '../../utils/name-normalize.js';
import { AIProviderDisabledError } from './errors.js';

/**
 * The model picks a candidate by INDEX, never by name. Anything it invents is
 * then rejected by a range check on our side, so a hallucinated player name
 * cannot reach the review UI dressed up as a real goalscorer.
 */
const SCORER_SCHEMA = {
  type: 'object',
  properties: {
    // Decision first: under schema-constrained decoding the model emits fields
    // in this order, so it commits to a choice before it can talk itself into
    // one. `choice` is a plain integer — "none" is the last numbered option
    // rather than a nullable union, because a nullable union let the model
    // wander into unbounded generation instead of ever emitting null.
    choice: {
      type: 'integer',
      description: 'Index of the player the guess means, or the index of the final "none of these" option.'
    },
    confidence: {
      type: 'number',
      description: 'How sure you are, 0.0 to 1.0.'
    },
    reasoning: {
      type: 'string',
      maxLength: 200,
      description: 'One short sentence. Must be under 200 characters.'
    }
  },
  required: ['choice', 'confidence', 'reasoning'],
  additionalProperties: false
};

const SYSTEM_PROMPT = `You resolve Swedish ice-hockey nicknames to real players.

You are given what a forum user wrote as their predicted goalscorer, and the
numbered list of players who ACTUALLY scored in that game. Decide which of those
players — if any — the user meant.

The user's spelling may be:
- a surname, possibly misspelt or with accents dropped (Brannstrom = Brännström)
- a first name only (Einar = Einar Emanuelsson)
- a Swedish hockey nickname. These are built from the surname by keeping its
  BEGINNING and replacing the ending, usually with -e, -a, -is, -en or a doubled
  consonant: Söderberg -> Södde, Lindgren -> Lindis, Nilsson -> Nisse,
  Karlsson -> Kalle, Brännström -> Brasse.

The single most important rule: MOST OF THE TIME THE ANSWER IS "none of these".

You are only shown the hard cases — the ones ordinary spell-matching already
failed on. A large share of them are names of players who are NOT in the list at
all: someone from the other team, a player who did not score, or a joke entry.
None of those have an answer. Choose the "none of these" option.

Pick a player ONLY when the guessed word visibly starts with the same letters as
one of the listed names. If it does not, choose "none of these", no matter how
plausible a story you could tell about it.

Worked examples, with candidates [0] Isac Brännström, [1] Pontus Andreasson, [2] Linus Nässén:
- "Brasse"      -> 0. Starts "Br", same as Brännström. A standard nickname form.
- "Brannstrom"  -> 0. The same surname with the accents dropped.
- "Pontus"      -> 1. That is candidate 1's first name.
- "Zetterberg"  -> none of these. Starts "Ze". No listed player starts that way.
                  It is simply a different player, who is not on this list.
- "Nisse"       -> none of these. Nisse is the nickname for Nilsson, and no
                  Nilsson scored. Nässén is NOT Nilsson — do not stretch it.
- "Puckkungen"  -> the "none of these" option. Not a name at all.

Never name a player who is not in the numbered list. A wrong match hands a
competitor an undeserved point, so when in doubt choose "none of these" — that is
the safe answer and it costs nothing, because a human reviews every case anyway.`;

/**
 * Does the model's proposal survive a cheap, deterministic sanity check?
 *
 * Small local models will not answer "none" — asked which candidate a guess
 * means, they always pick one and narrate a confident justification for it, even
 * for a name belonging to nobody in the list. So the model's choice is treated
 * as a *proposal* and filtered here.
 *
 * The filter uses the one property Swedish nicknames reliably have: they keep
 * the beginning of the name they are derived from (Brännström->Brasse,
 * Söderberg->Södde, Lindgren->Lindis, Karlsson->Kalle). A proposal whose name
 * parts share no opening bigram with the guess is not a nickname link, it is the
 * model confabulating.
 *
 * @param {string} guess - what the user wrote
 * @param {string} player - the player the model proposed
 * @returns {boolean}
 */
export function plausibleLink(guess, player) {
  const g = foldAccents(normalizeName(guess)).replace(/[^a-z ]/g, '');
  if (g.length < 2) return false; // nothing to compare (e.g. a bare jersey number)

  const guessParts = g.split(' ').filter(Boolean);
  const playerParts = foldAccents(normalizeName(player)).replace(/[^a-z ]/g, '').split(' ').filter(Boolean);

  for (const gp of guessParts) {
    for (const pp of playerParts) {
      if (gp.slice(0, 2) === pp.slice(0, 2)) return true;
    }
  }
  return false;
}

/**
 * Ask a locally-hosted Ollama model which of a game's actual goalscorers a
 * guessed spelling refers to.
 *
 * This is a SUGGESTION ONLY — it is rendered in the review UI for a human to
 * accept, override or reject, and never writes a verdict by itself. See
 * ./index.js for the provider contract.
 *
 * @param {string} guessedScorer - what the user wrote
 * @param {string[]} candidates - the players who actually scored
 * @param {{ model?:string, url?:string, timeoutMs?:number, keepAlive?:string }} [opts]
 * @returns {Promise<{ player: string|null, candidateIndex: number|null, confidence: number, reasoning: string, model: string }>}
 */
export async function ollamaScorerProvider(guessedScorer, candidates, opts = {}) {
  const config = loadConfig();
  if (config.aiEnabled === false) {
    throw new AIProviderDisabledError('AI assistance is off — set "aiEnabled": true in config/settings.json');
  }

  const url = opts.url || config.ollamaUrl || 'http://127.0.0.1:11434';
  const model = opts.model || config.ollamaModel || 'llama3.1:8b';
  const timeoutMs = opts.timeoutMs ?? config.ollamaTimeoutMs ?? 60000;
  const keepAlive = opts.keepAlive ?? config.ollamaKeepAlive ?? '60s';

  if (!guessedScorer || !Array.isArray(candidates) || candidates.length === 0) {
    return { player: null, candidateIndex: null, confidence: 0, reasoning: 'No candidates to choose from.', model };
  }

  // "None of these" is a real, numbered option — picking from a list is a much
  // easier task for a small model than producing a null.
  const noneIndex = candidates.length;
  const list = candidates.map((name, i) => `${i}. ${name}`).join('\n');
  const userPrompt = `The user predicted this goalscorer: "${guessedScorer}"

Options:
${list}
${noneIndex}. None of these — the guess is not any of the players above

Which option did the user mean? Answer with its number.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: SCORER_SCHEMA,     // schema-constrained decoding — valid JSON guaranteed
        options: {
          temperature: 0,   // same input -> same suggestion, run to run
          num_predict: 150, // hard stop: a runaway generation must not hang the UI
        },
        // How long the model stays resident after a call. Kept SHORT by default:
        // an 8B model at Q4 occupies ~5 GB, which on an 8 GB card is most of it,
        // and this runs on a machine that is also used for games. Raise
        // ollamaKeepAlive in config/settings.json if you would rather trade VRAM
        // for not paying the ~50s reload during a long review session.
        keep_alive: keepAlive,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Ollama timed out after ${timeoutMs}ms (model "${model}")`);
    throw new Error(`Could not reach Ollama at ${url} — is it running? (${error.message})`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  let parsed;
  try {
    parsed = JSON.parse(payload.message?.content ?? '');
  } catch {
    throw new Error(`Ollama returned unparseable JSON: ${String(payload.message?.content).slice(0, 200)}`);
  }

  // Trust nothing: the index must land inside the candidate list we supplied.
  // `noneIndex` (and anything out of range) means no suggestion.
  const idx = parsed.choice;
  const valid = Number.isInteger(idx) && idx >= 0 && idx < candidates.length;
  const confidence = Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0;

  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  // The model picked someone, but the pick has to survive the sanity check.
  // A rejected pick is reported rather than hidden, so the reviewer can see what
  // the model wanted to say and judge for themselves.
  if (valid && !plausibleLink(guessedScorer, candidates[idx])) {
    return {
      player: null,
      candidateIndex: null,
      confidence: 0,
      reasoning: '',
      rejected: { player: candidates[idx], confidence, reasoning },
      model,
    };
  }

  return {
    player: valid ? candidates[idx] : null,
    candidateIndex: valid ? idx : null,
    confidence: valid ? confidence : 0,
    reasoning,
    rejected: null,
    model,
  };
}
