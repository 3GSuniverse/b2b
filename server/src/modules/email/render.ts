import type { Contact, Tenant } from '../../db/schema.js';

/**
 * Merge tags: {first_name}, {city}, {trip_date}, with an optional fallback: {first_name|traveller}.
 * The tag must start right after "{" with a letter or "_", so CSS like `a{color:red}` is never touched.
 */
const TAG = /\{\s*([a-zA-Z_][\w]*)\s*(?:\|\s*([^{}]*?)\s*)?\}/g;

export type MergeVars = Record<string, string | number | boolean | null | undefined>;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replace merge tags. A tag whose key is unknown AND has no fallback is left untouched,
 * so the pre-send check can flag it instead of silently emailing a blank.
 */
export function renderString(template: string, vars: MergeVars, opts: { html: boolean }): string {
  return template.replace(TAG, (match, key: string, fallback: string | undefined) => {
    const known = Object.prototype.hasOwnProperty.call(vars, key);
    if (!known && fallback === undefined) return match;
    const raw = known ? vars[key] : undefined;
    const value = raw === null || raw === undefined || raw === '' ? (fallback ?? '') : String(raw);
    return opts.html ? escapeHtml(value) : value;
  });
}

/** Tags in a template that no contact can fill — shown as a warning before sending. */
export function findUnknownTags(template: string, knownKeys: Iterable<string>): string[] {
  const known = new Set(knownKeys);
  const unknown = new Set<string>();
  for (const m of template.matchAll(TAG)) {
    const [, key, fallback] = m;
    if (key && fallback === undefined && !known.has(key)) unknown.add(key);
  }
  return [...unknown];
}

function formatDate(value: string): string {
  // "2026-11-20" → "20 Nov 2026"
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const CORE_KEYS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'company_name', 'unsubscribe_url'];

export function buildMergeVars(
  contact: Pick<Contact, 'firstName' | 'lastName' | 'email' | 'phone' | 'attributes'> | null,
  tenant: Pick<Tenant, 'name'>,
  extra: MergeVars = {},
): MergeVars {
  const vars: MergeVars = {};
  const attrs = (contact?.attributes ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) vars[k] = formatDate(v);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') vars[k] = v;
  }
  // Core fields win over custom attributes with the same name
  Object.assign(vars, {
    first_name: contact?.firstName ?? '',
    last_name: contact?.lastName ?? '',
    full_name: [contact?.firstName, contact?.lastName].filter(Boolean).join(' '),
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    company_name: tenant.name,
    ...extra,
  });
  return vars;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Every marketing email must carry an unsubscribe link and the sender's postal address.
 * If the template already places {unsubscribe_url} itself, we respect its layout.
 */
export function ensureFooter(
  content: { html: string; text: string },
  tenant: Pick<Tenant, 'name' | 'postalAddress'>,
): { html: string; text: string } {
  let { html, text } = content;
  const address = tenant.postalAddress ? escapeHtml(tenant.postalAddress) : '';
  if (!/\{\s*unsubscribe_url\s*\}/.test(html)) {
    const footer =
      `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;` +
      `font:12px/1.6 Arial,Helvetica,sans-serif;color:#6b6b6b;text-align:center">` +
      `${escapeHtml(tenant.name)}${address ? ` · ${address}` : ''}<br>` +
      `Don’t want these emails? <a href="{unsubscribe_url}" style="color:#6b6b6b">Unsubscribe</a></div>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : html + footer;
  }
  if (!/\{\s*unsubscribe_url\s*\}/.test(text)) {
    text += `\n\n—\n${tenant.name}${tenant.postalAddress ? `, ${tenant.postalAddress}` : ''}\nUnsubscribe: {unsubscribe_url}`;
  }
  return { html, text };
}

export interface RenderInput {
  subject: string;
  html: string;
  text?: string | null;
  previewText?: string | null;
}

export function renderEmail(input: RenderInput, vars: MergeVars, tenant: Pick<Tenant, 'name' | 'postalAddress'>) {
  const baseText = input.text?.trim() ? input.text : htmlToText(input.html);
  const withFooter = ensureFooter({ html: input.html, text: baseText }, tenant);

  let html = renderString(withFooter.html, vars, { html: true });
  if (input.previewText) {
    // Hidden preheader — the grey line inboxes show next to the subject
    const pre = escapeHtml(renderString(input.previewText, vars, { html: false }));
    const hidden = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (b) => b + hidden) : hidden + html;
  }

  return {
    subject: renderString(input.subject, vars, { html: false }).replace(/[\r\n]+/g, ' ').trim(),
    html,
    text: renderString(withFooter.text, vars, { html: false }),
  };
}
