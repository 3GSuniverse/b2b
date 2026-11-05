import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { prefersReducedMotion } from '@/lib/motion';

export const buttonStyles = cva(
  'relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[var(--radius-button)] font-semibold transition-[background,box-shadow,color,transform,border-color] duration-200 ease-[cubic-bezier(0.22,1.2,0.36,1)] active:scale-[0.97] active:duration-75 disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-[inset_0_-1px_0_rgb(0_0_0/0.2),0_1px_2px_rgb(0_0_0/0.06)] hover:shadow-[inset_0_-1px_0_rgb(0_0_0/0.2),0_6px_16px_-6px_var(--color-primary)]',
        accent: 'bg-accent text-white hover:bg-accent-strong',
        secondary: 'bg-surface text-ink border border-line hover:bg-sunken hover:border-[#cfcde6]',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
        danger: 'bg-danger text-white hover:bg-[#931c13]',
        'danger-ghost': 'text-danger hover:bg-danger-soft',
        link: 'text-accent hover:text-accent-strong underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-9 px-3 text-[13px]',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-[15px]',
        icon: 'h-10 w-10 p-0',
        'icon-sm': 'h-8 w-8 p-0 rounded-lg',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

/** A ripple spreading from where the button was pressed */
export function ripple(e: React.PointerEvent<HTMLElement>) {
  if (e.button !== 0 || prefersReducedMotion()) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;z-index:-1`;
  el.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove());
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, children, disabled, type = 'button', onPointerDown, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={(e) => {
        ripple(e);
        onPointerDown?.(e);
      }}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function LinkButton({ className, variant, size, onPointerDown, ...props }: LinkProps & VariantProps<typeof buttonStyles>) {
  return (
    <Link
      className={cn(buttonStyles({ variant, size }), className)}
      onPointerDown={(e) => {
        ripple(e);
        onPointerDown?.(e);
      }}
      {...props}
    />
  );
}
