import { env } from '../../config/env.js';

/**
 * The AI Caller's ears and voice.
 *
 * Phone audio is 8 kHz, 16-bit, mono PCM. Listening for when the caller starts and stops talking
 * (VAD) runs right here on the server's CPU: it's cheap and it makes interrupting instant. Turning
 * speech into words and words into a natural voice goes to Sarvam AI (Indian voices, Telugu, Hindi,
 * English and more), so the server needs no GPU.
 */

export const SAMPLE_RATE = 8000;
export const FRAME_BYTES = 320; // 20 ms of 8 kHz 16-bit audio

export type Lang = 'en' | 'te' | 'hi';
const LOCALE: Record<Lang, string> = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };
const FROM_LOCALE: Record<string, Lang> = { 'en-IN': 'en', 'te-IN': 'te', 'hi-IN': 'hi' };

export interface SpeechToText {
  /** Words from one utterance (8 kHz PCM). `lang` is a hint; the language actually heard comes back. */
  transcribe(pcm: Buffer, lang: Lang): Promise<{ text: string; lang: Lang }>;
}
export interface TextToSpeech {
  /** One sentence spoken in the agency's voice, as 8 kHz PCM. */
  speak(text: string, lang: Lang, voice?: string): Promise<Buffer>;
}

/** Root-mean-square loudness of a frame of 16-bit little-endian samples. */
export function rms(frame: Buffer) {
  const n = Math.floor(frame.length / 2);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = frame.readInt16LE(i * 2);
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** Wraps PCM in a WAV header (speech-to-text wants a file). */
export function toWav(pcm: Buffer, rate = SAMPLE_RATE) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** The PCM inside a WAV file (finds the "data" chunk instead of assuming a 44-byte header). */
export function fromWav(wav: Buffer) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') return wav;
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === 'data') return wav.subarray(at + 8, Math.min(wav.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  return wav.subarray(44);
}

/** How long a stretch of PCM plays, in milliseconds. */
export const durationMs = (pcm: Buffer) => Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);

/**
 * Finds where the caller starts and stops talking. Feed it 20 ms frames; it calls `onStart` as
 * soon as real speech begins (that's how interrupting works) and `onUtterance` with the whole
 * utterance once they pause. The noise floor adapts, so a noisy bus stand still works.
 */
export class Vad {
  private floor = 300;
  private speaking = false;
  private loudRun = 0;
  private quietRun = 0;
  private chunks: Buffer[] = [];
  private preroll: Buffer[] = [];

  constructor(
    private readonly on: { start: () => void; utterance: (pcm: Buffer) => void },
    private readonly opts = { startFrames: 4, endSilenceMs: 650, minSpeechMs: 300, maxSpeechMs: 15_000 },
  ) {}

  push(frame: Buffer) {
    const level = rms(frame);
    const threshold = Math.max(500, this.floor * 2.8);
    const loud = level > threshold;
    if (!this.speaking) {
      // Track background noise only while nobody is talking
      if (!loud) this.floor = this.floor * 0.95 + level * 0.05;
      this.preroll.push(frame);
      if (this.preroll.length > 10) this.preroll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= this.opts.startFrames) {
        this.speaking = true;
        this.quietRun = 0;
        this.chunks = [...this.preroll];
        this.preroll = [];
        this.on.start();
      }
      return;
    }
    this.chunks.push(frame);
    this.quietRun = loud ? 0 : this.quietRun + 1;
    const spokenMs = this.chunks.length * 20;
    if (this.quietRun * 20 >= this.opts.endSilenceMs || spokenMs >= this.opts.maxSpeechMs) this.finish();
  }

  private finish() {
    const pcm = Buffer.concat(this.chunks);
    this.speaking = false;
    this.loudRun = 0;
    this.chunks = [];
    if (durationMs(pcm) - this.quietRun * 20 >= this.opts.minSpeechMs) this.on.utterance(pcm);
  }

  get isSpeaking() {
    return this.speaking;
  }
}

/** Splits a reply into sentences, so the first one can be spoken while the rest are still being made. */
export function sentences(text: string) {
  return (text.match(/[^.!?।]+[.!?।]+["')\]]?|[^.!?।]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

const sarvamHeaders = () => ({ 'api-subscription-key': env.SARVAM_API_KEY! });

const sarvamStt: SpeechToText = {
  async transcribe(pcm, lang) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(toWav(pcm))], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', env.CALL_STT_MODEL);
    // "unknown" lets it hear Telugu, Hindi or English, whichever the caller speaks
    form.append('language_code', 'unknown');
    const res = await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: sarvamHeaders(), body: form, signal: AbortSignal.timeout(8_000) });
    const data = (await res.json().catch(() => ({}))) as { transcript?: string; language_code?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(`speech-to-text ${res.status}: ${data.error?.message ?? 'failed'}`);
    return { text: (data.transcript ?? '').trim(), lang: FROM_LOCALE[data.language_code ?? ''] ?? lang };
  },
};

const sarvamTts: TextToSpeech = {
  async speak(text, lang, voice) {
    const res = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { ...sarvamHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ text, target_language_code: LOCALE[lang], speaker: voice ?? env.CALL_TTS_VOICE, model: env.CALL_TTS_MODEL, speech_sample_rate: SAMPLE_RATE, pace: 1.05 }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json().catch(() => ({}))) as { audios?: string[]; error?: { message?: string } };
    if (!res.ok || !data.audios?.[0]) throw new Error(`text-to-speech ${res.status}: ${data.error?.message ?? 'no audio'}`);
    return Buffer.concat(data.audios.map((a) => fromWav(Buffer.from(a, 'base64'))));
  },
};

let override: { stt: SpeechToText; tts: TextToSpeech } | null = null;
/** Tests swap in fakes. */
export function setVoice(v: { stt: SpeechToText; tts: TextToSpeech } | null) {
  override = v;
}
export const voiceEnabled = () => !!override || !!env.SARVAM_API_KEY;
export const voice = () => override ?? { stt: sarvamStt, tts: sarvamTts };
