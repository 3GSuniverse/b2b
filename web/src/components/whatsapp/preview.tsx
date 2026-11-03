import { CheckCheck } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/display';

/** WhatsApp's own formatting: *bold*, _italic_, ~strike~, ```mono```, and links. */
export function formatWhatsApp(text: string): ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => (
    <Fragment key={i}>
      {inline(line)}
      {i < lines.length - 1 && <br />}
    </Fragment>
  ));
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /```([^`]+)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|(https?:\/\/[^\s]+)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    const k = m.index!;
    if (m[1]) out.push(<code key={k} className="font-[ui-monospace,Menlo,monospace] text-[0.92em]">{m[1]}</code>);
    else if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) out.push(<s key={k}>{m[4]}</s>);
    else if (m[5]) out.push(<span key={k} className="text-[#027eb5] underline">{m[5]}</span>);
    last = k + m[0].length;
  }
  out.push(s.slice(last));
  return out;
}

/** The message as it lands in the customer's WhatsApp. */
export function WhatsAppPreview({ text, businessName, phone }: { text: string | null; businessName: string; phone?: string | null }) {
  return (
    <div className="flex justify-center">
      <div className="w-[340px] max-w-full rounded-[40px] bg-ink p-2.5 shadow-[var(--shadow-pop)]">
        <div className="flex h-[560px] flex-col overflow-hidden rounded-[32px] bg-[#efeae2]">
          <div className="flex items-center gap-3 bg-[#f0f2f5] px-4 pb-3 pt-7">
            <Avatar name={businessName} size={36} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-[#111b21]">{businessName}</span>
              <span className="truncate text-[11px] text-[#667781]">{phone ?? 'your WhatsApp number'}</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-4 [background-image:radial-gradient(rgb(0_0_0/0.035)_1px,transparent_1px)] [background-size:14px_14px]">
            <span className="mx-auto rounded-md bg-white/90 px-2.5 py-1 text-[11px] text-[#54656f] shadow-sm">Today</span>
            {text?.trim() ? (
              <div className="relative ml-auto max-w-[85%] rounded-[10px] rounded-tr-[3px] bg-[#d9fdd3] px-2.5 pb-1.5 pt-1.5 text-[14px] leading-[1.38] text-[#111b21] shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]">
                <span className="whitespace-pre-wrap break-words">{formatWhatsApp(text)}</span>
                <span className="float-right ml-3 mt-1.5 flex translate-y-0.5 items-center gap-1 text-[11px] text-[#667781]">
                  9:41 AM
                  <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" aria-label="Read" />
                </span>
              </div>
            ) : (
              <span className="m-auto text-[13px] text-[#667781]">Your message will appear here</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
