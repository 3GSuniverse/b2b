import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CopyButton, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { ago, date } from '@/lib/format';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

const FIELDS: [string, string][] = [
  ['name', 'Required. The caller’s name.'],
  ['phone / email', 'At least one. Indian numbers can be sent as 98480 22338.'],
  ['destination', 'Where they want to go.'],
  ['startDate, endDate', 'YYYY-MM-DD.'],
  ['adults, children', 'Numbers.'],
  ['budget', 'In rupees, e.g. 60000.'],
  ['notes', 'Anything else, such as the call summary.'],
  ['whatsappOptIn', 'true only if they agreed to WhatsApp offers on the call.'],
  ['externalId', 'Your call ID. Sending the same one again won’t add a second enquiry.'],
  ['source', 'Defaults to CALL_AGENT. Also WEBSITE, PHONE, WHATSAPP, REFERRAL, OTHER.'],
];

export function ApiKeysSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<{ keys: ApiKey[] }>('/api/api-keys').then((r) => r.keys) });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('AI call agent');
  const [made, setMade] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ key: string }>('/api/api-keys', { name }),
    onSuccess: ({ key }) => {
      setCreating(false);
      setMade(key);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => api.del(`/api/api-keys/${k.id}`),
    onSuccess: () => {
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Key revoked. Anything using it stops working now.');
    },
  });
  const endpoint = `${location.origin}/api/v1/leads`;
  const example = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer hy_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Suresh Nair","phone":"9848055555","destination":"Goa",
       "startDate":"2026-12-24","endDate":"2026-12-28","adults":4,
       "budget":60000,"notes":"Wants a beach-facing hotel","externalId":"call_8812"}'`;

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="API keys"
        description="Let other systems add enquiries straight to your Trips board: your AI call agent, a website form, or anything that can send a web request."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New key
          </Button>
        }
      />
      <Panel className="overflow-hidden">
        {q.isPending ? (
          <Skeleton className="m-5 h-12" />
        ) : !q.data?.length ? (
          <EmptyState icon={<KeyRound />} title="No keys yet">
            Make one for each system that sends enquiries, so you can switch one off without affecting the others.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {q.data.map((k) => (
              <li key={k.id} className="flex items-center gap-4 border-t border-line-soft px-5 py-3.5 first:border-0 sm:px-6">
                <KeyRound className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{k.name}</span>
                  <span className="truncate text-xs text-muted">
                    <span className="font-mono">{k.prefix}…</span> · made {date(k.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })} · {k.lastUsedAt ? `last used ${ago(k.lastUsedAt)}` : 'never used'}
                  </span>
                </span>
                <Button size="sm" variant="danger-ghost" onClick={() => setRevoking(k)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="flex flex-col gap-4 p-5 sm:p-6">
        <PanelHeader title="Adding an enquiry" description="Send a POST with JSON. A new enquiry appears on the Trips board, and you get a notification." />
        <div className="flex items-center gap-3 rounded-[12px] bg-sunken px-3.5 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted">Address</span>
            <span className="truncate font-mono text-[13px]">POST {endpoint}</span>
          </span>
          <CopyButton value={endpoint} />
        </div>
        <pre className="overflow-x-auto rounded-[12px] bg-ink px-4 py-3.5 text-[12px] leading-relaxed text-[#d7e3de]">{example}</pre>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[180px_minmax(0,1fr)]">
          {FIELDS.map(([f, d]) => (
            <div key={f} className="contents">
              <dt className="font-mono text-[12px] font-semibold">{f}</dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New API key"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Make key
            </Button>
          </>
        }
      >
        <Field label="What will use it?" error={create.error instanceof ApiError ? (create.error.field('name') ?? create.error.message) : undefined}>
          {(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </Dialog>

      <Dialog
        open={!!made}
        onOpenChange={(o) => !o && setMade(null)}
        title="Copy your key now"
        description="This is the only time it’s shown. Keep it in the other system’s settings, never in a website’s page code."
        footer={
          <Button variant="primary" onClick={() => setMade(null)}>
            I’ve copied it
          </Button>
        }
      >
        <div className="flex items-center gap-3 rounded-[12px] border border-line bg-sunken px-3.5 py-3">
          <span className="min-w-0 flex-1 break-all font-mono text-[13px]">{made}</span>
          {made && <CopyButton value={made} />}
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-warm-strong">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Anyone with this key can add enquiries to your account. If it leaks, revoke it and make a new one.
        </p>
      </Dialog>

      <Dialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke “${revoking?.name}”?`}
        description="Anything using this key stops adding enquiries straight away. Enquiries already added stay."
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>Keep it</Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>
              Revoke
            </Button>
          </>
        }
      />
    </div>
  );
}
