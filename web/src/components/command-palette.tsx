import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Building2, Clock3, CreditCard, FileText, LayoutDashboard, Mail, Megaphone, MessageCircle, MessageSquarePlus, Plane, Repeat2, Search, Settings, Upload, UserPlus, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '@/lib/api';
import type { Campaign, Contact, TripSummary } from '@/lib/types';
import { useSession } from '@/lib/session';
import { Avatar, Kbd } from './ui/display';

function Item({ onSelect, icon, children, hint, value }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: ReactNode; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm text-ink outline-none transition-colors duration-150 data-[selected=true]:bg-hover"
    >
      <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-xs text-muted">{hint}</span>}
    </Command.Item>
  );
}

const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted';

/** ⌘K / Ctrl+K: jump anywhere, run common actions, find a customer, a trip or a broadcast. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNavigate();
  const { user } = useSession();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 180);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const contacts = useQuery({
    queryKey: ['palette-contacts', debounced],
    queryFn: () => api.get<{ contacts: Contact[] }>(`/api/contacts${qs({ search: debounced, pageSize: 5 })}`),
    enabled: open && debounced.length >= 2,
  });
  const trips = useQuery({
    queryKey: ['palette-trips', debounced],
    queryFn: () => api.get<{ trips: TripSummary[] }>(`/api/trips${qs({ search: debounced, pageSize: 5 })}`),
    enabled: open && debounced.length >= 2,
  });
  const campaigns = useQuery({
    queryKey: ['palette-campaigns'],
    queryFn: () => api.get<{ campaigns: Campaign[] }>('/api/campaigns?pageSize=8'),
    enabled: open,
    staleTime: 30_000,
  });

  const go = (to: string) => {
    onOpenChange(false);
    nav(to);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(23_21_59/0.32)] backdrop-blur-[2px] animate-in data-[state=closed]:animate-out" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--shadow-pop)] animate-pop data-[state=closed]:animate-pop-out focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Type to find pages, customers, trips and broadcasts</DialogPrimitive.Description>
          <Command label="Search and commands" shouldFilter={true} loop>
            <div className="flex items-center gap-3 border-b border-line-soft px-4">
              <Search className="h-4 w-4 text-muted" aria-hidden />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search customers, trips, broadcasts, or type a command…"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="h-[calc(var(--cmdk-list-height)+16px)] max-h-[min(60vh,440px)] overflow-y-auto p-2 transition-[height] duration-200 ease-out">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">No matches. Try a name, a phone number, a trip number or a page.</Command.Empty>

              <Command.Group heading="Actions" className={groupClass}>
                <Item icon={<MessageSquarePlus />} onSelect={() => go('/trips?new=1')}>New enquiry</Item>
                <Item icon={<Megaphone />} onSelect={() => go('/campaigns/new')}>New broadcast</Item>
                <Item icon={<Repeat2 />} onSelect={() => go('/automations?new=1')}>New automatic message</Item>
                <Item icon={<UserPlus />} onSelect={() => go('/contacts?add=1')}>Add a customer</Item>
                <Item icon={<Upload />} onSelect={() => go('/contacts?import=1')}>Import customers from a spreadsheet</Item>
                {user.role !== 'MEMBER' && <Item icon={<Mail />} onSelect={() => go('/settings/senders')}>Connect a domain or Gmail</Item>}
                {user.role === 'OWNER' && <Item icon={<UserPlus />} onSelect={() => go('/agency')}>Add an employee login</Item>}
              </Command.Group>

              <Command.Group heading="Go to" className={groupClass}>
                <Item icon={<LayoutDashboard />} onSelect={() => go('/')}>Overview</Item>
                <Item icon={<Plane />} onSelect={() => go('/trips')}>Trips</Item>
                <Item icon={<Users />} onSelect={() => go('/contacts')}>Customers</Item>
                <Item icon={<Megaphone />} onSelect={() => go('/campaigns')}>Broadcasts</Item>
                <Item icon={<Clock3 />} onSelect={() => go('/automations')}>Automations</Item>
                <Item icon={<FileText />} onSelect={() => go('/templates')}>Templates</Item>
                <Item icon={<MessageCircle />} onSelect={() => go('/whatsapp')}>WhatsApp</Item>
                {user.role === 'OWNER' && <Item icon={<Building2 />} onSelect={() => go('/agency')}>Agency</Item>}
                {user.role === 'OWNER' && <Item icon={<CreditCard />} onSelect={() => go('/agency/billing')}>Plan & billing</Item>}
                {user.role !== 'MEMBER' && <Item icon={<Settings />} onSelect={() => go('/settings/senders')}>Settings</Item>}
              </Command.Group>

              {!!trips.data?.trips.length && (
                <Command.Group heading="Trips" className={groupClass}>
                  {trips.data.trips.map((t) => (
                    <Item key={t.id} value={`trip ${t.number} ${t.title} ${t.customer.name} ${t.destination ?? ''}`} icon={<Plane />} onSelect={() => go(`/trips/${t.id}`)} hint={`#${t.number}`}>
                      {t.title}, {t.customer.name}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {!!contacts.data?.contacts.length && (
                <Command.Group heading="Customers" className={groupClass}>
                  {contacts.data.contacts.map((c) => (
                    <Item
                      key={c.id}
                      value={`contact ${c.firstName ?? ''} ${c.lastName ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`}
                      icon={<Avatar name={[c.firstName, c.lastName].filter(Boolean).join(' ')} email={c.email} size={22} />}
                      onSelect={() => go(`/contacts?contact=${c.id}`)}
                      hint={c.email}
                    >
                      {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {!!campaigns.data?.campaigns.length && (
                <Command.Group heading="Broadcasts" className={groupClass}>
                  {campaigns.data.campaigns.map((c) => (
                    <Item key={c.id} value={`campaign ${c.name}`} icon={<Megaphone />} onSelect={() => go(c.status === 'DRAFT' || c.status === 'SCHEDULED' ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`)} hint={c.status.toLowerCase()}>
                      {c.name}
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
