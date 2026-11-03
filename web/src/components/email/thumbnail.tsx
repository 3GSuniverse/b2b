import { cn } from '@/lib/cn';

/** A scaled-down, non-interactive render of an email for galleries and cards. */
export function EmailThumbnail({ html, className, height = 220 }: { html?: string | null; className?: string; height?: number }) {
  const scale = 0.36;
  return (
    <div className={cn('relative overflow-hidden bg-[#eef0ee]', className)} style={{ height }} aria-hidden>
      {html ? (
        <iframe
          title=""
          tabIndex={-1}
          sandbox=""
          srcDoc={html}
          loading="lazy"
          className="pointer-events-none absolute left-1/2 top-3 origin-top border-0 bg-white"
          style={{ width: 640, height: height / scale, transform: `translateX(-50%) scale(${scale})` }}
        />
      ) : (
        <div className="grid h-full place-items-center text-xs text-muted">No design yet</div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#eef0ee] to-transparent" />
    </div>
  );
}
