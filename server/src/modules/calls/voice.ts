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
/** Google answers "te-in", Sarvam "te-IN": understand both. */
export const langFromLocale = (code: string | undefined, fallback: Lang): Lang => {
  const [a, b] = (code ?? '').split('-');
  return FROM_LOCALE[b ? `${a}-${b.toUpperCase()}` : (code ?? '')] ?? fallback;
};

/**
 * Which language some words are really in, judged by their script. The AI's own "language" label
 * is sometimes missing or wrong, and a wrong label means the wrong voice, so the words decide.
 */
export function langOf(text: string, fallback: Lang): Lang {
  const te = (text.match(/[\u0C00-\u0C7F]/g) ?? []).length;
  const hi = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (te >= 3 && te >= hi) return 'te';
  if (hi >= 3) return 'hi';
  if (en >= 4 && te + hi === 0) return 'en';
  return fallback;
}

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
    if (id === 'data') return wav.subarray(at + 8, size ? Math.min(wav.length, at + 8 + size) : wav.length);
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
    private readonly opts = { startFrames: 4, endSilenceMs: 500, minSpeechMs: 300, maxSpeechMs: 15_000 },
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
    return { text: (data.transcript ?? '').trim(), lang: langFromLocale(data.language_code, lang) };
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

/**
 * Google Cloud Speech-to-Text and Text-to-Speech, for testing on Google credits. No key: the VM signs in
 * with its own service account (same as Vertex AI). Turn on with CALL_VOICE=google.
 */
let gToken: { value: string; until: number } | null = null;
async function googleToken() {
  if (gToken && gToken.until > Date.now()) return gToken.value;
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!res?.ok) throw new Error('Google voice: couldn’t sign in with the VM’s service account');
  const t = (await res.json()) as { access_token: string; expires_in: number };
  gToken = { value: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
  return gToken.value;
}
const GOOGLE_VOICE: Record<Lang, string> = { en: 'en-IN-Neural2-A', hi: 'hi-IN-Neural2-A', te: 'te-IN-Standard-A' };
const googleError = (d: { error?: { message?: string } }) => d.error?.message ?? 'failed';

const googleStt: SpeechToText = {
  async transcribe(pcm, lang) {
    const others = (['te', 'hi', 'en'] as Lang[]).filter((l) => l !== lang).map((l) => LOCALE[l]);
    const res = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'POST',
      headers: { authorization: `Bearer ${await googleToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        config: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, languageCode: LOCALE[lang], alternativeLanguageCodes: others, enableAutomaticPunctuation: true },
        audio: { content: pcm.toString('base64') },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json().catch(() => ({}))) as { results?: { languageCode?: string; alternatives?: { transcript?: string }[] }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`speech-to-text ${res.status}: ${googleError(data)}`);
    const best = data.results?.[0];
    return { text: (data.results ?? []).map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ').trim(), lang: langFromLocale(best?.languageCode, lang) };
  },
};

/** WAV from Google comes at the rate it was made in (Chirp voices: 24 kHz); a phone line takes 8 kHz. */
function pcm8k(wav: Buffer) {
  const rate = wav.toString('ascii', 0, 4) === 'RIFF' && wav.length > 28 ? wav.readUInt32LE(24) : SAMPLE_RATE;
  const pcm = fromWav(wav);
  if (rate === SAMPLE_RATE || !rate) return pcm;
  const ratio = rate / SAMPLE_RATE;
  const inN = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(Math.floor(inN / ratio) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.min(inN, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += pcm.readInt16LE(j * 2);
    out.writeInt16LE(Math.round(sum / (to - from)), i * 2);
  }
  return out;
}

let chirpBroken = false;
const googleTts: TextToSpeech = {
  async speak(text, lang) {
    const call = async (name: string, rate: number, speakingRate?: number) => {
      const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: { authorization: `Bearer ${await googleToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: LOCALE[lang], name },
          audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: rate, ...(speakingRate ? { speakingRate } : {}) },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string } };
      return { res, data };
    };
    // Chirp 3 HD: Google's most natural voices. If this project can't use them, fall back to the standard ones.
    if (!chirpBroken) {
      const { res, data } = await call(`${LOCALE[lang]}-Chirp3-HD-${env.CALL_GOOGLE_VOICE}`, 24_000);
      if (res.ok && data.audioContent) return pcm8k(Buffer.from(data.audioContent, 'base64'));
      if (res.status === 400 || res.status === 404) {
        chirpBroken = true;
        console.error(`[calls] Chirp voice not available (${res.status}: ${googleError(data)}); using standard Google voices`);
      } else throw new Error(`text-to-speech ${res.status}: ${googleError(data)}`);
    }
    const { res, data } = await call(GOOGLE_VOICE[lang], SAMPLE_RATE, 1.05);
    if (!res.ok || !data.audioContent) throw new Error(`text-to-speech ${res.status}: ${googleError(data)}`);
    return pcm8k(Buffer.from(data.audioContent, 'base64'));
  },
};

let override: { stt: SpeechToText; tts: TextToSpeech } | null = null;
/** Tests swap in fakes. */
export function setVoice(v: { stt: SpeechToText; tts: TextToSpeech } | null) {
  override = v;
}
export const voiceEnabled = () => !!override || env.CALL_VOICE === 'google' || !!env.SARVAM_API_KEY;
export const voice = () => override ?? (env.CALL_VOICE === 'google' ? { stt: googleStt, tts: googleTts } : { stt: sarvamStt, tts: sarvamTts });
