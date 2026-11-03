import { Fragment } from 'react';

const TAG = /\{\s*([a-zA-Z_]\w*)\s*(?:\|([^{}]*))?\}/g;

/** "{first_name|Hello}, Goa…" → a small chip saying "First name" in place of the raw tag. */
export function PrettyTags({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const label = m[1]!.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    out.push(
      <span key={m.index} className="mx-px inline-block rounded-[5px] bg-accent-soft px-1.5 text-[0.92em] font-medium leading-snug text-accent-strong" title={m[0]}>
        {label}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}
