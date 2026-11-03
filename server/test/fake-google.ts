/** A stand-in for Google's OAuth and Gmail APIs, so the whole flow runs offline. */
export class FakeGoogle {
  sent: { raw: string; token: string; mime: string }[] = [];
  revoked: string[] = [];
  tokenRequests: URLSearchParams[] = [];
  email = 'ravi.kt@gmail.com';
  name = 'Ravi Kumar';
  grantedScopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'];
  refreshRevoked = false;
  nextSendError: { status: number; reason?: string } | null = null;
  private n = 0;

  reset() {
    this.sent = [];
    this.revoked = [];
    this.tokenRequests = [];
    this.email = 'ravi.kt@gmail.com';
    this.grantedScopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'];
    this.refreshRevoked = false;
    this.nextSendError = null;
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(String(init?.body));
      this.tokenRequests.push(p);
      if (p.get('grant_type') === 'refresh_token') {
        if (this.refreshRevoked) return this.json({ error: 'invalid_grant' }, 400);
        return this.json({ access_token: `access-${++this.n}`, expires_in: 3599, scope: this.grantedScopes.join(' ') });
      }
      const idToken = ['h', Buffer.from(JSON.stringify({ email: this.email, email_verified: true, name: this.name })).toString('base64url'), 's'].join('.');
      return this.json({
        access_token: `access-${++this.n}`,
        refresh_token: `refresh-${this.n}`,
        expires_in: 3599,
        scope: this.grantedScopes.join(' '),
        id_token: idToken,
      });
    }

    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      this.revoked.push(new URL(url).searchParams.get('token') ?? '');
      return this.json({});
    }

    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')) {
      const token = String((init?.headers as Record<string, string>)?.authorization ?? '').replace('Bearer ', '');
      if (this.nextSendError) {
        const e = this.nextSendError;
        this.nextSendError = null;
        return this.json({ error: { message: 'error', errors: [{ reason: e.reason }] } }, e.status);
      }
      const raw = JSON.parse(String(init?.body)).raw as string;
      this.sent.push({ raw, token, mime: Buffer.from(raw, 'base64url').toString('utf8') });
      return this.json({ id: `gm-${this.sent.length}` });
    }

    throw new Error(`FakeGoogle: unexpected request ${url}`);
  };
}

/** Decodes the base64 MIME part with the given content type. */
export function mimePart(mime: string, contentType: string): string {
  const parts = mime.split(/\r\n--b_[a-f0-9]+(?:--)?\r\n?/);
  const part = parts.find((p) => p.includes(`Content-Type: ${contentType}`));
  if (!part) return '';
  const body = part.split('\r\n\r\n')[1] ?? '';
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}
