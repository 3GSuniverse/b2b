import { Monitor, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/controls';
import { Avatar } from '@/components/ui/display';
import { cn } from '@/lib/cn';

export type Device = 'desktop' | 'mobile';

/**
 * Renders an email exactly as HTML, isolated from the app: sandboxed (no scripts),
 * sized to its content so the page scrolls instead of the frame.
 */
export function EmailFrame({ html, width, title = 'Email preview', minHeight = 480 }: { html: string; width: number; title?: string; minHeight?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.max(minHeight, doc.documentElement.scrollHeight));
  }, [minHeight]);
  useEffect(() => {
    const t = setTimeout(measure, 120);
    return () => clearTimeout(t);
  }, [html, width, measure]);
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin allow-popups"
      srcDoc={html}
      onLoad={measure}
      style={{ width, height }}
      className="mx-auto block max-w-full border-0 bg-white"
    />
  );
}

export function DeviceToggle({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <Segmented
      size="sm"
      label="Preview size"
      value={value}
      onChange={onChange}
      options={[
        { value: 'desktop', label: <Monitor className="h-4 w-4" aria-label="Desktop" /> },
        { value: 'mobile', label: <Smartphone className="h-4 w-4" aria-label="Phone" /> },
      ]}
    />
  );
}

/** The email as it sits in an inbox list: sender, subject, preview text. */
export function InboxRow({ fromName, subject, previewText, className }: { fromName: string; subject: string; previewText?: string | null; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-[12px] border border-line-soft bg-surface px-3.5 py-3', className)}>
      <Avatar name={fromName} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[13px] font-semibold">{fromName || 'Your company'}</span>
          <span className="shrink-0 text-[11px] text-muted">9:41 AM</span>
        </div>
        <span className="truncate text-[13px] font-medium">{subject || 'No subject yet'}</span>
        <span className="truncate text-[13px] text-muted">{previewText || 'The first line of your email shows here.'}</span>
      </div>
    </div>
  );
}

/** Preview in a desktop window or a phone, with the inbox row above it. */
export function EmailPreview({
  html,
  device,
  fromName,
  subject,
  previewText,
}: {
  html: string | null;
  device: Device;
  fromName: string;
  subject: string;
  previewText?: string | null;
}) {
  const body = html ? (
    <EmailFrame html={html} width={device === 'mobile' ? 375 : 640} minHeight={device === 'mobile' ? 560 : 520} />
  ) : (
    <div className="grid h-[420px] place-items-center px-8 text-center text-sm text-muted">Choose a design to see the preview.</div>
  );
  if (device === 'mobile') {
    return (
      <div className="flex justify-center">
        <div className="w-[399px] max-w-full rounded-[44px] bg-ink p-3 shadow-[var(--shadow-pop)]">
          <div className="overflow-hidden rounded-[34px] bg-[#f2f3f2]">
            <div className="flex justify-center pb-2 pt-3">
              <span className="h-[22px] w-[96px] rounded-full bg-ink" aria-hidden />
            </div>
            <div className="px-3 pb-3">
              <InboxRow fromName={fromName} subject={subject} previewText={previewText} />
            </div>
            <div className="max-h-[640px] overflow-y-auto bg-white">{body}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-[#eef0ee]">
      <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-4 py-2.5" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#e3e6e3]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e3e6e3]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e3e6e3]" />
      </div>
      <div className="flex flex-col gap-0 bg-white">
        <div className="border-b border-line-soft px-6 py-4">
          <p className="text-lg font-semibold tracking-tight">{subject || 'No subject yet'}</p>
          <p className="mt-1 text-[13px] text-muted">
            From <span className="font-medium text-ink">{fromName || 'Your company'}</span>
          </p>
        </div>
        <div className="overflow-x-auto py-4">{body}</div>
      </div>
    </div>
  );
}
