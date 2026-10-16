/**
 * Server-safe primitives (no hooks, no motion), ported from Immersia Booth src/ui/kit.tsx.
 * Usable from React Server Components, so light pages (share page, gallery) ship no extra JS.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type BtnSize = 'sm' | 'md' | 'lg';

const BTN_SIZES: Record<BtnSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-[10px]',
  lg: 'h-11 px-5 text-[15px] gap-2.5 rounded-xl',
};
const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary: 'bg-ink text-white font-semibold hover:bg-[#2a2a28] active:bg-black',
  secondary: 'bg-elev text-fg border border-line-strong shadow-card hover:bg-sunken hover:border-[#c9c6bd]',
  ghost: 'text-muted hover:text-fg hover:bg-sunken',
  subtle: 'bg-sunken text-fg hover:bg-[#e8e6e0]',
  danger: 'bg-elev text-bad border border-bad/30 hover:bg-bad/[0.06]',
};
const BTN_BASE =
  'focus-ring inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';

/** Class string for anything that should look like a button (e.g. a Next <Link>). */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: BtnVariant; size?: BtnSize; className?: string } = {}) {
  return cx(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} {...rest}>
      {icon}
      {children}
      {iconRight}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'focus-ring inline-grid size-8 place-items-center rounded-lg transition-colors duration-150',
        active ? 'bg-sunken text-fg' : 'text-muted hover:bg-sunken hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  help,
  children,
  stack,
  badge,
  htmlFor,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  stack?: boolean;
  badge?: ReactNode;
  htmlFor?: string;
}) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div
      className={cx(
        'py-3.5',
        stack ? 'space-y-2' : 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8',
      )}
    >
      <div className="min-w-0">
        <Label {...(htmlFor ? { htmlFor } : {})} className="flex items-center gap-2 text-sm font-medium text-fg">
          {label}
          {badge}
        </Label>
        {help && <div className="mt-1 max-w-prose text-[13px] leading-relaxed text-faint">{help}</div>}
      </div>
      <div className={cx(stack ? '' : 'max-w-full sm:shrink-0')}>{children}</div>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  pad = true,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cx('card scroll-mt-6', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>}
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'px-5 py-2 sm:px-6' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-6 sm:mb-10">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h1 className="text-[30px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[40px]">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type PillTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';

export function Pill({
  tone = 'neutral',
  children,
  dot,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const tones: Record<PillTone, string> = {
    neutral: 'bg-elev text-muted border-line-strong',
    ok: 'bg-ok/[0.07] text-ok border-ok/25',
    warn: 'bg-warn/[0.07] text-warn border-warn/25',
    bad: 'bg-bad/[0.07] text-bad border-bad/25',
    info: 'bg-accent-soft text-accent border-accent/20',
    accent: 'bg-accent-soft text-accent border-accent/20',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5" aria-hidden>
          {tone === 'ok' && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-50 motion-reduce:animate-none" />
          )}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="card relative overflow-hidden px-5 py-5">
      <div className="eyebrow">{label}</div>
      <div
        className={cx(
          'tabular mt-3 text-[28px] font-bold leading-none tracking-[-0.03em] sm:text-[32px]',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-2.5 text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-muted">{icon}</div>
      <div className="text-base font-semibold tracking-[-0.01em]">{title}</div>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CheckItem({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <span
        className={cx(
          'grid size-5 place-items-center rounded-full border transition-colors',
          done ? 'border-transparent bg-ok text-white' : 'border-line-strong text-transparent',
        )}
        aria-hidden
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
      <span className={done ? 'text-muted' : 'text-fg'}>{children}</span>
    </div>
  );
}

/** The Immersia mark: a lucide-style aperture in an ink tile (as in Immersia Booth's shell). */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('inline-grid shrink-0 place-items-center rounded-[22%] bg-ink text-white', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="m14.31 8 5.74 9.94" />
        <path d="M9.69 8h11.48" />
        <path d="m7.38 12 5.74-9.94" />
        <path d="M9.69 16 3.95 6.06" />
        <path d="M14.31 16H2.83" />
        <path d="m16.62 12-5.74 9.94" />
      </svg>
    </span>
  );
}
