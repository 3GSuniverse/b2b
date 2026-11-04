import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { FOOD, GENDER, ID_LABEL } from '@/components/groups/travellers';
import { api } from '@/lib/api';
import { dateRange, phone } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { GroupDetail } from '@/lib/types';

/** A clean passenger list to print or save as PDF: for the bus, hotels and permits. */
export function ManifestPage() {
  const { id } = useParams<{ id: string }>();
  const { user, tenant } = useSession();
  const admin = user.role !== 'MEMBER';
  const g = useQuery({ queryKey: ['group', id], queryFn: () => api.get<{ group: GroupDetail }>(`/api/groups/${id}`).then((r) => r.group) });
  // Full ID numbers: admins only, and the server logs that they were looked at
  const ids = useQuery({ queryKey: ['group-ids', id], queryFn: () => api.post<{ ids: { id: string; idNumber: string | null }[] }>(`/api/groups/${id}/ids`), enabled: admin, staleTime: Infinity });
  if (!g.data || (admin && !ids.data)) return <p className="p-8 text-sm text-muted">Preparing the list…</p>;
  const full = new Map((ids.data?.ids ?? []).map((x) => [x.id, x.idNumber]));
  const rows = g.data.bookings.filter((b) => b.status !== 'LOST' && b.status !== 'CANCELLED').flatMap((b) => b.travellers.map((t) => ({ ...t, family: b })));
  const emergency = (b: GroupDetail['bookings'][number]) => b.travellers.find((t) => t.emergencyPhone);
  return (
    <div className="mx-auto max-w-5xl bg-white p-8 text-[12px] text-ink print:p-0">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <p className="text-[13px] font-semibold">{tenant.name}</p>
          <h1 className="text-xl font-bold">{g.data.title}</h1>
          <p className="text-muted">
            {[g.data.destination, dateRange(g.data.startDate, g.data.endDate)].filter(Boolean).join(' · ')} · {rows.length} travellers
          </p>
        </div>
        <Button className="print:hidden" variant="primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print or save as PDF
        </Button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            {['#', 'Name', 'Age', 'Sex', 'ID', 'Food', 'Room', 'Seat', 'Booked by', 'Needs'].map((h) => (
              <th key={h} className="px-1.5 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.id} className="border-b border-line align-top">
              <td className="px-1.5 py-1.5 tnum">{i + 1}</td>
              <td className="px-1.5 py-1.5 font-medium">{t.name}</td>
              <td className="px-1.5 py-1.5 tnum">{t.age ?? ''}</td>
              <td className="px-1.5 py-1.5">{t.gender ? GENDER[t.gender] : ''}</td>
              <td className="px-1.5 py-1.5">{t.idType ? `${ID_LABEL[t.idType]} ${full.get(t.id) ?? `••${t.idLast4 ?? ''}`}` : ''}</td>
              <td className="px-1.5 py-1.5">{t.food ? FOOD[t.food] : ''}</td>
              <td className="px-1.5 py-1.5">{t.room}</td>
              <td className="px-1.5 py-1.5">{t.seat}</td>
              <td className="px-1.5 py-1.5">
                {t.family.customer.name}
                <br />
                <span className="text-muted">{phone(t.family.customer.phone)}</span>
              </td>
              <td className="px-1.5 py-1.5">{t.needs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 mt-6 text-[13px] font-semibold">Emergency contacts</h2>
      <ul className="columns-2 gap-8">
        {g.data.bookings
          .filter((b) => emergency(b))
          .map((b) => (
            <li key={b.id} className="break-inside-avoid py-0.5">
              {b.customer.name}: {emergency(b)!.emergencyName} {phone(emergency(b)!.emergencyPhone)}
            </li>
          ))}
      </ul>
      <p className="mt-6 text-[11px] text-muted">Contains personal ID details. Share only with the transport, hotels and authorities who need it.</p>
    </div>
  );
}
