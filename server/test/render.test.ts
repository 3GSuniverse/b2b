import { describe, expect, it } from 'vitest';
import { buildMergeVars, findUnknownTags, htmlToText, renderEmail, renderString } from '../src/modules/email/render.js';
import { formatAddress } from '../src/modules/email/ses-provider.js';
import { createUnsubscribeToken, verifyUnsubscribeToken } from '../src/modules/unsubscribe/token.js';

const tenant = { name: 'Kurukshetra Travels', postalAddress: '12 MG Road, Vijayawada' };

describe('merge tags', () => {
  it('fills values and uses fallbacks for blanks', () => {
    expect(renderString('Hi {first_name|traveller}!', { first_name: 'Ravi' }, { html: false })).toBe('Hi Ravi!');
    expect(renderString('Hi {first_name|traveller}!', { first_name: '' }, { html: false })).toBe('Hi traveller!');
    expect(renderString('Hi { first_name | there }', {}, { html: false })).toBe('Hi there');
  });

  it('escapes values in HTML so a contact name cannot inject markup', () => {
    const out = renderString('<p>{first_name}</p>', { first_name: '<script>x</script>' }, { html: true });
    expect(out).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('leaves unknown tags and CSS alone', () => {
    const tpl = '<style>a{color:red} .b { margin: 0 }</style>{mystery}';
    expect(renderString(tpl, { first_name: 'x' }, { html: true })).toBe(tpl);
    expect(findUnknownTags('{first_name} {mystery} {other|fallback}', ['first_name'])).toEqual(['mystery']);
  });

  it('formats date attributes and lets core fields win', () => {
    const vars = buildMergeVars(
      { firstName: 'Lakshmi', lastName: 'P', email: 'l@x.in', phone: null, attributes: { trip_date: '2026-11-20', first_name: 'WRONG', seats: 2 } },
      tenant,
    );
    expect(vars.trip_date).toBe('20 Nov 2026');
    expect(vars.first_name).toBe('Lakshmi');
    expect(vars.full_name).toBe('Lakshmi P');
    expect(vars.seats).toBe(2);
    expect(vars.company_name).toBe('Kurukshetra Travels');
  });
});

describe('renderEmail', () => {
  it('adds an unsubscribe footer with the postal address when the template has none', () => {
    const out = renderEmail(
      { subject: 'Hello {first_name}', html: '<html><body><p>Offer</p></body></html>', previewText: 'Only {seats} seats' },
      { first_name: 'Ravi', seats: 40, unsubscribe_url: 'https://x/u/abc' },
      tenant,
    );
    expect(out.subject).toBe('Hello Ravi');
    expect(out.html).toContain('href="https://x/u/abc"');
    expect(out.html).toContain('12 MG Road, Vijayawada');
    expect(out.html).toMatch(/<body><div style="display:none[^"]*">Only 40 seats<\/div>/);
    expect(out.text).toContain('Unsubscribe: https://x/u/abc');
  });

  it('respects a template that places its own unsubscribe link', () => {
    const out = renderEmail(
      { subject: 's', html: '<p>Hi</p><a href="{unsubscribe_url}">Stop</a>' },
      { unsubscribe_url: 'https://x/u/1' },
      tenant,
    );
    expect(out.html.match(/https:\/\/x\/u\/1/g)).toHaveLength(1);
  });

  it('never lets a newline into the subject header', () => {
    const out = renderEmail({ subject: 'Hi {first_name}', html: '<p>x</p>' }, { first_name: 'A\r\nBcc: evil@x.com' }, tenant);
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it('builds a readable text version from HTML', () => {
    expect(htmlToText('<p>Hello <b>Ravi</b></p><p><a href="https://k.in/book">Book now</a></p>')).toBe(
      'Hello Ravi\nBook now (https://k.in/book)',
    );
  });
});

describe('sender address', () => {
  it('quotes ASCII names and encodes non-ASCII ones', () => {
    expect(formatAddress('Kurukshetra Travels', 'a@k.in')).toBe('"Kurukshetra Travels" <a@k.in>');
    expect(formatAddress('కురుక్షేత్ర', 'a@k.in')).toMatch(/^=\?UTF-8\?B\?.+\?= <a@k\.in>$/);
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips and rejects tampering', () => {
    const t = createUnsubscribeToken('msg123');
    expect(verifyUnsubscribeToken(t)).toBe('msg123');
    expect(verifyUnsubscribeToken(t.replace('msg123', 'msg124'))).toBeNull();
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
  });
});
