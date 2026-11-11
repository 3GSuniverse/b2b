import { useQueryClient } from '@tanstack/react-query';
import { Mic, PhoneOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Panel } from '@/components/ui/display';
import { cn } from '@/lib/cn';

const RATE = 8000;
type Phase = 'idle' | 'connecting' | 'live' | 'ended';
type Lang = 'en' | 'te' | 'hi';
type Line = { from: 'agent' | 'customer'; text: string };
const LANGS: { value: Lang; label: string }[] = [
  { value: 'te', label: 'Telugu' },
  { value: 'hi', label: 'Hindi' },
  { value: 'en', label: 'English' },
];

const WHY: Record<string, string> = {
  not_configured: 'The voice or AI isn’t switched on in the server yet. Set CALL_VOICE and an AI provider in deploy/.env, then deploy.',
  plan: 'The AI Caller comes with the Professional plan and above.',
  suspended: 'Calling is switched off for this agency.',
  agency_inactive: 'This agency isn’t active right now.',
  busy: 'The AI Caller is busy right now. Try again in a minute.',
  forbidden: 'Open this page from your Dhrona address and try again.',
};

/** Averages groups of input samples down to 8 kHz, which is all a phone line carries. */
function makeDownsampler(inRate: number) {
  const ratio = inRate / RATE;
  let carry: number[] = [];
  return (input: Float32Array) => {
    const all = carry.length ? [...carry, ...input] : Array.from(input);
    const outLen = Math.floor(all.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += all[j] ?? 0;
      const v = Math.max(-1, Math.min(1, sum / (to - from)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    carry = all.slice(Math.floor(outLen * ratio));
    return out;
  };
}

/**
 * Talk to your own AI Caller from the browser, no phone line needed. Same listening, thinking and
 * voice as a real call; free, and it stops after 3 minutes.
 */
export function PracticeCall({ defaultLang = 'en', onDone }: { defaultLang?: Lang; onDone?: () => void }) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [lines, setLines] = useState<Line[]>([]);
  const [timing, setTiming] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [talking, setTalking] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  async function begin() {
    setNote(null);
    setLines([]);
    setTiming(null);
    setPhase('connecting');
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch {
      setNote('Allow the microphone in your browser (the lock icon next to the address), then try again.');
      setPhase('idle');
      return;
    }
    const ctx = new AudioContext();
    await ctx.resume();
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/calls/test?lang=${lang}`);
    ws.binaryType = 'arraybuffer';
    const sources = new Set<AudioBufferSourceNode>();
    let nextAt = 0;
    let closed = false;

    const source = ctx.createMediaStreamSource(mic);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const down = makeDownsampler(ctx.sampleRate);
    let lastLevel = 0;
    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      if (ws.readyState === WebSocket.OPEN) {
        const pcm = down(input);
        if (pcm.length) ws.send(pcm.buffer);
      }
      const now = performance.now();
      if (now - lastLevel > 100) {
        lastLevel = now;
        let s = 0;
        for (let i = 0; i < input.length; i += 8) s += (input[i] ?? 0) ** 2;
        setLevel(Math.min(1, Math.sqrt(s / (input.length / 8)) * 6));
      }
    };
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    const speakingTimer = setInterval(() => setTalking(nextAt > ctx.currentTime), 150);

    const end = (why?: string) => {
      if (closed) return;
      closed = true;
      clearInterval(speakingTimer);
      sources.forEach((s) => s.stop());
      node.disconnect();
      source.disconnect();
      mic.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (ws.readyState <= WebSocket.OPEN) ws.close();
      stop.current = null;
      setTalking(false);
      setLevel(0);
      setNote(why ?? null);
      setPhase('ended');
      void qc.invalidateQueries({ queryKey: ['calls'] });
      onDone?.();
    };
    stop.current = () => end();

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data) as { event: string; why?: string; from?: Line['from']; text?: string; heardMs?: number; thinkMs?: number; voiceMs?: number };
        if (m.event === 'ready') setPhase('live');
        else if (m.event === 'line' && m.from && m.text) setLines((l) => [...l.slice(-7), { from: m.from!, text: m.text! }]);
        else if (m.event === 'timing') setTiming(`${(((m.heardMs ?? 0) + (m.thinkMs ?? 0) + (m.voiceMs ?? 0)) / 1000).toFixed(1)}s to answer: hearing ${((m.heardMs ?? 0) / 1000).toFixed(1)}s, thinking ${((m.thinkMs ?? 0) / 1000).toFixed(1)}s, voice ${((m.voiceMs ?? 0) / 1000).toFixed(1)}s`);
        else if (m.event === 'refused') end(WHY[m.why ?? ''] ?? 'The AI Caller couldn’t take this call. Check the setup steps below.');
        else if (m.event === 'clear') {
          sources.forEach((s) => s.stop());
          sources.clear();
          nextAt = 0;
        }
        return;
      }
      const pcm = new Int16Array(e.data as ArrayBuffer);
      if (!pcm.length) return;
      const buf = ctx.createBuffer(1, pcm.length, RATE);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] ?? 0) / 0x8000;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      nextAt = Math.max(nextAt, ctx.currentTime + 0.05);
      src.start(nextAt);
      nextAt += buf.duration;
      sources.add(src);
      src.onended = () => sources.delete(src);
    };
    ws.onclose = () => end();
    ws.onerror = () => end('Couldn’t connect. Check that you’re signed in and the server is running.');
  }

  const live = phase === 'live';
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-4 bg-[linear-gradient(120deg,#fff0d9,#ffe1ec)] p-5 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-primary text-white transition-transform', talking && 'scale-110')}>
            <Mic className="h-5 w-5" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-[15px] font-semibold">Talk to your AI Caller right now</h2>
            <p className="text-[13px] leading-relaxed text-ink-2">
              {phase === 'connecting'
                ? 'Connecting…'
                : live
                  ? talking
                    ? 'Your AI is speaking. You can interrupt it, just like a real call.'
                    : 'Listening. Say hello, or ask about your packages.'
                  : phase === 'ended'
                    ? (note ?? 'Call finished. It’s saved in your call log below.')
                    : 'No phone needed. Use your laptop or phone microphone (headphones work best). Free, and it stops after 3 minutes.'}
            </p>
            {note && phase === 'idle' && <p className="text-[13px] font-medium text-danger">{note}</p>}
            {live && (
              <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
        {live || phase === 'connecting' ? (
          <Button variant="danger" onClick={() => stop.current?.()}>
            <PhoneOff className="h-4 w-4" /> Hang up
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void begin()}>
            <Mic className="h-4 w-4" /> {phase === 'ended' ? 'Call again' : 'Start talking'}
          </Button>
        )}
      </div>
      {!live && phase !== 'connecting' && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <span className="text-[13px] font-medium text-ink-2">Practice in</span>
          <Segmented label="Practice language" value={lang} onChange={(v) => setLang(v)} options={LANGS} />
        </div>
      )}
      {lines.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line bg-sunken/50 p-4">
          {lines.map((l, i) => (
            <div key={i} className={cn('max-w-[85%] rounded-[14px] px-3 py-2 text-[13.5px] leading-relaxed', l.from === 'agent' ? 'self-start bg-white shadow-sm' : 'self-end bg-primary text-on-primary')}>
              {l.text}
            </div>
          ))}
          {timing && <p className="self-center text-[12px] text-muted">{timing}</p>}
        </div>
      )}
    </Panel>
  );
}
