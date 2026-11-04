import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { sanitizeRupees } from '@/components/trips/shared';
import { api, ApiError } from '@/lib/api';
import { inr, rupeesInput } from '@/lib/format';
import type { Package, PackageDetail } from '@/lib/types';

export function usePackages() {
  return useQuery({ queryKey: ['packages'], queryFn: () => api.get<{ packages: Package[] }>('/api/packages').then((r) => r.packages), staleTime: 60_000 });
}

/** A package dropdown for trip and group forms, with the price beside each name. */
export function PackageSelect({ value, onChange, id, ...rest }: { value: string; onChange: (id: string, pkg: Package | null) => void; id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) {
  const q = usePackages();
  return (
    <NativeSelect
      id={id}
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value, q.data?.find((p) => p.id === e.target.value) ?? null)}
    >
      <option value="">No package (custom trip)</option>
      {(q.data ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {inr(p.pricePerAdult)}/adult
        </option>
      ))}
    </NativeSelect>
  );
}

const lines = (xs: string[]) => xs.join('\n');
const unlines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function PackageSheet({ pkg, open, onClose, onSaved }: { pkg: PackageDetail | null; open: boolean; onClose: () => void; onSaved: (p: PackageDetail) => void }) {
  const qc = useQueryClient();
  const blank = { name: '', destination: '', nights: '4', summary: '', pricePerAdult: '', pricePerChild: '', costPerPerson: '', days: [] as { title: string; description: string }[], inclusions: '', exclusions: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setF(
      pkg
        ? { name: pkg.name, destination: pkg.destination ?? '', nights: String(pkg.nights), summary: pkg.summary ?? '', pricePerAdult: rupeesInput(pkg.pricePerAdult), pricePerChild: rupeesInput(pkg.pricePerChild), costPerPerson: rupeesInput(pkg.costPerPerson), days: pkg.days, inclusions: lines(pkg.inclusions), exclusions: lines(pkg.exclusions) }
        : blank,
    );
  }, [open, pkg]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        destination: f.destination || null,
        nights: Number(f.nights || 0),
        summary: f.summary || null,
        pricePerAdult: f.pricePerAdult || 'x',
        pricePerChild: f.pricePerChild || null,
        costPerPerson: f.costPerPerson || null,
        days: f.days.filter((d) => d.title.trim() || d.description.trim()),
        inclusions: unlines(f.inclusions),
        exclusions: unlines(f.exclusions),
      };
      return pkg ? api.patch<{ package: PackageDetail }>(`/api/packages/${pkg.id}`, body) : api.post<{ package: PackageDetail }>('/api/packages', body);
    },
    onSuccess: ({ package: p }) => {
      qc.invalidateQueries({ queryKey: ['packages'] });
      toast.success(pkg ? 'Package saved' : 'Package added');
      onSaved(p);
    },
  });
  const err = (k: string) => (save.error instanceof ApiError ? save.error.field(k) : undefined);
  const nights = Number(f.nights || 0);
  const setDay = (i: number, patch: Partial<{ title: string; description: string }>) => setF({ ...f, days: f.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const move = (i: number, by: number) => {
    const days = [...f.days];
    const [x] = days.splice(i, 1);
    days.splice(i + by, 0, x!);
    setF({ ...f, days });
  };
  const price = Number(f.pricePerAdult.replace(/,/g, '')) || 0;
  const cost = Number(f.costPerPerson.replace(/,/g, '')) || 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={pkg ? `Edit ${pkg.name}` : 'New package'}
      description="A trip you sell again and again. Choose it on an enquiry and the price, dates and quote fill in."
      width="max-w-[640px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {pkg ? 'Save package' : 'Add package'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" error={err('name')}>
          {(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kerala 4N/5D" />}
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4">
          <Field label="Destination" error={err('destination')}>
            {(p) => <Input {...p} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Kerala" />}
          </Field>
          <Field label="Nights" error={err('nights')}>
            {(p) => <Input {...p} type="number" min={0} max={60} value={f.nights} onChange={(e) => setF({ ...f, nights: e.target.value })} />}
          </Field>
        </div>
        <Field label="In one line" hint="Shown on quotes and in the package list." error={err('summary')}>
          {(p) => <Input {...p} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="Munnar hills, a night on an Alleppey houseboat, and Kochi" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price per adult" error={err('pricePerAdult')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.pricePerAdult} onChange={(e) => setF({ ...f, pricePerAdult: sanitizeRupees(e.target.value) })} placeholder="24,500" />}
          </Field>
          <Field label="Price per child" hint="Empty: same as an adult." error={err('pricePerChild')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.pricePerChild} onChange={(e) => setF({ ...f, pricePerChild: sanitizeRupees(e.target.value) })} placeholder="12,000" />}
          </Field>
          <Field label="Your cost per person" hint={price && cost ? `Margin ${inr((price - cost) * 100)} per adult` : 'Private. Shows your margin.'} error={err('costPerPerson')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.costPerPerson} onChange={(e) => setF({ ...f, costPerPerson: sanitizeRupees(e.target.value) })} placeholder="18,000" />}
          </Field>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Day by day</h3>
            {f.days.length === 0 && nights >= 0 && (
              <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setF({ ...f, days: Array.from({ length: nights + 1 }, () => ({ title: '', description: '' })) })}>
                Add {nights + 1} days
              </button>
            )}
          </div>
          {f.days.map((d, i) => (
            <div key={i} className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 rounded-[12px] border border-line-soft p-3">
              <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-accent-soft text-center text-[11px] font-bold leading-tight text-accent-strong">
                Day
                <br />
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex gap-1">
                  <Input aria-label={`Day ${i + 1} title`} value={d.title} onChange={(e) => setDay(i, { title: e.target.value })} placeholder="Title" />
                  <button type="button" className="grid h-10 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move day ${i + 1} up`}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="grid h-10 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover disabled:opacity-30" disabled={i === f.days.length - 1} onClick={() => move(i, 1)} aria-label={`Move day ${i + 1} down`}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" className="grid h-10 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger" onClick={() => setF({ ...f, days: f.days.filter((_, j) => j !== i) })} aria-label={`Remove day ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <Textarea aria-label={`Day ${i + 1} plan`} rows={2} value={d.description} onChange={(e) => setDay(i, { description: e.target.value })} placeholder="What happens that day" />
              </div>
            </div>
          ))}
          {f.days.length > 0 && (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setF({ ...f, days: [...f.days, { title: '', description: '' }] })}>
              <Plus className="h-4 w-4" />
              Add a day
            </Button>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Included" hint="One per line.">
            {(p) => <Textarea {...p} rows={5} value={f.inclusions} onChange={(e) => setF({ ...f, inclusions: e.target.value })} placeholder={'Hotels with breakfast\nPrivate car with driver'} />}
          </Field>
          <Field label="Not included" hint="One per line.">
            {(p) => <Textarea {...p} rows={5} value={f.exclusions} onChange={(e) => setF({ ...f, exclusions: e.target.value })} placeholder={'Flights\nEntry tickets'} />}
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
