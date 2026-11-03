import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-11 shrink-0 rounded-full bg-[#c9cec9] transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, label, className }: { checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      className={cn(
        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-[#b9c0bb] bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="text-white">
        {checked === 'indeterminate' ? <Minus className="h-3 w-3" strokeWidth={3} /> : <Check className="h-3 w-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Pill-style switcher, e.g. Desktop / Mobile or Once / Every year. */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: 'sm' | 'md' }) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="inline-flex rounded-[11px] bg-[#eaedea] p-[3px]"
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'rounded-lg px-3.5 font-semibold text-muted transition-all data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] hover:text-ink',
            size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-[13px]',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/** Underline tabs with an optional count, e.g. All 1,248 · Subscribed 1,206 */
export function Tabs<T extends string>({ value, onChange, tabs, label, children }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: ReactNode }[]; label: string; children?: ReactNode }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsPrimitive.List aria-label={label} className="flex flex-wrap gap-x-6 border-b border-line">
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="relative -mb-px inline-flex h-11 items-center gap-2 border-b-2 border-transparent px-0.5 text-sm font-semibold text-muted transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
          >
            {t.label}
            {t.count !== undefined && <span className="tnum rounded-full bg-line-soft px-2 py-px text-xs font-medium text-ink-2">{t.count}</span>}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}
