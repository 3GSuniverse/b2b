import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { providers, resetVertexCache } from '../src/modules/ai/quote-draft.js';

describe('Vertex AI provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signs in with the VM’s service account and calls Gemini', async () => {
    resetVertexCache();
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'vm-token', expires_in: 3600 }));
      if (url.endsWith('/project-id')) return new Response('drona-prod');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Namaste!' }] } }] }));
    });
    vi.stubGlobal('fetch', fetch);
    expect(await providers.vertex.complete({ system: 's', prompt: 'p', maxTokens: 50, model: 'gemini-2.5-flash-lite' })).toBe('Namaste!');
    await providers.vertex.complete({ system: 's', prompt: 'p', maxTokens: 50, model: 'gemini-2.5-flash-lite' });
    const urls = fetch.mock.calls.map((c) => c[0] as string);
    // The token and project are fetched once, then reused
    expect(urls.filter((u) => u.includes('metadata.google.internal'))).toHaveLength(2);
    const call = fetch.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://aiplatform.googleapis.com/v1/projects/drona-prod/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer vm-token');
  });

  it('explains when it is not running on Google Cloud', async () => {
    resetVertexCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    await expect(providers.vertex.complete({ system: 's', prompt: 'p', maxTokens: 10 })).rejects.toThrow('service account');
  });
});

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
