import type { buildApp } from '../src/app.js';
import type { DnsLookup } from '../src/modules/domains/dns.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let n = 0;
export async function signup(app: App, overrides: Record<string, string> = {}) {
  n++;
  const body = {
    companyName: `Company ${n}`,
    name: `Owner ${n}`,
    email: `owner${n}-${Math.random().toString(36).slice(2, 7)}@company${n}.in`,
    password: 'correct-horse-battery',
    ...overrides,
  };
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: body });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${cookie.value}`, body, json: res.json() as { user: { id: string }; tenant: { id: string } } };
}

export function api(app: App, cookie: string) {
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie } }),
    post: (url: string, payload?: object) => app.inject({ method: 'POST', url, headers: { cookie }, payload }),
    patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url, headers: { cookie }, payload }),
    del: (url: string) => app.inject({ method: 'DELETE', url, headers: { cookie } }),
  };
}

/** A pretend internet DNS the tests can add records to. */
export class FakeDns implements DnsLookup {
  readonly records = { txt: new Map<string, string[]>(), cname: new Map<string, string[]>(), mx: new Map<string, { exchange: string; priority: number }[]>() };
  add(type: 'TXT' | 'CNAME' | 'MX', name: string, value: string, priority = 10) {
    if (type === 'MX') this.records.mx.set(name, [...(this.records.mx.get(name) ?? []), { exchange: value, priority }]);
    else {
      const map = type === 'TXT' ? this.records.txt : this.records.cname;
      map.set(name, [...(map.get(name) ?? []), value]);
    }
  }
  async txt(n: string) {
    return this.records.txt.get(n) ?? [];
  }
  async cname(n: string) {
    return this.records.cname.get(n) ?? [];
  }
  async mx(n: string) {
    return this.records.mx.get(n) ?? [];
  }
  clear() {
    this.records.txt.clear();
    this.records.cname.clear();
    this.records.mx.clear();
  }
}
