// Ready-made, mobile-friendly email designs. Table layout + inline styles,
// because that's what renders reliably in Gmail, Outlook and phone mail apps.

const shell = (inner: string, accent: string, bg: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{company_name}</title></head>
<body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
<tr><td style="padding:20px 28px;border-bottom:1px solid #eeeeee;font:700 16px/1.2 Arial,Helvetica,sans-serif;color:${accent};letter-spacing:.02em;">{company_name}</td></tr>
${inner}
</table></td></tr></table></body></html>`;

const button = (label: string, accent: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${accent};">
<a href="[LINK]" style="display:inline-block;padding:14px 26px;font:700 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
</td></tr></table>`;

export interface Starter {
  id: string;
  name: string;
  description: string;
  subject: string;
  previewText: string;
  html: string;
}

export const STARTERS: Starter[] = [
  {
    id: 'offer-spotlight',
    name: 'Offer spotlight',
    description: 'One package, a big image, the price and one clear button.',
    subject: '{first_name|Hello}, [TRIP NAME] seats are open',
    previewText: 'Limited seats · [DATES]',
    html: shell(
      `<tr><td style="background:#d9a066;height:220px;text-align:center;font:14px Arial,sans-serif;color:#4a2a0a;">[HERO IMAGE]</td></tr>
<tr><td style="padding:28px;font:16px/1.6 Georgia,'Times New Roman',serif;color:#2b2116;">
<p style="margin:0 0 14px;font-size:24px;line-height:1.25;">Namaste {first_name|traveller},</p>
<p style="margin:0 0 18px;">[ONE OR TWO SENTENCES ABOUT THE TRIP — where, how many days, what's included.]</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4ec;border-radius:8px;margin:0 0 22px;"><tr>
<td style="padding:14px 16px;font:13px Arial,sans-serif;color:#6e604e;">Per person, from<br><span style="font:700 20px Arial,sans-serif;color:#2b2116;">[PRICE]</span></td>
<td align="right" style="padding:14px 16px;font:700 13px Arial,sans-serif;color:#7a2e12;">Departs [DATE]</td></tr></table>
${button('Reserve my seat', '#7a2e12')}
</td></tr>`,
      '#7a2e12',
      '#f3efe6',
    ),
  },
  {
    id: 'package-grid',
    name: 'Package grid',
    description: 'Four packages side by side — good for festival or season offers.',
    subject: '[SEASON] getaways, picked for you',
    previewText: 'Four trips starting at [PRICE]',
    html: shell(
      `<tr><td style="padding:28px 28px 8px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1f2a37;">
<p style="margin:0 0 6px;font-size:22px;font-weight:700;">Hi {first_name|there}, where to next?</p>
<p style="margin:0;color:#4b5563;">[A LINE ABOUT THE SEASON OR FESTIVAL.]</p></td></tr>
<tr><td style="padding:16px 20px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${[1, 2].map((n) => `<td width="50%" valign="top" style="padding:8px;"><div style="background:#9db4cc;height:120px;border-radius:8px;"></div>
<p style="margin:10px 0 2px;font:700 15px Arial,sans-serif;color:#1f2a37;">[PACKAGE ${n}]</p><p style="margin:0;font:13px Arial,sans-serif;color:#4b5563;">From [PRICE]</p></td>`).join('')}
</tr><tr>
${[3, 4].map((n) => `<td width="50%" valign="top" style="padding:8px;"><div style="background:#c4d2e0;height:120px;border-radius:8px;"></div>
<p style="margin:10px 0 2px;font:700 15px Arial,sans-serif;color:#1f2a37;">[PACKAGE ${n}]</p><p style="margin:0;font:13px Arial,sans-serif;color:#4b5563;">From [PRICE]</p></td>`).join('')}
</tr></table></td></tr>
<tr><td style="padding:0 28px 28px;">${button('See all packages', '#2b4a73')}</td></tr>`,
      '#2b4a73',
      '#eef2f6',
    ),
  },
  {
    id: 'plain-letter',
    name: 'Plain letter',
    description: 'Looks like a personal email. Often lands in the main inbox, not Promotions.',
    subject: 'Quick note about your trip, {first_name|there}',
    previewText: '',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1a1a1a;background:#ffffff;">
<div style="max-width:560px;">
<p>Hi {first_name|there},</p>
<p>[WRITE AS YOU WOULD TO ONE CUSTOMER — SHORT AND PERSONAL.]</p>
<p>If you have any questions, just reply to this email.</p>
<p>Warm regards,<br>[YOUR NAME]<br>{company_name}</p>
</div></body></html>`,
  },
  {
    id: 'trip-reminder',
    name: 'Trip reminder',
    description: 'For automations: “your trip is in 3 days” with a checklist.',
    subject: '{first_name|Hello}, your trip is almost here',
    previewText: 'A few things to keep ready',
    html: shell(
      `<tr><td style="padding:28px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1f2a37;">
<p style="margin:0 0 12px;font-size:22px;font-weight:700;">Your trip starts on {trip_date|soon}</p>
<p style="margin:0 0 16px;">Namaste {first_name|traveller}, we’re excited to have you with us. Please keep these ready:</p>
<ul style="margin:0 0 20px;padding-left:20px;">
<li>A photo ID (Aadhaar, passport or driving licence)</li>
<li>Your booking confirmation</li>
<li>[ANYTHING ELSE — medicines, warm clothes, etc.]</li></ul>
<p style="margin:0 0 20px;">Questions? Call us on [PHONE] or just reply to this email.</p>
${button('View my booking', '#0b7a62')}
</td></tr>`,
      '#0b7a62',
      '#f5f6f4',
    ),
  },
  {
    id: 'birthday',
    name: 'Birthday wishes',
    description: 'For yearly automations. Warm wishes with an optional gift.',
    subject: 'Happy birthday, {first_name|friend}!',
    previewText: 'A small gift from all of us',
    html: shell(
      `<tr><td style="padding:36px 28px;text-align:center;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1f2a37;">
<p style="margin:0 0 8px;font-size:30px;font-weight:700;color:#b4500a;">Happy birthday, {first_name|friend}!</p>
<p style="margin:0 0 22px;">Wishing you a wonderful year full of good journeys.<br>[OPTIONAL: Here’s [OFFER] on your next trip.]</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#b4500a;">
<a href="[LINK]" style="display:inline-block;padding:14px 26px;font:700 15px Arial,sans-serif;color:#ffffff;text-decoration:none;">Claim my gift</a></td></tr></table>
</td></tr>`,
      '#b4500a',
      '#fcf3ea',
    ),
  },
];
