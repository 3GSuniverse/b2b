import { AppError } from '../../lib/http.js';

// Free mailbox providers: bulk mail "from" these is rejected or spam-foldered by Gmail/Yahoo/Outlook,
// and nobody but Google/Microsoft can add DNS records for them anyway.
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.in', 'hotmail.co.in', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'rediffmail.com', 'zoho.com', 'zohomail.in', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com',
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * "https://www.ABC-Holidays.com/" → "abc-holidays.com".
 * Throws a friendly error for anything that isn't a domain the user can own.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, ''); // scheme
  d = d.replace(/^[^@]*@/, ''); // someone pasted an email address
  d = d.split(/[/?#]/)[0] ?? '';
  d = d.replace(/:\d+$/, '').replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);

  const labels = d.split('.');
  if (d.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels.at(-1)!)) {
    throw new AppError(400, 'invalid_domain', 'Enter a domain like yourcompany.com');
  }
  if (FREE_MAIL_DOMAINS.has(d)) {
    throw new AppError(
      400,
      'free_mail_domain',
      `You can’t send bulk email as @${d}. Use your company’s own domain (for example yourcompany.com) — a domain costs about ₹1,000 a year.`,
    );
  }
  return d;
}
