import { env } from '../config/env.js';

/**
 * Links that agencies' customers open: payment pages, quotes, receipts, traveller forms and
 * unsubscribe. They use LINKS_URL when it's set, a neutral address that says nothing about
 * the platform, so a customer of any agency only ever sees that agency's name. Without it
 * they use PUBLIC_URL, as before.
 */
export const customerLink = (path: string) => `${(env.LINKS_URL ?? env.PUBLIC_URL).replace(/\/$/, '')}${path}`;

/** What may be opened on the links address: the customer pages and what they need, nothing else. */
const CUSTOMER_PATHS = [/^\/p\//, /^\/q\//, /^\/r\//, /^\/u\//, /^\/health$/, /^\/webhooks\//];

export function linksHost() {
  return env.LINKS_URL ? new URL(env.LINKS_URL).host.toLowerCase() : null;
}

/** On the links address, anything that isn't a customer page gets a plain page with no branding. */
export function blockedOnLinksHost(host: string | undefined, url: string) {
  const lh = linksHost();
  if (!lh || !host || host.toLowerCase() !== lh || lh === new URL(env.PUBLIC_URL).host.toLowerCase()) return false;
  const path = url.split('?')[0]!;
  return !CUSTOMER_PATHS.some((re) => re.test(path));
}

export const NOT_A_LINK_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not valid</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,sans-serif;color:#17153b;background:#f6f6f9}main{max-width:420px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#5e5d86}</style>
</head><body><main><h1>This link isn’t valid</h1><p>Please use the link from the message you received, or contact the travel agency that sent it.</p></main></body></html>`;
