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
  /** `think`: a token budget for thinking before answering (extended thinking). The answer still gets maxTokens. */
  complete(input: { system: string; prompt: string; maxTokens: number; model?: string; think?: number }): Promise<string>;
}

/** AI failures are logged too, so `drona logs` shows the provider's own words. */
function logAi(e: AppError) {
  console.error(`[ai] ${e.message}`);
  return e;
}

/** A request to the AI service. Network failures and timeouts become a clear message instead of "Something went wrong". */
async function aiFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const why = e.name === 'TimeoutError' ? 'it took too long to answer' : (e.cause?.code ?? e.message);
    console.error(`[ai] couldn't reach ${new URL(url).host}:`, e.cause ?? e);
    throw new AppError(503, 'ai_unreachable', `Couldn’t reach the AI service (${why}). Try again in a moment.`);
  }
}

const anthropic: AiClient = {
  async complete({ system, prompt, maxTokens, model, think }) {
    // Claude's extended thinking needs at least 1,024 tokens of budget
    const budget = think && think >= 1024 ? think : 0;
    const thinking = budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {};
    const res = await aiFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model ?? env.AI_MODEL ?? 'claude-sonnet-5-5', max_tokens: maxTokens + budget, ...thinking, system, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!res.ok) throw logAi(new AppError(503, 'ai_error', `The AI service answered with an error: ${data.error?.message ?? res.status}`));
    return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  },
};

const openai: AiClient = {
  async complete({ system, prompt, maxTokens, model: wanted, think }) {
    const model = wanted ?? env.AI_MODEL ?? 'gpt-5-mini';
    // GPT-5 and o-series models think before answering; that thinking counts toward the token limit
    const reasoning = /^(gpt-5|o\d)/.test(model);
    const res = await aiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY!}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: reasoning ? maxTokens + Math.max(maxTokens * 2, think ?? 0) : maxTokens,
        ...(reasoning ? { reasoning_effort: think ? 'medium' : 'low' } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };
    if (!res.ok) throw logAi(new AppError(503, 'ai_error', `The AI service answered with an error: ${data.error?.message ?? res.status}`));
    return data.choices?.[0]?.message?.content ?? '';
  },
};

/** Gemini's request is the same on Google AI Studio and on Vertex AI; only the address and sign-in differ. */
async function geminiCall(url: string, headers: Record<string, string>, { system, prompt, maxTokens, model, think }: { system: string; prompt: string; maxTokens: number; model: string; think?: number }) {
  // 2.5 models bill thinking as output: off unless asked for, then capped at the budget given
  const thinking = /^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: think ?? 0 } } : {};
  const res = await aiFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens + (think ?? 0), ...thinking },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; error?: { message?: string } };
  if (!res.ok) throw logAi(new AppError(503, 'ai_error', `The AI service answered with an error: ${data.error?.message ?? res.status}`));
  return (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
}

const gemini: AiClient = {
  async complete({ model, ...rest }) {
    const m = model ?? env.AI_MODEL ?? 'gemini-2.5-flash';
    return geminiCall(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { 'x-goog-api-key': env.GEMINI_API_KEY! }, { ...rest, model: m });
  },
};

/**
 * Gemini on Vertex AI, inside Google Cloud. No API key: the VM signs in with its own service
 * account through the metadata server, it's billed on the Google Cloud bill (credits apply),
 * and customers' messages aren't used to train Google's models.
 */
const METADATA = 'http://metadata.google.internal/computeMetadata/v1';
let vertexToken: { value: string; until: number } | null = null;
let vertexProject: string | null = null;
async function fromMetadata(path: string) {
  const res = await fetch(`${METADATA}/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!res?.ok) throw logAi(new AppError(503, 'ai_error', 'Vertex AI: couldn’t sign in with the VM’s service account. Is the server running on Google Cloud with access to Cloud APIs?'));
  return res;
}
/** Tests start from a clean sign-in. */
export function resetVertexCache() {
  vertexToken = null;
  vertexProject = null;
}
const vertex: AiClient = {
  async complete({ model, ...rest }) {
    const m = model ?? env.AI_MODEL ?? 'gemini-2.5-flash';
    if (!vertexToken || vertexToken.until < Date.now()) {
      const t = (await (await fromMetadata('instance/service-accounts/default/token')).json()) as { access_token: string; expires_in: number };
      vertexToken = { value: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
    }
    vertexProject ??= env.VERTEX_PROJECT ?? (await (await fromMetadata('project/project-id')).text()).trim();
    const loc = env.VERTEX_LOCATION;
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    return geminiCall(`https://${host}/v1/projects/${vertexProject}/locations/${loc}/publishers/google/models/${encodeURIComponent(m)}:generateContent`, { authorization: `Bearer ${vertexToken.value}` }, { ...rest, model: m });
  },
};

export const providers = { anthropic, openai, gemini, vertex }; // exported for tests

/** The model for short WhatsApp replies: cheap and fast. Quote drafts keep the stronger default. */
export function replyModel() {
  const p = aiProvider();
  return env.AI_REPLY_MODEL ?? (p === 'openai' ? 'gpt-5-mini' : p === 'gemini' || p === 'vertex' ? 'gemini-2.5-flash-lite' : 'claude-haiku-5-5');
}

let client: AiClient | null = null;
export function setAiClient(c: AiClient | null) {
  client = c;
}
/** Which provider is set up: the one AI_PROVIDER names, else whichever key is present (Anthropic, then OpenAI, then Gemini). */
export function aiProvider(): 'anthropic' | 'openai' | 'gemini' | 'vertex' | null {
  // Vertex needs no key (the VM's service account signs in), so it's on only when AI_PROVIDER=vertex
  const has = { anthropic: !!env.ANTHROPIC_API_KEY, openai: !!env.OPENAI_API_KEY, gemini: !!env.GEMINI_API_KEY, vertex: true };
  if (env.AI_PROVIDER) return has[env.AI_PROVIDER] ? env.AI_PROVIDER : null;
  return has.anthropic ? 'anthropic' : has.openai ? 'openai' : has.gemini ? 'gemini' : null;
}
export const aiEnabled = () => !!client || aiProvider() !== null;
export const getClient = () => client ?? ({ anthropic, openai, gemini, vertex, none: null } as const)[aiProvider() ?? 'none'];

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
  if (!parsed.success) throw new AppError(503, 'ai_bad_answer', 'The AI’s answer didn’t come back in the right shape. Try again.');
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
