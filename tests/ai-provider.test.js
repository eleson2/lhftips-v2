import { test, describe } from 'node:test';
import assert from 'node:assert';
import { diagnoseGuessWithAI, AIProviderDisabledError } from '../src/parsers/ai/index.js';
import { anthropicProvider } from '../src/parsers/ai/anthropic-provider.js';

describe('AI provider (inactive by default)', () => {
  test('diagnoseGuessWithAI rejects with AIProviderDisabledError — no network call is made', async () => {
    await assert.rejects(
      () => diagnoseGuessWithAI('2026-09-19, Luleå - Frölunda, 3-2, Omark', 2026),
      AIProviderDisabledError
    );
  });

  test('the concrete anthropicProvider also rejects directly (the call is commented out, not just unwired)', async () => {
    await assert.rejects(() => anthropicProvider('some text', 2026), AIProviderDisabledError);
  });
});
