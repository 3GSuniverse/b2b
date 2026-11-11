import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { providers } from '../src/modules/ai/quote-draft.js';

describe('Gemini provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the system prompt, switches thinking off on 2.5 models, and returns only the answer', async () => {
    env.GEMINI_API_KEY = 'test-key';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'Namaste! ' }, { text: 'Which dates?' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const out = await providers.gemini.complete({ system: 'Be kind', prompt: 'Hi', maxTokens: 200, model: 'gemini-2.5-flash-lite' });
    expect(out).toBe('Namaste! Which dates?');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemini-2.5-flash-lite:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('Be kind');
    expect(body.generationConfig).toEqual({ maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } });
  });

  it('turns an API error into a clear message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })));
    await expect(providers.gemini.complete({ system: 's', prompt: 'p', maxTokens: 10 })).rejects.toThrow('API key not valid');
  });
});
