import { afterEach, describe, expect, it, vi } from 'vitest';
import { toWav, voice } from '../src/modules/calls/voice.js';
import { env } from '../src/config/env.js';

describe('Google voice for the AI Caller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    env.CALL_VOICE = 'sarvam';
  });

  it('hears speech and speaks back through Google when CALL_VOICE=google', async () => {
    env.CALL_VOICE = 'google';
    const pcm = Buffer.alloc(3200, 1);
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes('metadata')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      if (url.startsWith('https://speech.googleapis')) return Response.json({ results: [{ languageCode: 'te-in', alternatives: [{ transcript: 'నమస్కారం' }] }] });
      return Response.json({ audioContent: toWav(pcm).toString('base64') });
    });
    const heard = await voice().stt.transcribe(pcm, 'en');
    expect(heard.text).toBe('నమస్కారం');
    const stt = calls.find((c) => c.url.startsWith('https://speech.googleapis'))!;
    expect(stt.body.config.sampleRateHertz).toBe(8000);
    expect(stt.body.config.alternativeLanguageCodes).toContain('te-IN');
    const said = await voice().tts.speak('Hello', 'hi');
    expect(said.length).toBe(pcm.length);
    expect(calls.find((c) => c.url.includes('texttospeech'))!.body.voice.languageCode).toBe('hi-IN');
  });
});

import { langFromLocale, langOf } from '../src/modules/calls/voice.js';
describe('which language is being spoken', () => {
  it('judges by script, not by the AI’s label', () => {
    expect(langOf('నమస్కారం, మీకు ఎలా సహాయం చేయగలను?', 'en')).toBe('te');
    expect(langOf('जी, बताइए मैं क्या मदद करूँ?', 'en')).toBe('hi');
    expect(langOf('Sure, I can help with Kerala packages', 'te')).toBe('en');
    expect(langOf('ఓకే, package details WhatsApp లో పంపిస్తాను', 'en')).toBe('te');
    expect(langOf('ok', 'hi')).toBe('hi');
  });
  it('understands Google’s lowercase language codes', () => {
    expect(langFromLocale('te-in', 'en')).toBe('te');
    expect(langFromLocale('hi-IN', 'en')).toBe('hi');
    expect(langFromLocale(undefined, 'hi')).toBe('hi');
  });
});
