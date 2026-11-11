import { timingSafeEqual } from 'node:crypto';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { env } from '../../config/env.js';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf, viewerOf } from '../auth/guard.js';
import { indianNumber } from './safety.js';
import { CallSession } from './session.js';
import { addOptout, agencyForNumber, balance, getCall, isOptedOut, listCalls, listOptouts, listQuery, optoutBody, overview, refusal, removeOptout, saveSettings, settingsBody, settingsOf } from './service.js';
import { voiceEnabled } from './voice.js';
import { aiEnabled } from '../ai/quote-draft.js';
import { db } from '../../lib/db.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

type Id = { Params: { id: string } };
const auth = { preHandler: requireAuth };
const admin = { preHandler: requireRole('ADMIN') };

/** Calls on at once on this server. An e2-medium only relays audio, but there's no point letting it drown. */
const MAX_LIVE = 8;
const live = new Set<CallSession>();

const sameToken = (given: string | undefined) => {
  if (!env.CALL_STREAM_TOKEN || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.CALL_STREAM_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function callRoutes(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  app.get('/api/calls', auth, async (req) => ({ ...(await overview(viewerOf(req))), ...(await listCalls(viewerOf(req), listQuery.parse(req.query))) }));
  app.get('/api/calls/log', auth, async (req) => listCalls(viewerOf(req), listQuery.parse(req.query)));
  app.get<Id>('/api/calls/log/:id', auth, async (req) => getCall(viewerOf(req), req.params.id));
  app.put('/api/calls/settings', admin, async (req) => saveSettings(viewerOf(req), parseBody(settingsBody, req.body)));
  app.get('/api/calls/do-not-call', auth, async (req) => listOptouts(tenantOf(req)));
  app.post('/api/calls/do-not-call', admin, async (req, reply) => {
    const b = parseBody(optoutBody, req.body);
    return reply.code(201).send(await addOptout(tenantOf(req), b.phone, b.reason));
  });
  app.delete<Id>('/api/calls/do-not-call/:id', admin, async (req) => removeOptout(tenantOf(req), req.params.id));

  /**
   * Practice call from the website: the agency owner talks to their AI through the browser's
   * microphone, no phone line needed. Same listening, thinking and voice as a real call, but
   * free (no wallet minutes) and capped at 3 minutes. Binary frames are 8 kHz 16-bit PCM both ways.
   */
  app.get('/api/calls/test', { websocket: true, preHandler: admin.preHandler }, (socket: WebSocket, req) => {
    const send = (m: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
    const refuse = (why: string) => {
      send({ event: 'refused', why });
      socket.close(1000, why);
    };
    // The login cookie rides along on every socket, so only accept pages served from this site
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return refuse('forbidden');
    const tenantId = tenantOf(req);
    let session: CallSession | null = null;
    const early: Buffer[] = [];

    void (async () => {
      const [tenant, settings] = await Promise.all([db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }), settingsOf(tenantId)]);
      const why = !tenant ? 'agency_inactive' : !voiceEnabled() || !aiEnabled() ? 'not_configured' : live.size >= MAX_LIVE ? 'busy' : await refusal(tenantId, settings, true);
      if (why || !tenant) return refuse(why ?? 'agency_inactive');
      session = new CallSession(
        tenant,
        settings,
        'Practice call',
        {
          play: (pcm) => {
            for (let i = 0; i < pcm.length; i += 1600) socket.readyState === socket.OPEN && socket.send(pcm.subarray(i, i + 1600));
          },
          clear: () => send({ event: 'clear' }),
          hangUp: () => socket.close(1000, 'done'),
        },
        { minutesLeft: 3, test: true },
      );
      live.add(session);
      send({ event: 'ready' });
      for (const b of early.splice(0)) session.hear(b);
      await session.start().catch((err) => {
        req.log.error(err, 'practice call could not start');
        socket.close(1011, 'error');
      });
    })().catch((err) => {
      req.log.error(err, 'practice call failed');
      socket.close(1011, 'error');
    });

    socket.on('message', (raw, isBinary) => {
      if (!isBinary) return;
      const b = Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]);
      if (session) session.hear(b);
      else if (early.length < 50) early.push(b);
    });
    socket.on('close', () => {
      if (!session) return;
      live.delete(session);
      void session.finish();
    });
    socket.on('error', (err) => req.log.warn(err, 'practice call socket error'));
  });

  /**
   * The phone line. Exotel's Voicebot applet opens this socket when someone dials an agency's
   * Dhrona calling number (or a call is forwarded to it) and streams 8 kHz audio both ways.
   * If the call can't be taken (calling off, no minutes, unknown number), the socket closes and
   * Exotel moves on to the next step in the call flow, such as ringing the agency's office.
   */
  app.get<{ Querystring: { token?: string } }>('/api/calls/stream', { websocket: true }, (socket: WebSocket, req) => {
    // The secret comes in the address (?token=…); Exotel may instead pass it on as a custom parameter in "start"
    let trusted = sameToken(req.query.token);
    if (!env.CALL_STREAM_TOKEN) {
      socket.close(1008, 'forbidden');
      return;
    }
    const knock = setTimeout(() => !trusted && socket.close(1008, 'forbidden'), 10_000);
    socket.on('close', () => clearTimeout(knock));
    let session: CallSession | null = null;
    let streamSid = '';
    const send = (m: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));

    socket.on('message', async (raw) => {
      let m: ExotelEvent;
      try {
        m = JSON.parse(raw.toString()) as ExotelEvent;
      } catch {
        return;
      }
      if (m.event === 'start' && !trusted) trusted = sameToken(m.start?.custom_parameters?.token);
      if (!trusted) {
        if (m.event === 'start' || m.event === 'media') socket.close(1008, 'forbidden');
        return;
      }
      if (m.event === 'start' && !session) {
        const s = m.start ?? {};
        streamSid = s.stream_sid ?? m.stream_sid ?? '';
        const caller = indianNumber(s.from);
        const found = await agencyForNumber(s.to ?? '');
        const why = !found ? 'unknown_number' : !caller ? 'no_caller_id' : !voiceEnabled() || !aiEnabled() ? 'not_configured' : live.size >= MAX_LIVE ? 'busy' : await refusal(found.tenant.id, found.settings);
        if (why || !found || !caller) {
          req.log.info({ why, to: s.to }, 'AI Caller did not take the call');
          socket.close(1000, why ?? 'refused');
          return;
        }
        if (await isOptedOut(found.tenant.id, caller)) req.log.info('caller is on the do-not-call list; answering since they called us');
        session = new CallSession(
          found.tenant,
          found.settings,
          caller,
          {
            play: (pcm) => {
              // Exotel takes audio in chunks that are multiples of 320 bytes; 100 ms each keeps it smooth
              for (let i = 0; i < pcm.length; i += 1600) send({ event: 'media', stream_sid: streamSid, media: { payload: pcm.subarray(i, i + 1600).toString('base64') } });
            },
            clear: () => send({ event: 'clear', stream_sid: streamSid }),
            hangUp: () => socket.close(1000, 'done'),
          },
          { minutesLeft: await balance(found.tenant.id), providerCallId: s.call_sid },
        );
        live.add(session);
        await session.start().catch((err) => {
          req.log.error(err, 'AI Caller could not start');
          socket.close(1011, 'error');
        });
      } else if (m.event === 'media' && session && m.media?.payload) {
        session.hear(Buffer.from(m.media.payload, 'base64'));
      } else if (m.event === 'stop') {
        socket.close(1000, 'stopped');
      }
    });
    socket.on('close', () => {
      if (!session) return;
      live.delete(session);
      void session.finish();
    });
    socket.on('error', (err) => req.log.warn(err, 'call socket error'));
  });
}

type ExotelEvent = {
  event: 'connected' | 'start' | 'media' | 'mark' | 'dtmf' | 'stop' | 'clear';
  stream_sid?: string;
  start?: { stream_sid?: string; call_sid?: string; from?: string; to?: string; custom_parameters?: Record<string, string> };
  media?: { payload?: string };
};
