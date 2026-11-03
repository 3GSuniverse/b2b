import { AlertCircle } from 'lucide-react';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-[var(--radius-control)] border border-[#d5dad6] bg-surface text-[14px] text-ink placeholder:text-faint transition-[border,box-shadow] duration-150 hover:border-[#c2c8c4] focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)] focus:outline-none disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_var(--color-danger-soft)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }>(function Input(
  { className, leading, ...props },
  ref,
) {
  if (!leading) return <input ref={ref} className={cn(control, 'h-11 px-3.5', className)} {...props} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{leading}</span>
      <input ref={ref} className={cn(control, 'h-11 pl-10 pr-3.5', className)} {...props} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-28 px-3.5 py-3 leading-relaxed', className)} {...props} />;
});

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        control,
        "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%2359625E%22 stroke-width=%222%22 viewBox=%220 0 24 24%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat pl-3.5 pr-10",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  aside?: ReactNode; // e.g. character counter
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, aside, children, className }: FieldProps) {
  const id = useId();
  const desc = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        {aside && <span className="tnum text-xs text-muted">{aside}</span>}
      </div>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': desc })}
      {error ? (
        <p id={desc} className="flex items-center gap-1.5 text-[13px] text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={desc} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
