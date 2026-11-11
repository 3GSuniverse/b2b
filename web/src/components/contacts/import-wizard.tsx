import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Download, FileSpreadsheet, RefreshCw, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Segmented, Switch } from '@/components/ui/controls';
import { Badge } from '@/components/ui/display';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { n } from '@/lib/format';
import type { ContactList } from '@/lib/types';
import { useFields } from './contact-sheet';
import { tx } from '../../lib/words';

interface Preview {
  headers: string[];
  mapping: Record<string, string>;
  detectedTypes: Record<string, 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | null>;
  sample: string[][];
  totalRows: number;
  hasEmailColumn: boolean;
}
interface Result {
  id: string;
  status: 'COMPLETED' | 'PENDING' | 'PROCESSING' | 'FAILED';
  totalRows: number;
  imported?: number;
  updated?: number;
  skipped?: number;
  errors?: { row: number; reason: string }[];
}

const CORE = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'fullName', label: 'Full name (split for you)' },
];
const TYPE_LABEL = { TEXT: 'text', NUMBER: 'number', DATE: 'date', BOOLEAN: 'yes / no' } as const;

/** Same rule as the server's fieldKey(), so a "new field" option round-trips. */
const keyOf = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 40);

const SAMPLE_CSV = 'Name,Email,Phone,City,Trip date,Birthday\nPriya Nair,priya@example.com,98480 22338,Hyderabad,15/12/2026,21/03/1990\n';

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Upload', 'Match columns', 'Done'];
  return (
    <ol className="flex items-center gap-2" aria-label="Import steps">
      {labels.map((l, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const state = idx < step ? 'done' : idx === step ? 'current' : 'next';
        return (
          <li key={l} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                'grid h-6 w-6 place-items-center rounded-full text-xs font-semibold',
                state === 'done' && 'bg-accent text-white',
                state === 'current' && 'bg-ink text-white',
                state === 'next' && 'bg-line-soft text-muted',
              )}
            >
              {state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : idx}
            </span>
            <span className={cn('text-[13px] font-medium', state === 'next' ? 'text-muted' : 'text-ink')}>{l}</span>
            {i < labels.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function DropZone({ onFile, busy, error }: { onFile: (f: File) => void; busy: boolean; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        disabled={busy}
        className={cn(
          'flex flex-col items-center gap-3 rounded-[18px] border-2 border-dashed px-6 py-14 text-center transition-colors',
          over ? 'border-accent bg-accent-soft/60' : 'border-[#cfcde6] bg-sunken hover:border-accent hover:bg-accent-soft/30',
        )}
      >
        <span className={cn('grid h-14 w-14 place-items-center rounded-2xl bg-surface shadow-[var(--shadow-lift)] transition-transform', over && 'scale-110')}>
          {busy ? <RefreshCw className="h-6 w-6 animate-spin text-accent" /> : <UploadCloud className="h-6 w-6 text-accent" />}
        </span>
        <span className="text-[15px] font-semibold">{busy ? 'Reading your file…' : over ? 'Drop it here' : 'Drop a CSV file here, or click to choose'}</span>
        <span className="max-w-sm text-[13px] leading-relaxed text-muted">From Excel or Google Sheets: File → Download / Save As → CSV. Up to 10 MB.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-[12px] bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-[14px] border border-line p-4 text-[13px] leading-relaxed text-ink-2">
        <p className="font-semibold text-ink">What works best</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>One person per row, with column names in the first row.</li>
          <li>An email column. Phone numbers can be written any way, like 98480 22338.</li>
          <li>{tx("Dates like 15/12/2026 work, for trip reminders and birthdays.")}</li>
        </ul>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`}
          download="contacts-sample.csv"
          className="inline-flex items-center gap-1.5 self-start font-semibold text-accent hover:text-accent-strong"
        >
          <Download className="h-3.5 w-3.5" />
          Download a sample file
        </a>
      </div>
    </div>
  );
}

export function ImportWizard({ open, onClose, lists, onDone }: { open: boolean; onClose: () => void; lists: ContactList[]; onDone: () => void }) {
  const fields = useFields();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [listMode, setListMode] = useState<'none' | 'existing' | 'new'>('none');
  const [listId, setListId] = useState('');
  const [newList, setNewList] = useState('');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview(null);
      setResult(null);
      setConsent(false);
      setListMode('none');
      setNewList('');
      setListId('');
    }
  }, [open]);

  const previewM = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.upload<Preview>('/api/imports/preview', fd);
    },
    onSuccess: (p, f) => {
      setFile(f);
      setPreview(p);
      setMapping(p.mapping);
      setNewList(f.name.replace(/\.(csv|txt)$/i, '').slice(0, 80));
    },
  });

  const importM = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('consentConfirmed', consent ? 'true' : 'false');
      fd.append('updateExisting', String(updateExisting));
      fd.append('mapping', JSON.stringify(mapping));
      if (listMode === 'existing' && listId) fd.append('listId', listId);
      if (listMode === 'new' && newList.trim()) fd.append('newListName', newList.trim());
      fd.append('file', file!);
      return api.upload<{ import: Result }>('/api/imports', fd);
    },
    onSuccess: ({ import: r }) => {
      setResult(r);
      onDone();
    },
  });

  // Large files run in the background; poll until they finish
  const job = useQuery({
    queryKey: ['import', result?.id],
    queryFn: () => api.get<{ import: Result }>(`/api/imports/${result!.id}`),
    enabled: !!result && (result.status === 'PENDING' || result.status === 'PROCESSING'),
    refetchInterval: 1500,
  });
  useEffect(() => {
    const j = job.data?.import;
    if (j && j.status !== result?.status && (j.status === 'COMPLETED' || j.status === 'FAILED')) {
      setResult(j);
      onDone();
    }
  }, [job.data, result?.status, onDone]);

  const step: 1 | 2 | 3 = result ? 3 : preview ? 2 : 1;
  const hasEmail = Object.values(mapping).includes('email');
  const hasPhone = Object.values(mapping).includes('phone');
  const used = (t: string) => Object.values(mapping).filter((v) => v === t).length;
  const consentErr = importM.error instanceof ApiError ? importM.error.field('consentConfirmed') : undefined;
  const generalErr = importM.error && !(importM.error instanceof ApiError && importM.error.details?.fields) ? importM.error.message : undefined;

  const footer =
    step === 2 ? (
      <>
        <Button
          variant="ghost"
          className="mr-auto"
          onClick={() => {
            setPreview(null);
            setFile(null);
          }}
        >
          Choose another file
        </Button>
        <Button variant="primary" disabled={!consent || (!hasEmail && !hasPhone)} loading={importM.isPending} onClick={() => importM.mutate()}>
          Import {n(preview!.totalRows)} {preview!.totalRows === 1 ? 'row' : 'rows'}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </>
    ) : step === 3 ? (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    ) : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Import customers" description={<Steps step={step} />} width="max-w-[760px]" footer={footer}>
      {step === 1 && <DropZone busy={previewM.isPending} onFile={(f) => previewM.mutate(f)} error={previewM.error?.message} />}

      {step === 2 && preview && (
        <div className="flex flex-col gap-7">
          <div className="flex items-center gap-3 rounded-[14px] bg-sunken px-4 py-3">
            <FileSpreadsheet className="h-5 w-5 text-accent" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{file?.name}</span>
              <span className="tnum text-xs text-muted">
                {n(preview.totalRows)} rows, {preview.headers.length} columns
              </span>
            </span>
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-[15px] font-semibold">Match your columns</h3>
              <p className="text-[13px] text-muted">We guessed from the column names. Change anything that looks wrong.</p>
            </div>
            {!hasEmail && (
              <p className="flex items-center gap-2 rounded-[12px] bg-warm-soft px-4 py-3 text-[13px] text-warm-strong">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                No column is set as Email. {hasPhone ? 'People without an email can only get WhatsApp later.' : 'Pick the email or phone column to continue.'}
              </p>
            )}
            <div className="overflow-hidden rounded-[14px] border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-sunken text-xs font-semibold text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Column in your file</th>
                    <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Example</th>
                    <th className="w-[44%] px-4 py-2.5 font-semibold">Save as</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h, i) => {
                    const target = mapping[h] ?? 'skip';
                    const examples = preview.sample.map((r) => r[i]).filter(Boolean).slice(0, 2);
                    const newKey = keyOf(h);
                    const existing = fields.data?.fields ?? [];
                    const dup = !target.startsWith('attr:') && target !== 'skip' && used(target) > 1;
                    const detected = preview.detectedTypes[h];
                    const isNewField = target.startsWith('attr:') && !existing.some((f) => `attr:${f.key}` === target);
                    return (
                      <tr key={h} className={cn('border-t border-line-soft', target === 'skip' && 'bg-sunken/60')}>
                        <td className="px-4 py-3 align-top">
                          <span className={cn('font-semibold', target === 'skip' && 'text-muted')}>{h}</span>
                        </td>
                        <td className="hidden max-w-[200px] px-4 py-3 align-top text-[13px] text-muted sm:table-cell">
                          {examples.length ? examples.map((e, j) => <span key={j} className="block truncate">{e}</span>) : <span className="text-faint">Empty</span>}
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <NativeSelect
                            aria-label={`Save “${h}” as`}
                            value={target}
                            onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                            aria-invalid={dup || undefined}
                            className="h-10"
                          >
                            <optgroup label="Contact">
                              {CORE.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </optgroup>
                            {existing.length > 0 && (
                              <optgroup label="Your fields">
                                {existing.map((f) => (
                                  <option key={f.id} value={`attr:${f.key}`}>
                                    {f.label}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {newKey && !existing.some((f) => f.key === newKey) && (
                              <optgroup label="New field">
                                <option value={`attr:${newKey}`}>New field “{h}”</option>
                              </optgroup>
                            )}
                            <option value="skip">Don’t import</option>
                          </NativeSelect>
                          {dup && <p className="mt-1.5 text-xs text-danger">Two columns are saved as the same thing. Pick one.</p>}
                          {isNewField && detected && (
                            <p className="mt-1.5 text-xs text-muted">
                              New field, saved as <Badge className="px-1.5 py-0 text-[11px]">{TYPE_LABEL[detected]}</Badge>
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold">Add them to a list</h3>
            <Segmented
              label="List"
              value={listMode}
              onChange={setListMode}
              options={[
                { value: 'none', label: 'No list' },
                ...(lists.length ? [{ value: 'existing' as const, label: 'Existing list' }] : []),
                { value: 'new', label: 'New list' },
              ]}
            />
            {listMode === 'existing' && (
              <NativeSelect aria-label="Choose a list" value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Choose a list</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({n(l.members)})
                  </option>
                ))}
              </NativeSelect>
            )}
            {listMode === 'new' && (
              <Field label="List name">{(p) => <Input {...p} value={newList} onChange={(e) => setNewList(e.target.value)} />}</Field>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-4 rounded-[12px] border border-line px-4 py-3 text-sm">
              <span className="flex flex-col">
                <span className="font-medium">Update people who are already in your customers</span>
                <span className="text-xs text-muted">Matched by email or phone. Empty cells never erase existing details.</span>
              </span>
              <Switch label="Update existing customers" checked={updateExisting} onCheckedChange={setUpdateExisting} />
            </label>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-3.5 text-sm transition-colors',
                consent ? 'border-accent bg-accent-soft/50' : consentErr ? 'border-danger bg-danger-soft' : 'border-line',
              )}
            >
              <Checkbox label="These people agreed to receive emails" checked={consent} onCheckedChange={setConsent} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">Everyone in this file agreed to receive emails from us</span>
                <span className="text-[13px] leading-relaxed text-muted">
                  For example, they booked with you or signed up for offers. Emailing bought or scraped lists gets domains blocked by Gmail and Yahoo.
                </span>
              </span>
            </label>
            {generalErr && <p className="text-sm text-danger">{generalErr}</p>}
          </section>
        </div>
      )}

      {step === 3 && result && <ImportResult r={result} />}
    </Sheet>
  );
}

function ImportResult({ r }: { r: Result }) {
  if (r.status === 'PENDING' || r.status === 'PROCESSING') {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <RefreshCw className="h-8 w-8 animate-spin text-accent" />
        <p className="text-[15px] font-semibold">Importing {n(r.totalRows)} rows…</p>
        <p className="max-w-sm text-[13px] text-muted">Big files take a minute. You can close this; we’ll let you know in Alerts when it’s done.</p>
      </div>
    );
  }
  if (r.status === 'FAILED') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-[15px] font-semibold">The import didn’t finish</p>
        <p className="max-w-sm text-[13px] text-muted">Nothing was half-imported. Check the file opens in Excel, then try again.</p>
      </div>
    );
  }
  const stats = [
    { label: 'New customers', value: r.imported ?? 0, tone: 'text-accent-strong' },
    { label: 'Updated', value: r.updated ?? 0, tone: 'text-ink' },
    { label: 'Skipped', value: r.skipped ?? 0, tone: (r.skipped ?? 0) > 0 ? 'text-warm-strong' : 'text-ink' },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-7 w-7 text-success" />
        <div>
          <p className="text-lg font-semibold tracking-tight">Import finished</p>
          <p className="tnum text-[13px] text-muted">{n(r.totalRows)} rows read</p>
        </div>
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-[14px] border border-line">
        {stats.map((s, i) => (
          <div key={s.label} className={cn('flex flex-col gap-1 p-4', i > 0 && 'border-l border-line-soft')}>
            <span className="text-[13px] text-muted">{s.label}</span>
            <span className={cn('tnum text-[28px] font-semibold tracking-tight', s.tone)}>{n(s.value)}</span>
          </div>
        ))}
      </div>
      {r.errors && r.errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Rows we skipped</h3>
          <div className="max-h-72 overflow-y-auto rounded-[14px] border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-sunken text-xs text-muted">
                <tr>
                  <th className="w-24 px-4 py-2 font-semibold">Row</th>
                  <th className="px-4 py-2 font-semibold">Why</th>
                </tr>
              </thead>
              <tbody>
                {r.errors.slice(0, 200).map((e, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    <td className="tnum px-4 py-2 text-muted">{e.row}</td>
                    <td className="px-4 py-2">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Fix these rows in your file and import it again. People already imported won’t be duplicated.</p>
        </div>
      )}
    </div>
  );
}
