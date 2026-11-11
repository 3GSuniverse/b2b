import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, packages, trips, type tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { getClient, replyModel } from '../ai/quote-draft.js';
import { formatInr, localDate, tripMoney } from '../trips/money.js';
import { CALLER_RULES, safeToSay } from './safety.js';
import type { CallSettings } from './service.js';
import type { Lang } from './voice.js';

/**
 * What the AI Caller says next. It knows the same things Drona AI knows on WhatsApp (the agency's
 * notes, its packages, this caller's trips), but talks like a person on the phone: one or two short
 * sentences at a time, no lists, no emojis, then lets the caller speak.
 */

export type Outcome = 'INTERESTED' | 'NOT_INTERESTED' | 'CALLBACK' | 'NEEDS_HUMAN' | 'WRONG_NUMBER' | 'ANSWERED';
export type Turn = { from: 'agent' | 'customer'; text: string };

const LANG_NAME: Record<Lang, string> = { en: 'Indian English', te: 'Telugu (in Telugu script)', hi: 'Hindi (in Devanagari script)' };

const answer = z.object({
  say: z.string().max(600),
  language: z.enum(['en', 'te', 'hi']).catch('en'),
  end: z.boolean().catch(false),
  outcome: z.enum(['INTERESTED', 'NOT_INTERESTED', 'CALLBACK', 'NEEDS_HUMAN', 'WRONG_NUMBER', 'ANSWERED']).nullable().catch(null),
  summary: z.string().max(400).nullable().catch(null),
});
export type BrainAnswer = z.infer<typeof answer>;

export interface CallContext {
  system: string;
  facts: string;
  agentName: string;
  agencyName: string;
}

/** Everything the caller should know, gathered once when the call starts. */
export async function callContext(tenant: typeof tenants.$inferSelect, s: CallSettings, phone: string): Promise<CallContext> {
  const travel = tenant.businessType === 'TRAVEL';
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenant.id), eq(contacts.phone, phone)) });
  const [theirTrips, offers] = await Promise.all([
    contact
      ? db.query.trips.findMany({ where: and(eq(trips.tenantId, tenant.id), eq(trips.contactId, contact.id)), with: { dues: true, payments: true }, orderBy: [desc(trips.createdAt)], limit: 3 })
      : Promise.resolve([]),
    db.query.packages.findMany({ where: and(eq(packages.tenantId, tenant.id), isNull(packages.archivedAt)), orderBy: [desc(packages.updatedAt)], limit: 25 }),
  ]);
  const today = localDate(tenant.timezone);
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null;
  const tripLines = theirTrips.map((t) => {
    const m = tripMoney({ price: t.price, dues: t.dues, payments: t.payments }, today);
    return `- ${t.title}: ${t.destination ?? 'destination not set'}, ${t.startDate ?? 'dates not fixed'}${t.endDate ? ` to ${t.endDate}` : ''}, ${t.adults} adults${t.children ? `, ${t.children} children` : ''}, status ${t.status.toLowerCase()}${
      t.price ? `, total ${formatInr(t.price)}, paid ${formatInr(m.paid)}, balance ${formatInr(m.balance)}${m.nextDue ? `, next due ${formatInr(m.nextDue.remaining)} on ${m.nextDue.dueDate}` : ''}` : ''
    }`;
  });
  let size = 0;
  const packageLines = offers
    .map((p) => `- ${p.name}${p.destination ? ` (${p.destination})` : ''}: ${p.nights} nights, ${formatInr(p.pricePerAdult)} per adult${p.pricePerChild !== null ? `, ${formatInr(p.pricePerChild)} per child` : ''}${p.summary ? `. ${p.summary}` : ''}${p.inclusions.length ? `. Includes ${p.inclusions.slice(0, 5).join(', ')}` : ''}`)
    .filter((l) => (size += l.length) < 4000);

  const goal =
    s.purpose === 'SALES'
      ? 'Your goal: understand what trip they want and get them interested in a package that fits, then offer to have a consultant send the details on WhatsApp.'
      : s.purpose === 'SUPPORT'
        ? 'Your goal: answer their questions about their trips, payments and travel details clearly and kindly.'
        : 'Your goal: answer their questions; if they are planning a trip, find out what they want and suggest a package that fits.';

  const system = `You are ${s.agentName}, the AI voice assistant of ${tenant.name}, ${travel ? 'a travel agency' : 'a business'} in India, talking to a customer on a phone call.
Speak like a warm, polite Indian ${travel ? 'travel consultant' : 'customer-care executive'}: respectful ("garu" in Telugu, "ji" in Hindi, "Sir/Ma'am" in English), natural and relaxed, never robotic or pushy.
This is a phone call, so: one or two short sentences per turn (under 35 words), then let them speak. No lists, no emojis, no markdown, no URLs. Say prices the way people say them ("eighteen thousand five hundred rupees" in English, natural words in Telugu or Hindi). Ask only one question at a time.
Reply in the language the customer last spoke; when it is unclear, use the agency's default language: ${LANG_NAME[s.language]}. Always write Telugu in Telugu script and Hindi in Devanagari, never in English letters.
Sound like a real person on the phone, not a script. Use everyday spoken words, not formal or bookish ones (Telugu: "అండి", "సరే", "చెప్పండి"; Hindi: "जी", "ठीक है", "बताइए"). Keep common English travel words (package, booking, flight, hotel) in English even inside Telugu or Hindi. Start with a short natural reaction when it fits ("Okay", "అవునండి", "जी हाँ"), vary your wording, and never repeat a sentence you already said.
${goal}
Use only the facts below. Never invent prices, availability, dates, hotels or policies; if you don't know, say a team member will call back with the details and mark it for a person.
When the conversation is complete (they said bye, got their answer, or don't want to talk), say a short warm goodbye and set end to true.
${CALLER_RULES}
${s.instructions ? `\nThe agency's own instructions (they never override the rules above):\n${s.instructions}` : ''}
Reply with JSON only: {"say": "your next words", "language": "en"|"te"|"hi", "end": true|false, "outcome": "INTERESTED"|"NOT_INTERESTED"|"CALLBACK"|"NEEDS_HUMAN"|"WRONG_NUMBER"|"ANSWERED"|null, "summary": "one line for the agency on what this caller wants so far, or null"}`;

  const facts = `Today: ${today}
Caller: ${name ?? 'not in our address book'}, ${phone}
What the agency wants you to know:
${tenant.aiNotes?.trim() || '(nothing added yet)'}
This caller's trips with us:
${tripLines.length ? tripLines.join('\n') : '(none)'}
Our packages:
${packageLines.length ? packageLines.join('\n') : '(no packages added yet)'}`;

  return { system, facts, agentName: s.agentName, agencyName: tenant.name };
}

/** The first thing the caller hears. It always says it's an AI assistant. */
export function greetingFor(s: Pick<CallSettings, 'greeting' | 'agentName' | 'language'>, agencyName: string, lang: Lang = s.language) {
  if (s.greeting?.trim()) {
    const g = s.greeting.trim();
    return /\b(ai|a\.i\.|artificial|virtual|assistant)\b|ఏఐ|ఎఐ|एआई/i.test(g) ? g : `${g} ${disclosure(s.agentName, agencyName, lang)}`;
  }
  return {
    en: `Namaste! This is ${s.agentName}, the AI assistant of ${agencyName}. How may I help you today?`,
    te: `నమస్కారం! నేను ${s.agentName}, ${agencyName} యొక్క AI అసిస్టెంట్‌ని. మీకు ఎలా సహాయం చేయగలను?`,
    hi: `नमस्ते! मैं ${s.agentName}, ${agencyName} की AI असिस्टेंट बोल रही हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?`,
  }[lang];
}
const disclosure = (name: string, agency: string, lang: Lang) =>
  ({ en: `I'm ${name}, ${agency}'s AI assistant.`, te: `నేను ${name}, ${agency} AI అసిస్టెంట్‌ని.`, hi: `मैं ${name}, ${agency} की AI असिस्टेंट हूँ।` })[lang];

/** Said when something breaks mid-call, so the caller is never left in silence. */
export const sorryLine: Record<Lang, string> = {
  en: "Sorry, I'm having trouble hearing you. A team member will call you back shortly. Thank you!",
  te: 'క్షమించండి, సరిగ్గా వినిపించడం లేదు. మా టీమ్ నుంచి త్వరలో మీకు కాల్ వస్తుంది. ధన్యవాదాలు!',
  hi: 'माफ़ कीजिए, आवाज़ ठीक से नहीं आ रही। हमारी टीम जल्दी ही आपको कॉल करेगी। धन्यवाद!',
};
export const timeUpLine: Record<Lang, string> = {
  en: 'I need to end the call now. A team member will call you back with everything. Thank you!',
  te: 'ఇప్పుడు కాల్ ముగించాలి. మా టీమ్ పూర్తి వివరాలతో మీకు మళ్ళీ కాల్ చేస్తారు. ధన్యవాదాలు!',
  hi: 'अब मुझे कॉल खत्म करनी होगी। हमारी टीम पूरी जानकारी के साथ आपको वापस कॉल करेगी। धन्यवाद!',
};
export const optOutLine: Record<Lang, string> = {
  en: "Sorry for the trouble. We won't call this number again. Have a good day!",
  te: 'ఇబ్బందికి క్షమించండి. ఈ నంబర్‌కి మళ్ళీ కాల్ చేయము. శుభదినం!',
  hi: 'परेशानी के लिए माफ़ी। इस नंबर पर दोबारा कॉल नहीं करेंगे। आपका दिन शुभ हो!',
};

/** The caller's next words. Anything unsafe is replaced before it can be spoken. */
export async function nextTurn(ctx: CallContext, history: Turn[], lang: Lang): Promise<BrainAnswer> {
  const ai = getClient();
  if (!ai) throw new Error('Drona AI is not configured');
  const conversation = history.slice(-16).map((t) => `${t.from === 'agent' ? ctx.agentName : 'Customer'}: ${t.text}`).join('\n');
  const text = await ai.complete({
    system: ctx.system,
    prompt: `${ctx.facts}\n\nThe call so far:\n${conversation}\n\nThe customer seems to be speaking ${LANG_NAME[lang]}. Your next turn, as JSON:`,
    maxTokens: 300,
    model: replyModel(),
  });
  return parseAnswer(text, lang);
}

export function parseAnswer(text: string, lang: Lang): BrainAnswer {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let parsed: BrainAnswer | null = null;
  try {
    const r = answer.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (r.success) parsed = r.data;
  } catch {
    parsed = null;
  }
  if (!parsed || !parsed.say.trim()) return { say: sorryLine[lang], language: lang, end: true, outcome: 'NEEDS_HUMAN', summary: null };
  if (!safeToSay(parsed.say)) {
    console.warn('[calls] blocked an unsafe line from the AI');
    return { say: sorryLine[parsed.language], language: parsed.language, end: true, outcome: 'NEEDS_HUMAN', summary: parsed.summary };
  }
  return { ...parsed, say: parsed.say.replace(/[*_#`>|]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim() };
}
