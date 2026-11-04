import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/http.js';

// Only what we need: who the user is, and permission to SEND. We can never read their inbox.
export const GOOGLE_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'];
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Tests replace Google with a fake. */
export function setGoogleFetch(f: Fetch) {
  fetchImpl = f;
}

export interface GoogleOAuthFile {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
}

/** Reads the "Download JSON" file from Google Cloud → Clients. */
export function parseGoogleOAuthFile(contents: string): GoogleOAuthFile {
  let json: { web?: Record<string, unknown>; installed?: Record<string, unknown> };
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error('GOOGLE_OAUTH_JSON is not valid JSON');
  }
  const c = json.web ?? json.installed;
  if (!c || typeof c.client_id !== 'string' || typeof c.client_secret !== 'string') {
    throw new Error('GOOGLE_OAUTH_JSON does not look like a Google OAuth client file (expected "web.client_id")');
  }
  return {
    clientId: c.client_id,
    clientSecret: c.client_secret,
    redirectUris: Array.isArray(c.redirect_uris) ? c.redirect_uris.filter((u): u is string => typeof u === 'string') : [],
  };
}

let fromFile: GoogleOAuthFile | null | undefined;
function oauthFile(): GoogleOAuthFile | null {
  if (fromFile === undefined) {
    // A configured path with no file there yet just means "not set up", not a crash
    fromFile = env.GOOGLE_OAUTH_JSON && existsSync(env.GOOGLE_OAUTH_JSON) ? parseGoogleOAuthFile(readFileSync(env.GOOGLE_OAUTH_JSON, 'utf8')) : null;
  }
  return fromFile;
}

const CALLBACK_PATH = '/api/integrations/gmail/callback';

export function googleConfig() {
  const file = oauthFile();
  // Explicit env values win over the file, so one setting can be overridden without editing it
  const clientId = env.GOOGLE_CLIENT_ID || file?.clientId;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || file?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new AppError(503, 'gmail_not_configured', 'Connecting Gmail isn’t set up on this server yet.');
  }
  const publicBase = env.PUBLIC_URL.replace(/\/$/, '');
  const redirectUri =
    env.GOOGLE_REDIRECT_URI ||
    // Prefer the redirect URI registered for this server's address
    file?.redirectUris.find((u) => u === `${publicBase}${CALLBACK_PATH}`) ||
    `${publicBase}${CALLBACK_PATH}`;
  return { clientId, clientSecret, redirectUri };
}

/** PKCE: even if someone intercepts the code on its way back, they can't exchange it without this verifier. */
export function createPkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthUrl(input: { state: string; challenge: string; loginHint?: string }) {
  const { clientId, redirectUri } = googleConfig();
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', // we need a refresh token to send later, when the user is not around
    prompt: 'consent', // always return a refresh token, even on reconnect
    include_granted_scopes: 'true',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return u.toString();
}

export interface GoogleTokens {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
  scopes: string[];
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

/** Thrown when Google says the refresh token is no longer valid (user removed access, password reset…). */
export class GoogleAccessRevoked extends Error {
  constructor(message = 'Gmail access was removed') {
    super(message);
    this.name = 'GoogleAccessRevoked';
  }
}

function decodeIdToken(idToken: string | undefined) {
  // Received directly from Google's token endpoint over TLS, so its claims can be read without re-verifying
  if (!idToken) return {};
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return { email: payload.email as string | undefined, emailVerified: payload.email_verified as boolean | undefined, name: payload.name as string | undefined };
  } catch {
    return {};
  }
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string | number | undefined>;
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new GoogleAccessRevoked();
    throw new Error(`Google token error ${res.status}: ${json.error ?? 'unknown'}`);
  }
  return {
    accessToken: String(json.access_token),
    expiresAt: new Date(Date.now() + (Number(json.expires_in ?? 3600) - 60) * 1000), // renew a minute early
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    scopes: String(json.scope ?? '').split(' ').filter(Boolean),
    ...decodeIdToken(json.id_token as string | undefined),
  };
}

export function exchangeCode(code: string, verifier: string) {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  return tokenRequest({
    code,
    code_verifier: verifier,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

export function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleConfig();
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
}

export async function revokeToken(token: string) {
  await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

export interface GmailSendResult {
  ok: boolean;
  status: number;
  id?: string;
  reason?: string; // Google's error reason, e.g. dailyLimitExceeded
  message?: string;
}

export async function gmailSendRaw(accessToken: string, raw: string): Promise<GmailSendResult> {
  const res = await fetchImpl(SEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; errors?: { reason?: string }[]; status?: string };
  };
  if (res.ok) return { ok: true, status: res.status, id: json.id };
  return {
    ok: false,
    status: res.status,
    reason: json.error?.errors?.[0]?.reason ?? json.error?.status,
    message: json.error?.message,
  };
}
