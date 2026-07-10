// import Anthropic from '@anthropic-ai/sdk'; // uncomment once installed (`npm install @anthropic-ai/sdk`)
import { AIProviderDisabledError } from './errors.js';

// One JSON object back from the model, guaranteed to match this shape by
// output_config.format (structured outputs) — no free-text scraping needed.
const GUESS_SCHEMA = {
  type: 'object',
  properties: {
    is_guess: {
      type: 'boolean',
      description: 'true if this post contains at least one real score prediction for a Luleå HF game (not rules text, chatter, a standings recap, or an example embedded in instructions)'
    },
    guesses: {
      type: 'array',
      description: 'One entry per distinct game prediction found. Empty if is_guess is false.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date, YYYY-MM-DD' },
          home_team: { type: 'string' },
          away_team: { type: 'string' },
          home_score: { type: 'integer' },
          away_score: { type: 'integer' },
          scorer: { type: ['string', 'null'], description: 'Predicted goalscorer, or null if none given' }
        },
        required: ['date', 'home_team', 'away_team', 'home_score', 'away_score', 'scorer'],
        additionalProperties: false
      }
    },
    reasoning: {
      type: 'string',
      description: 'One short sentence: why this is/isn\'t a guess, or what was ambiguous'
    }
  },
  required: ['is_guess', 'guesses', 'reasoning'],
  additionalProperties: false
};

const SYSTEM_PROMPT = `You extract hockey score predictions ("guesses") from Luleå HF forum posts.

The expected guess format is: "YYYY-MM-DD, Home Team - Away Team, X-Y, Scorer Name"
— but forum posters deviate constantly: wrong separators, missing punctuation,
scorer glued onto the score with no comma, typo'd dates, team nicknames/abbreviations.

Known NON-guess patterns to correctly reject (set is_guess: false):
- The season-opening rules/announcement post, which contains a quoted example
  guess (e.g. "Exempelvis '2026-09-19, ...'") — that example is not a real prediction.
- Admin standings recaps ("Senaste matchen slutade: ...", full leaderboard dumps).
- Pure chatter, congratulations, questions about the competition itself.
- A quoted reply to someone else's guess with no new prediction of the quoter's own.

A post can contain more than one guess (a user predicting several upcoming games,
or revising an earlier prediction later in the same post — if so, prefer their
final/revised numbers). Normalize team names to how they're commonly known in
Swedish hockey (e.g. "HV" -> "HV71", "Skellefteå"/"SAIK" -> as written by the user,
don't invent a team that isn't referenced).`;

/**
 * Anthropic (Claude) implementation of the AI diagnosis provider (see
 * ./index.js for the shared interface). The actual API call is commented
 * out below, so this is wired in end-to-end but inert — calling it throws
 * AIProviderDisabledError until a developer deliberately uncomments the
 * call (and runs `npm install @anthropic-ai/sdk` + sets ANTHROPIC_API_KEY).
 *
 * @param {string} rawText - The raw forum post content
 * @param {number} defaultYear - Year to assume if a date omits one
 * @returns {Promise<{ isGuess: boolean, reasoning: string, suggestion: string }>}
 */
export async function anthropicProvider(rawText, defaultYear = new Date().getFullYear()) {
  throw new AIProviderDisabledError(
    'Anthropic provider is wired in but inactive — uncomment the call in src/parsers/ai/anthropic-provider.js'
  );

  // --- uncomment below to enable ---
  // const client = new Anthropic();
  //
  // const response = await client.messages.create({
  //   model: 'claude-opus-4-8',
  //   max_tokens: 1024,
  //   output_config: {
  //     effort: 'low',
  //     format: { type: 'json_schema', schema: GUESS_SCHEMA }
  //   },
  //   system: SYSTEM_PROMPT,
  //   messages: [
  //     {
  //       role: 'user',
  //       content: `Default year if a date is ambiguous: ${defaultYear}\n\nPost text:\n${rawText}`
  //     }
  //   ]
  // });
  //
  // if (response.stop_reason === 'refusal') {
  //   return { isGuess: false, reasoning: 'Model declined to process this text.', suggestion: '' };
  // }
  //
  // const textBlock = response.content.find(b => b.type === 'text');
  // const parsed = JSON.parse(textBlock.text);
  //
  // const suggestion = parsed.guesses
  //   .map(g => `${g.date}, ${g.home_team} - ${g.away_team}, ${g.home_score}-${g.away_score}${g.scorer ? ', ' + g.scorer : ''}`)
  //   .join('\n');
  //
  // return { isGuess: parsed.is_guess, reasoning: parsed.reasoning, suggestion };
}
