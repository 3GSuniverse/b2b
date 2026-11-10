import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { auditLogs, quotes, tenants, type QuoteLine } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { formatInr } from '../trips/money.js';
import { listRates } from '../quotes/service.js';
import { useAi } from '../plans/entitlements.js';

/**
 * "Draft with AI": writes the day-by-day plan and picks items from the agency's own price list.
 * Prices always come from the price list, never from the AI. Anything it suggests that isn't
 * on the list comes back at ₹0, for the agent to price.
 */

export interface AiClient {
  /** `model` overrides the default (replies use a cheaper one than quote drafts) */
  complete(input: { system: string; prompt: string; maxTokens: number; model?: string }): Promise<string>;
}

const anthropic: AiClient = {
  async complete({ system, prompt, maxTokens, model }) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model ?? env.AI_MODEL ?? 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new AppError(502, 'ai_error', `The AI service answered with an error: ${data.error?.message ?? res.status}`);
    return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  },
};

const openai: AiClient = {
  async complete({ system, prompt, maxTokens, model: wanted }) {
    const model = wanted ?? env.AI_MODEL ?? 'gpt-5-mini';
    // GPT-5 and o-series models think before answering; that thinking counts toward the token limit
    const reasoning = /^(gpt-5|o\d)/.test(model);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY!}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: reasoning ? maxTokens * 3 : maxTokens,
        ...(reasoning ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };
    if (!res.ok) throw new AppError(502, 'ai_error', `The AI service answered with an error: ${data.error?.message ?? res.status}`);
    return data.choices?.[0]?.message?.content ?? '';
  },
};

export const providers = { anthropic, openai }; // exported for tests

/** The model for short WhatsApp replies: cheap and fast. Quote drafts keep the stronger default. */
export function replyModel() {
  return env.AI_REPLY_MODEL ?? (aiProvider() === 'openai' ? 'gpt-5-mini' : 'claude-haiku-5-5');
}

let client: AiClient | null = null;
export function setAiClient(c: AiClient | null) {
  client = c;
}
/** Which provider is set up: the one AI_PROVIDER names, else whichever key is present (Anthropic first). */
export function aiProvider(): 'anthropic' | 'openai' | null {
  const has = { anthropic: !!env.ANTHROPIC_API_KEY, openai: !!env.OPENAI_API_KEY };
  if (env.AI_PROVIDER) return has[env.AI_PROVIDER] ? env.AI_PROVIDER : null;
  return has.anthropic ? 'anthropic' : has.openai ? 'openai' : null;
}
export const aiEnabled = () => !!client || aiProvider() !== null;
export const getClient = () => client ?? ({ anthropic, openai, none: null } as const)[aiProvider() ?? 'none'];

const LANG = { en: 'English', te: 'Telugu (Telugu script)', hi: 'Hindi (Devanagari script)' } as const;
export const draftBody = z.object({
  instructions: z.string().trim().max(1000).optional(),
  language: z.enum(['en', 'te', 'hi']).default('en'),
});

const answer = z.object({
  intro: z.string().max(2000),
  days: z.array(z.object({ title: z.string().max(120), description: z.string().max(3000) })).min(1).max(60),
  items: z
    .array(
      z.object({
        rateId: z.string().nullable().optional(),
        label: z.string().max(200),
        kind: z.enum(['HOTEL', 'TRANSPORT', 'ACTIVITY', 'TRAVEL', 'OTHER']),
        unit: z.enum(['PER_NIGHT', 'PER_DAY', 'PER_PERSON', 'PER_GROUP']),
        quantity: z.number().min(0).max(1000),
        times: z.number().int().min(1).max(365),
      }),
    )
    .max(60),
  inclusions: z.array(z.string().max(200)).max(30),
  exclusions: z.array(z.string().max(200)).max(30),
});

function extractJson(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function draftQuote(tenantId: string, userId: string, quoteId: string, input: z.infer<typeof draftBody>) {
  const ai = getClient();
  if (!ai) throw new AppError(503, 'ai_not_configured', 'AI drafting isn’t set up on this server yet.');
  const q = await db.query.quotes.findFirst({ where: and(eq(quotes.id, quoteId), eq(quotes.tenantId, tenantId)), with: { trip: true } });
  if (!q) throw new AppError(404, 'quote_not_found', 'Quote not found');
  if (q.status !== 'DRAFT') throw new AppError(409, 'quote_sent', 'This quote has been sent. Make a new version to change it.');

  // The plan's daily allowance: each draft costs real money
  await useAi(tenantId);

  const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
  const t = q.trip;
  const nights = t.startDate && t.endDate ? Math.max(0, Math.round((Date.parse(t.endDate) - Date.parse(t.startDate)) / 86_400_000)) : null;
  const rates = (await listRates(tenantId, { destination: t.destination ?? undefined })).slice(0, 80);

  const system = `You plan trips for ${tenant.name}, a travel agency in India. You write clear, warm, practical itineraries that a family can follow, with realistic travel times between places. You never invent prices or claim things are booked. Reply with JSON only.`;
  const prompt = `Trip
- Destination: ${t.destination ?? 'not given'}
- Dates: ${t.startDate ?? 'not fixed'}${t.endDate ? ` to ${t.endDate}` : ''}${nights !== null ? ` (${nights} nights, ${nights + 1} days)` : ''}
- Travellers: ${t.adults} adults, ${t.children} children
- Budget: ${t.budget ? formatInr(t.budget) : 'not given'}
- Agent's notes: ${t.notes ?? 'none'}
${input.instructions ? `- Extra instructions: ${input.instructions}\n` : ''}
Price list (use these ids for priced items; pick what fits the destination and budget):
${rates.length ? rates.map((r) => `${r.id} | ${r.kind} | ${r.name}${r.destination ? ` (${r.destination})` : ''} | ${r.unit} | ${formatInr(r.price)}`).join('\n') : '(empty)'}

Write in ${LANG[input.language]} for intro, day titles and descriptions, inclusions and exclusions. Keep item labels in English.
Return exactly this JSON shape:
{"intro": "2-3 sentences to the customer",
 "days": [{"title": "short title", "description": "what happens that day, 2-4 sentences"}],
 "items": [{"rateId": "id from the price list, or null if it isn't on the list", "label": "...", "kind": "HOTEL|TRANSPORT|ACTIVITY|TRAVEL|OTHER", "unit": "PER_NIGHT|PER_DAY|PER_PERSON|PER_GROUP", "quantity": rooms or vehicles or people, "times": nights or days, 1 for PER_PERSON and PER_GROUP}],
 "inclusions": ["..."], "exclusions": ["..."]}
${nights !== null ? `Make exactly ${nights + 1} days.` : 'Choose a sensible number of days.'} Hotels: about one room per 2 adults, for the nights they stay there.`;

  const text = await ai.complete({ system, prompt, maxTokens: 4000 });
  const parsed = answer.safeParse(extractJson(text));
  if (!parsed.success) throw new AppError(502, 'ai_bad_answer', 'The AI’s answer didn’t come back in the right shape. Try again.');
  await db.insert(auditLogs).values({ tenantId, userId, action: 'ai.draft', entity: 'quote', entityId: q.id, meta: { language: input.language } });

  const byId = new Map(rates.map((r) => [r.id, r]));
  const lines: (QuoteLine & { needsPrice: boolean })[] = parsed.data.items.map((i) => {
    const r = i.rateId ? byId.get(i.rateId) : undefined;
    return r
      ? { label: r.name, kind: r.kind, unit: r.unit, quantity: i.quantity, times: r.unit === 'PER_PERSON' || r.unit === 'PER_GROUP' ? 1 : i.times, unitPrice: r.price, unitCost: r.cost, rateItemId: r.id, needsPrice: false }
      : { label: i.label, kind: i.kind, unit: i.unit, quantity: i.quantity, times: i.times, unitPrice: 0, unitCost: null, rateItemId: null, needsPrice: true };
  });
  return { intro: parsed.data.intro, days: parsed.data.days, lines, inclusions: parsed.data.inclusions, exclusions: parsed.data.exclusions };
}
