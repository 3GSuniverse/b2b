import { env } from '../../config/env.js';
import type { tenants } from '../../db/schema.js';
import { callContext, greetingFor, nextTurn, optOutLine, sorryLine, timeUpLine, type CallContext, type Outcome, type Turn } from './brain.js';
import { wantsNoCalls } from './safety.js';
import { addOptout, finishCall, startCall, type CallSettings } from './service.js';
import { durationMs, FRAME_BYTES, sentences, Vad, voice, type Lang } from './voice.js';

/** What a call needs from the phone line: send audio, stop audio, hang up. */
export interface Line {
  play(pcm: Buffer): void;
  /** Drop audio that was sent but hasn't played yet (the caller interrupted). */
  clear(): void;
  hangUp(): void;
}

const SILENCE_NUDGE_MS = 15_000;
const SILENCE_END_MS = 25_000;

/**
 * One live phone call: listens, thinks, speaks, and lets the caller interrupt at any moment.
 *
 * Every reply carries a "turn" number. When the caller starts talking over the assistant, the
 * line is cleared and the turn number moves on, so anything still being prepared for the old
 * turn is quietly dropped instead of being spoken over them.
 */
export class CallSession {
  private ctx!: CallContext;
  private callId!: string;
  private readonly history: Turn[] = [];
  private lang: Lang;
  private turn = 0;
  private heard = 0; // utterances received; only the newest one gets an answer
  private playingUntil = 0;
  private startedAt = Date.now();
  private outcome: Outcome | null = null;
  private summary: string | null = null;
  private ending = false;
  private finished = false;
  private failed = false;
  private lastActivity = Date.now();
  private nudged = false;
  private timers: NodeJS.Timeout[] = [];
  private pending: Buffer = Buffer.alloc(0);
  private readonly vad: Vad;

  constructor(
    private readonly tenant: typeof tenants.$inferSelect,
    private readonly settings: CallSettings,
    private readonly phone: string,
    private readonly line: Line,
    private readonly opts: { minutesLeft: number; providerCallId?: string },
  ) {
    this.lang = settings.language;
    this.vad = new Vad({ start: () => this.onSpeechStart(), utterance: (pcm) => void this.onUtterance(pcm) });
  }

  get speaking() {
    return Date.now() < this.playingUntil;
  }

  async start() {
    const row = await startCall(this.tenant.id, { direction: 'IN', phone: this.phone, purpose: this.settings.purpose, providerCallId: this.opts.providerCallId });
    this.callId = row.id;
    this.startedAt = Date.now();
    this.ctx = await callContext(this.tenant, this.settings, this.phone);
    // Never longer than the plan's cap or the minutes left in the wallet
    const limitMs = Math.min(env.CALL_MAX_MINUTES, this.opts.minutesLeft) * 60_000;
    this.timers.push(setTimeout(() => void this.wrapUp(timeUpLine[this.lang], 'CALLBACK'), Math.max(20_000, limitMs - 20_000)));
    this.timers.push(setInterval(() => this.checkSilence(), 1_000));
    await this.say(greetingFor(this.settings, this.tenant.name), this.turn);
  }

  /** Raw 8 kHz PCM from the caller, in any chunk size. */
  hear(pcm: Buffer) {
    if (this.finished) return;
    this.pending = this.pending.length ? Buffer.concat([this.pending, pcm]) : pcm;
    while (this.pending.length >= FRAME_BYTES) {
      this.vad.push(this.pending.subarray(0, FRAME_BYTES));
      this.pending = this.pending.subarray(FRAME_BYTES);
    }
  }

  private onSpeechStart() {
    this.lastActivity = Date.now();
    if (this.speaking && !this.ending) {
      // Barge-in: stop talking the moment they start
      this.turn++;
      this.line.clear();
      this.playingUntil = 0;
    }
  }

  private async onUtterance(pcm: Buffer) {
    if (this.ending || this.finished) return;
    const mine = ++this.heard;
    this.lastActivity = Date.now();
    let text: string;
    try {
      const r = await voice().stt.transcribe(pcm, this.lang);
      text = r.text;
      this.lang = r.lang;
    } catch (err) {
      console.error('[calls] speech-to-text failed', err);
      return; // one missed sentence isn't worth ending the call; they'll repeat
    }
    if (!text || this.finished) return;
    this.history.push({ from: 'customer', text });
    if (wantsNoCalls(text)) {
      await addOptout(this.tenant.id, this.phone, 'Asked on a call').catch(() => undefined);
      return this.wrapUp(optOutLine[this.lang], 'NOT_INTERESTED');
    }
    // They kept talking: the newer utterance will be answered with everything they said
    if (mine !== this.heard) return;
    const turn = ++this.turn;
    try {
      const a = await nextTurn(this.ctx, this.history, this.lang);
      if (turn !== this.turn || this.finished) return;
      if (a.outcome) this.setOutcome(a.outcome);
      if (a.summary) this.summary = a.summary;
      this.lang = a.language;
      if (a.end) return this.wrapUp(a.say, a.outcome ?? this.outcome ?? 'ANSWERED');
      await this.say(a.say, turn);
    } catch (err) {
      console.error('[calls] reply failed', err);
      this.failed = this.history.filter((t) => t.from === 'customer').length <= 1;
      await this.wrapUp(sorryLine[this.lang], 'NEEDS_HUMAN');
    }
  }

  /** Speaks sentence by sentence: the first one plays while the next is still being voiced. */
  private async say(text: string, turn: number) {
    const parts = sentences(text);
    const spoken: string[] = [];
    let next = parts.length ? voice().tts.speak(parts[0]!, this.lang) : null;
    for (let i = 0; i < parts.length && next; i++) {
      let audio: Buffer;
      try {
        audio = await next;
      } catch (err) {
        console.error('[calls] text-to-speech failed', err);
        break;
      }
      next = i + 1 < parts.length ? voice().tts.speak(parts[i + 1]!, this.lang) : null;
      if (turn !== this.turn || this.finished) {
        next?.catch(() => undefined);
        return;
      }
      this.line.play(audio);
      this.playingUntil = Math.max(Date.now(), this.playingUntil) + durationMs(audio);
      spoken.push(parts[i]!);
    }
    if (spoken.length) this.history.push({ from: 'agent', text: spoken.join(' ') });
    this.lastActivity = Date.now();
  }

  /** A plain "answered" never hides that the caller was interested. */
  private setOutcome(o: Outcome) {
    if (o === 'ANSWERED' && this.outcome && this.outcome !== 'ANSWERED') return;
    this.outcome = o;
  }

  private async wrapUp(text: string, outcome: Outcome) {
    if (this.ending || this.finished) return;
    this.ending = true;
    this.setOutcome(outcome);
    const turn = ++this.turn;
    await this.say(text, turn);
    const wait = Math.max(0, this.playingUntil - Date.now()) + 400;
    this.timers.push(setTimeout(() => this.line.hangUp(), wait));
  }

  private checkSilence() {
    if (this.ending || this.finished || this.speaking || this.vad.isSpeaking) return;
    const quiet = Date.now() - Math.max(this.lastActivity, this.playingUntil);
    if (quiet > SILENCE_END_MS) void this.wrapUp(sorryLine[this.lang], this.outcome ?? 'CALLBACK');
    else if (quiet > SILENCE_NUDGE_MS && !this.nudged) {
      this.nudged = true;
      void this.say({ en: 'Hello, are you there?', te: 'హలో, వినిపిస్తోందా?', hi: 'हैलो, आप सुन पा रहे हैं?' }[this.lang], this.turn);
    }
  }

  /** The line closed (either side hung up). Saves the call once. */
  async finish() {
    if (this.finished) return;
    this.finished = true;
    for (const t of this.timers) clearTimeout(t);
    if (!this.callId) return;
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    await finishCall(this.tenant.id, this.callId, { seconds, transcript: this.history, outcome: this.outcome ?? (this.history.some((t) => t.from === 'customer') ? 'ANSWERED' : null), summary: this.summary, failed: this.failed }).catch((err) =>
      console.error('[calls] could not save call', err),
    );
  }

  get id() {
    return this.callId;
  }
}
