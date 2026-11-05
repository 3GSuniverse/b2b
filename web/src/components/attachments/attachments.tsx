import { AlertCircle, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon, Paperclip, Play, Presentation, RotateCcw, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Attachment } from '@/lib/types';

// Same limits as the server
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_EMAIL_BYTES = 15 * 1024 * 1024;
export const MAX_FILES = 10;
const BLOCKED = new Set(
  'ade adp apk appx appxbundle bat cab chm cmd com cpl diagcab dll dmg ex ex_ exe hta img ins iso isp jar jnlp js jse lib lnk mde mjs msc msi msix msp mst nsh pif ps1 scr sct shb sys vb vbe vbs vhd vxd wsc wsf wsh xll'.split(' '),
);

export const attachmentUrl = (a: Attachment, download = false) => `/api/attachments/${a.id}${download ? '?download' : ''}`;

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;
}

type Kind = { key: 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'zip' | 'file'; label: string; icon: typeof FileIcon; tone: string };

/** What a file is, in the words and colours people recognise from their phone. */
export function fileKind(type: string, name = ''): Kind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (type.startsWith('image/')) return { key: 'image', label: 'Photo', icon: FileImage, tone: 'bg-plum-soft text-plum-ink' };
  if (type.startsWith('video/')) return { key: 'video', label: 'Video', icon: FileVideo, tone: 'bg-blue-soft text-blue-ink' };
  if (type.startsWith('audio/')) return { key: 'audio', label: 'Audio', icon: FileAudio, tone: 'bg-highlight-soft text-warm-strong' };
  if (type === 'application/pdf' || ext === 'pdf') return { key: 'pdf', label: 'PDF', icon: FileText, tone: 'bg-danger-soft text-danger' };
  if (/word|rtf|opendocument\.text/.test(type) || ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return { key: 'doc', label: ext === 'txt' ? 'Text' : 'Word', icon: FileText, tone: 'bg-blue-soft text-blue-ink' };
  if (/sheet|excel|csv/.test(type) || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { key: 'sheet', label: ext === 'csv' ? 'CSV' : 'Excel', icon: FileSpreadsheet, tone: 'bg-success-soft text-success-strong' };
  if (/presentation|powerpoint/.test(type) || ['ppt', 'pptx', 'odp'].includes(ext)) return { key: 'slides', label: 'Slides', icon: Presentation, tone: 'bg-warm-soft text-warm-strong' };
  if (/zip|compressed|rar|7z|tar/.test(type) || ['zip', 'rar', '7z'].includes(ext)) return { key: 'zip', label: 'Zip', icon: FileArchive, tone: 'bg-line-soft text-ink-2' };
  return { key: 'file', label: ext ? ext.toUpperCase() : 'File', icon: FileIcon, tone: 'bg-line-soft text-ink-2' };
}

/** Uploads one file, reporting progress (fetch can't). */
function uploadFile(file: File, onProgress: (p: number) => void) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Attachment>((resolve, reject) => {
    xhr.open('POST', '/api/attachments');
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { attachment?: Attachment; error?: string; message?: string };
      if (xhr.status === 201 && body.attachment) resolve(body.attachment);
      else reject(new ApiError(xhr.status, body.error ?? 'upload_failed', body.message ?? (xhr.status === 413 ? 'Files can be up to 16 MB each' : 'The upload didn’t finish. Try again.')));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The connection dropped. Try again.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Cancelled'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

type Pending = { key: string; file: File; progress: number; error?: string; preview?: string; abort?: () => void };

/** The little picture on a file tile: the photo itself, a video's first frame, or the file type's badge. */
function Thumb({ a, local, size = 44 }: { a?: Attachment; local?: { url?: string; type: string; name: string }; size?: number }) {
  const type = a?.type ?? local!.type;
  const k = fileKind(type, a?.name ?? local!.name);
  const src = local?.url ?? (a ? attachmentUrl(a) : undefined);
  const box = { width: size, height: size };
  if (k.key === 'image' && src) return <img src={src} alt="" style={box} className="shrink-0 rounded-[10px] bg-line-soft object-cover" loading="lazy" />;
  if (k.key === 'video' && src)
    return (
      <span style={box} className="relative shrink-0 overflow-hidden rounded-[10px] bg-ink">
        <video src={`${src}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover opacity-80" />
        <Play className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white text-white" aria-hidden />
      </span>
    );
  const Icon = k.icon;
  return (
    <span style={box} className={cn('grid shrink-0 place-items-center rounded-[10px]', k.tone)}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function Tile({ children, leaving, className }: { children: ReactNode; leaving?: boolean; className?: string }) {
  return (
    <li className={cn('attach-tile relative flex min-w-0 items-center gap-3 rounded-[14px] border border-line bg-surface p-2.5 pr-3 shadow-[0_1px_2px_rgb(23_21_59/0.04)]', leaving && 'attach-leave', className)}>
      {children}
    </li>
  );
}

const removeButton = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink';

/**
 * Attach files to a message: drop them in or choose them. They upload straight away, with progress,
 * and `onChange` gets the finished list. `inherited` are files that come from elsewhere (a template)
 * and can't be removed here.
 */
export function AttachmentPicker({
  value,
  onChange,
  channel,
  inherited = [],
  inheritedLabel = 'From the template',
  disabled,
  className,
}: {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  channel: 'EMAIL' | 'WHATSAPP' | 'BOTH';
  inherited?: Attachment[];
  inheritedLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const [pending, setPending] = useState<Pending[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  // Free the local photo previews when the picker goes away
  const urls = useRef(new Set<string>());
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const total = [...inherited, ...value].reduce((a, f) => a + f.size, 0) + pending.filter((p) => !p.error).reduce((a, p) => a + p.file.size, 0);
  const count = value.length + pending.filter((p) => !p.error).length;

  const start = (p: Pending) => {
    const up = uploadFile(p.file, (progress) => setPending((list) => list.map((x) => (x.key === p.key ? { ...x, progress } : x))));
    setPending((list) => list.map((x) => (x.key === p.key ? { ...x, abort: up.abort, error: undefined, progress: 0 } : x)));
    up.promise.then(
      (a) => {
        const next = [...latest.current, a];
        latest.current = next;
        onChange(next);
        setPending((list) => list.filter((x) => x.key !== p.key));
      },
      (e: Error) => {
        if (e instanceof ApiError && e.code === 'aborted') return;
        setPending((list) => list.map((x) => (x.key === p.key ? { ...x, error: e.message } : x)));
      },
    );
  };

  const add = (files: FileList | File[]) => {
    const room = MAX_FILES - count;
    const list = Array.from(files);
    const fresh: Pending[] = list.map((file, i) => {
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
      const error =
        i >= room
          ? `Attach up to ${MAX_FILES} files`
          : BLOCKED.has(ext)
            ? `.${ext} files can’t be sent. Zip it, or share a link.`
            : file.size > MAX_FILE_BYTES
              ? `Too large: ${formatBytes(file.size)} (up to 16 MB)`
              : file.size === 0
                ? 'This file is empty'
                : undefined;
      let preview: string | undefined;
      if (!error && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
        preview = URL.createObjectURL(file);
        urls.current.add(preview);
      }
      return { key: `${Date.now()}-${i}-${file.name}`, file, progress: 0, error, preview };
    });
    setPending((p) => [...p, ...fresh]);
    fresh.filter((p) => !p.error).forEach(start);
  };

  const remove = (id: string) => {
    setLeaving(id);
    setTimeout(() => {
      setLeaving(null);
      const next = latest.current.filter((a) => a.id !== id);
      latest.current = next;
      onChange(next);
    }, 170);
  };
  const dropPending = (key: string) => {
    setPending((list) => {
      list.find((x) => x.key === key)?.abort?.();
      return list.filter((x) => x.key !== key);
    });
  };

  const showEmail = channel !== 'WHATSAPP';
  const emailTone = total > MAX_EMAIL_BYTES ? 'bg-danger' : total > 8 * 1048576 ? 'bg-warm-chart' : 'bg-accent';
  const hasAny = inherited.length + value.length + pending.length > 0;

  return (
    <div className={cn('@container flex flex-col gap-3', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label="Attach files"
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragEnter={(e) => {
          if (disabled || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => {
          if (!disabled && e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          if (!disabled && e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
        className={cn(
          'attach-zone group relative flex cursor-pointer items-center gap-3.5 overflow-hidden rounded-[14px] border-[1.5px] border-dashed px-4 transition-[background-color,border-color,box-shadow] duration-200 outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-soft)]',
          hasAny ? 'py-2.5' : 'py-4',
          over ? 'attach-over border-accent bg-accent-soft/70' : 'border-[#cfcde6] bg-sunken hover:border-accent/60 hover:bg-accent-soft/30',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <span className={cn('attach-clip grid shrink-0 place-items-center rounded-full bg-surface text-accent shadow-[var(--shadow-lift)] transition-transform', hasAny ? 'h-9 w-9' : 'h-11 w-11')}>
          {over ? <Upload className="h-[18px] w-[18px]" aria-hidden /> : <Paperclip className="h-[18px] w-[18px]" aria-hidden />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-ink">
            {over ? 'Let go to attach' : (
              <>
                Drop files here or <span className="text-accent underline decoration-accent/30 underline-offset-2 group-hover:decoration-accent">choose files</span>
              </>
            )}
          </span>
          {!hasAny && (
            <span className="text-xs text-muted">
              Brochures, itineraries, photos, videos or voice notes. Up to 16 MB each.
            </span>
          )}
        </span>
        {showEmail && hasAny && (
          <span className="ml-auto hidden shrink-0 flex-col items-end gap-1 sm:flex" aria-label={`${formatBytes(total)} of 15 MB for email`}>
            <span className={cn('tnum text-[11px] font-semibold', total > MAX_EMAIL_BYTES ? 'text-danger' : 'text-muted')}>
              {formatBytes(total)} <span className="font-normal">of 15 MB</span>
            </span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line-soft">
              <span className={cn('block h-full rounded-full transition-[width] duration-500 ease-out', emailTone)} style={{ width: `${Math.min(100, (total / MAX_EMAIL_BYTES) * 100)}%` }} />
            </span>
          </span>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {hasAny && (
        <ul className="grid gap-2 @xl:grid-cols-2">
          {inherited.map((a) => (
            <Tile key={`i-${a.id}`} className="border-dashed bg-sunken">
              <Thumb a={a} />
              <span className="flex min-w-0 flex-1 flex-col">
                <a href={attachmentUrl(a, true)} className="truncate text-[13px] font-semibold hover:underline" title={a.name}>
                  {a.name}
                </a>
                <span className="truncate text-[11px] text-muted">
                  {inheritedLabel} · {formatBytes(a.size)}
                </span>
              </span>
            </Tile>
          ))}
          {value.map((a) => {
            const k = fileKind(a.type, a.name);
            return (
              <Tile key={a.id} leaving={leaving === a.id}>
                <Thumb a={a} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <a href={attachmentUrl(a, true)} className="truncate text-[13px] font-semibold hover:underline" title={a.name}>
                    {a.name}
                  </a>
                  <span className="truncate text-[11px] text-muted">
                    {k.label} · {formatBytes(a.size)}
                  </span>
                </span>
                {!disabled && (
                  <button type="button" onClick={() => remove(a.id)} className={removeButton} aria-label={`Remove ${a.name}`}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </Tile>
            );
          })}
          {pending.map((p) => (
            <Tile key={p.key} className={cn(p.error && 'border-[#f4c7c2] bg-danger-soft/40')}>
              <span className="relative">
                <Thumb local={{ url: p.preview, type: p.file.type, name: p.file.name }} />
                {!p.error && (
                  <svg viewBox="0 0 44 44" className="absolute inset-0 h-11 w-11 -rotate-90" aria-hidden>
                    <circle cx="22" cy="22" r="19" fill="none" stroke="rgb(255 255 255 / 0.65)" strokeWidth="4" />
                    <circle cx="22" cy="22" r="19" fill="none" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(4, p.progress * 100)} 100`} className="transition-[stroke-dasharray] duration-200" />
                  </svg>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold" title={p.file.name}>
                  {p.file.name}
                </span>
                {p.error ? (
                  <span className="flex items-start gap-1 text-[11px] font-medium leading-snug text-danger">
                    <AlertCircle className="mt-px h-3 w-3 shrink-0" /> {p.error}
                  </span>
                ) : (
                  <span className="relative mt-1 h-1 overflow-hidden rounded-full bg-line-soft">
                    <span className="attach-sheen block h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(6, p.progress * 100)}%` }} />
                  </span>
                )}
              </span>
              {p.error && p.file.size <= MAX_FILE_BYTES && p.file.size > 0 && !/can’t be sent|up to 10/.test(p.error) && (
                <button type="button" onClick={() => start(p)} className={removeButton} aria-label={`Try ${p.file.name} again`}>
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={() => dropPending(p.key)} className={removeButton} aria-label={p.error ? `Dismiss ${p.file.name}` : `Cancel ${p.file.name}`}>
                <X className="h-4 w-4" />
              </button>
            </Tile>
          ))}
        </ul>
      )}

      {hasAny && channel !== 'EMAIL' && (
        <p className="text-xs leading-relaxed text-muted">
          {channel === 'WHATSAPP' ? 'On WhatsApp, ' : 'By WhatsApp, '}
          {inherited.length + value.length === 1 && !pending.length ? 'the file goes with your message as its caption.' : 'your message goes first, then each file.'}
        </p>
      )}
      {showEmail && total > MAX_EMAIL_BYTES && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertCircle className="h-3.5 w-3.5" /> Over 15 MB: most inboxes would refuse this email. Remove a file{channel === 'BOTH' ? ', or send by WhatsApp only' : ''}.
        </p>
      )}
    </div>
  );
}

/** Files under an email, the way an inbox shows them. */
export function EmailAttachments({ files, className }: { files: Attachment[]; className?: string }) {
  if (!files.length) return null;
  return (
    <div className={cn('flex flex-col gap-2 border-t border-line-soft px-6 py-4', className)}>
      <span className="text-xs font-semibold text-muted">
        {files.length} attachment{files.length > 1 ? 's' : ''}
      </span>
      <ul className="stagger flex flex-wrap gap-2">
        {files.map((f) => {
          const k = fileKind(f.type, f.name);
          return (
            <li key={f.id}>
              <a href={attachmentUrl(f, true)} className="lift flex w-[200px] items-center gap-2.5 rounded-[10px] border border-line bg-surface p-2 pr-3 hover:border-accent/50">
                <Thumb a={f} size={34} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-semibold" title={f.name}>
                    {f.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {k.label} · {formatBytes(f.size)}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "2 files · 3.4 MB" for step summaries. */
export function describeFiles(files: Attachment[]) {
  if (!files.length) return 'No files';
  return `${files.length} file${files.length > 1 ? 's' : ''} · ${formatBytes(files.reduce((a, f) => a + f.size, 0))}`;
}

/** One file as it shows in a WhatsApp chat: a photo, a video, a voice clip, or a document card. */
export function WhatsAppMedia({ file, caption }: { file: Attachment; caption?: ReactNode }) {
  const k = fileKind(file.type, file.name);
  const src = attachmentUrl(file);
  const time = (
    <span className="ml-auto flex items-center gap-1 text-[11px] text-[#667781]">
      9:41 AM
      <svg viewBox="0 0 16 11" className="h-3 w-3.5 fill-[#53bdeb]" aria-label="Read">
        <path d="M11.07.65 5.5 6.2 3.4 4.1l-.96.96 3.06 3.07 6.5-6.5zM15.04.65 9.47 6.2l-.5-.5-.95.96 1.45 1.46 6.53-6.5z" />
      </svg>
    </span>
  );
  return (
    <div className="wa-bubble relative ml-auto w-[240px] max-w-[85%] rounded-[10px] rounded-tr-[3px] bg-[#d9fdd3] p-1 text-[14px] leading-[1.38] text-[#111b21] shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]">
      {k.key === 'image' ? (
        <img src={src} alt={file.name} className="max-h-[260px] w-full rounded-[7px] bg-[#cfe9c7] object-cover" />
      ) : k.key === 'video' ? (
        <span className="relative block overflow-hidden rounded-[7px] bg-ink">
          <video src={`${src}#t=0.1`} muted preload="metadata" className="max-h-[260px] w-full object-cover opacity-85" />
          <span className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45">
            <Play className="h-5 w-5 fill-white text-white" />
          </span>
          <span className="absolute bottom-1.5 left-2 text-[11px] font-medium text-white">{formatBytes(file.size)}</span>
        </span>
      ) : k.key === 'audio' ? (
        <span className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25d366] text-white">
            <Play className="ml-0.5 h-4 w-4 fill-white" />
          </span>
          <span className="flex h-6 flex-1 items-center gap-[2px]" aria-hidden>
            {Array.from({ length: 26 }, (_, i) => (
              <span key={i} className="wa-wave w-[3px] rounded-full bg-[#8696a0]" style={{ height: `${25 + ((i * 37) % 70)}%`, animationDelay: `${i * 40}ms` }} />
            ))}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-2.5 rounded-[7px] bg-[#cfe9c7]/70 px-2.5 py-2.5">
          <span className={cn('grid h-9 w-8 shrink-0 place-items-center rounded-[4px] text-[9px] font-bold', k.tone)}>{k.label.slice(0, 4).toUpperCase()}</span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium">{file.name}</span>
            <span className="text-[11px] text-[#667781]">
              {formatBytes(file.size)} · {k.label}
            </span>
          </span>
        </span>
      )}
      {caption ? (
        <span className="block whitespace-pre-wrap break-words px-1.5 pb-0.5 pt-1">
          {caption}
          <span className="float-right ml-3 mt-1.5 flex translate-y-0.5">{time}</span>
        </span>
      ) : (
        <span className="flex px-1.5 pb-0.5 pt-1">{time}</span>
      )}
    </div>
  );
}
