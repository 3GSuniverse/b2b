/**
 * A plain, written email: the agency types it like a normal email, no design to fill in.
 * Same markup as letter() in server/src/modules/templates/starters.ts, marked with data-drona-letter.
 */
const P = 'margin:0 0 14px;';
export const LETTER_START = `<p style="${P}">Hi {first_name|there},</p><p style="${P}"><br></p><p style="${P}">Warm regards,<br>{company_name}</p>`;

export const letter = (
  body: string,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 16px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1a1a1a;background:#ffffff;">
<div data-drona-letter="1" style="max-width:560px;">${body}</div>
</body></html>`;

/** The written part of a plain email, or null when the HTML is a design. */
export function letterBody(html: string | null): string | null {
  if (!html) return null;
  const m = /<div data-drona-letter[^>]*>([\s\S]*)<\/div>/i.exec(html);
  return m ? m[1]! : null;
}

const KEEP = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'H2', 'H3']);
const STYLE: Record<string, string> = {
  P,
  UL: 'margin:0 0 14px;padding-left:22px;',
  OL: 'margin:0 0 14px;padding-left:22px;',
  LI: 'margin:0 0 4px;',
  H2: 'margin:0 0 12px;font-size:21px;line-height:1.3;',
  H3: 'margin:0 0 10px;font-size:17px;line-height:1.35;',
  A: 'color:#1a56c4;',
};

/**
 * What the editor typed, made safe and email-ready: only simple formatting survives, every
 * paragraph gets inline spacing (mail apps ignore most CSS), and stray <div>s become paragraphs.
 */
export function cleanLetter(root: HTMLElement): string {
  const doc = root.ownerDocument;
  const out = doc.createElement('div');
  const copy = (from: Node, to: Node) => {
    from.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) return to.appendChild(doc.createTextNode(n.nodeValue ?? ''));
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as HTMLElement;
      let tag = el.tagName === 'DIV' ? 'P' : el.tagName;
      if (tag === 'H1') tag = 'H2';
      if (!KEEP.has(tag)) return copy(el, to); // unwrap spans, fonts and the like
      // A paragraph inside a paragraph (pasted text) is flattened
      if (tag === 'P' && to instanceof HTMLElement && to.tagName === 'P') {
        if (to.childNodes.length) to.appendChild(doc.createElement('br'));
        return copy(el, to);
      }
      const e = doc.createElement(tag);
      if (STYLE[tag]) e.setAttribute('style', STYLE[tag]!);
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (/^(https?:|mailto:|tel:|\{)/i.test(href)) e.setAttribute('href', href);
      }
      copy(el, e);
      to.appendChild(e);
    });
  };
  copy(root, out);
  // Loose text at the top level goes into paragraphs
  const fixed = doc.createElement('div');
  let loose: HTMLElement | null = null;
  [...out.childNodes].forEach((n) => {
    const block = n.nodeType === Node.ELEMENT_NODE && ['P', 'UL', 'OL', 'H2', 'H3'].includes((n as HTMLElement).tagName);
    if (block) {
      loose = null;
      fixed.appendChild(n);
    } else {
      if (n.nodeType === Node.TEXT_NODE && !n.nodeValue?.trim() && !loose) return;
      if (!loose) {
        loose = doc.createElement('p');
        loose.setAttribute('style', P);
        fixed.appendChild(loose);
      }
      loose.appendChild(n);
    }
  });
  // A list or heading the browser left inside a paragraph is lifted out, splitting the paragraph
  [...fixed.querySelectorAll(':scope > p')].forEach((para) => {
    if (!para.querySelector(':scope > ul, :scope > ol, :scope > h2, :scope > h3')) return;
    const pieces: Node[] = [];
    let run: HTMLElement | null = null;
    [...para.childNodes].forEach((n) => {
      if (n.nodeType === Node.ELEMENT_NODE && ['UL', 'OL', 'H2', 'H3'].includes((n as HTMLElement).tagName)) {
        run = null;
        pieces.push(n);
        return;
      }
      if (!run) {
        run = doc.createElement('p');
        run.setAttribute('style', P);
        pieces.push(run);
      }
      run.appendChild(n);
    });
    const kept = pieces.filter((x) => {
      if ((x as HTMLElement).tagName !== 'P') return true;
      const p = x as HTMLElement;
      while (p.firstChild?.nodeName === 'BR') p.firstChild.remove();
      while (p.lastChild?.nodeName === 'BR') p.lastChild.remove();
      return !!p.textContent?.trim() || !!p.querySelector('[data-drona-tag]');
    });
    para.replaceWith(...kept);
  });
  fixed.querySelectorAll('p:empty').forEach((p) => p.appendChild(doc.createElement('br')));
  return fixed.innerHTML;
}
