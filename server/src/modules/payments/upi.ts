/**
 * UPI links and amounts in words. No payment provider is involved: the customer pays the
 * agency's own UPI ID from GPay / PhonePe / Paytm, and the agency records the payment.
 */

/** upi://pay link. Every UPI app opens it with the payee and amount filled in. */
export function upiLink(input: { upiId: string; payeeName: string; paise: number; note: string }) {
  const params = new URLSearchParams({
    pa: input.upiId,
    pn: input.payeeName.slice(0, 50),
    am: (input.paise / 100).toFixed(2),
    cu: 'INR',
    tn: input.note.slice(0, 50),
  });
  // URLSearchParams writes spaces as "+", which some UPI apps show literally
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number) {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** 12050075 paise → "Rupees One Lakh Twenty Thousand Five Hundred and Seventy-Five Paise Only" (Indian numbering). */
export function rupeesInWords(paise: number) {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${rupeesInWords(crore * 100).replace(/^Rupees | Only$/g, '')} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`;
}
