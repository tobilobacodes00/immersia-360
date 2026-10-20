'use client';

/**
 * Interactive controls, ported from Immersia Booth src/ui/kit.tsx. All visible strings come from
 * next-intl (`ui.*` and `tokens.*` messages).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Braces, ChevronDown, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TOKEN_CATALOGUE, evaluate, type TokenContext } from '@immersia/shared/tokens';
import { cx, softSpring, spring } from './cx';
import { IconButton } from './primitives';
import { useRadioGroup } from './radio-group';

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'focus-ring relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[3px] transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <motion.span
        layout
        transition={spring}
        className={cx('size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(17,17,16,0.25)]', checked ? 'ml-auto' : '')}
      />
    </button>
  );
}

export function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  className,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  // Resync the draft when the value changes from outside (e.g. the slider), during render rather
  // than in an effect, so there is no extra render with a stale draft.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(String(value));
  }
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = () => {
    const parsed = parseFloat(draft);
    const n = clamp(Number.isFinite(parsed) ? parsed : value);
    onChange(n);
    setDraft(String(n));
  };
  return (
    <label
      className={cx(
        'tabular flex h-8 items-center rounded-lg border border-line-strong bg-elev px-2 text-[13px] transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft',
        className ?? 'w-[78px]',
      )}
    >
      <input
        className="w-full min-w-0 bg-transparent text-right outline-none"
        value={draft}
        inputMode="decimal"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const n = value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
            onChange(clamp(Math.round(n * 1000) / 1000));
          }
        }}
      />
      {unit && <span className="ml-1 text-faint">{unit}</span>}
    </label>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  width = 'w-full',
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  width?: string;
  label?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cx('flex items-center gap-3', width)}>
      <input
        type="range"
        className="range min-w-0 flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ ['--p' as string]: `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <NumberInput value={value} min={min} max={max} step={step} onChange={onChange} unit={unit} label={label} />
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
  mono,
  onEnter,
  disabled,
  autoFocus,
  ariaLabel,
  id,
  name,
  autoComplete,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  mono?: boolean;
  onEnter?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      required={required}
      aria-label={ariaLabel ?? (id ? undefined : placeholder)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      className={cx(
        'h-9 w-full rounded-[10px] border border-line-strong bg-elev px-3 text-sm outline-none transition-colors placeholder:text-faint hover:border-[#c9c6bd] focus:border-accent focus:ring-3 focus:ring-accent-soft disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60',
        mono && 'font-mono text-[13px]',
        className,
      )}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
  id,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  className?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cx('relative', className)}>
      <select
        id={id}
        disabled={disabled}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 w-full cursor-pointer appearance-none rounded-[10px] border border-line-strong bg-elev pr-8 pl-3 text-sm outline-none transition-colors hover:border-[#c9c6bd] focus:border-accent focus:ring-3 focus:ring-accent-soft disabled:cursor-wait disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-faint" />
    </div>
  );
}

export function ColorField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-elev pr-3 pl-1.5 transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
      <span className="relative size-6 overflow-hidden rounded-md ring-1 ring-black/10" style={{ background: value }}>
        <input
          type="color"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </span>
      <input
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 bg-transparent font-mono text-[13px] uppercase outline-none"
      />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  label?: string;
}) {
  const lid = useId();
  const radios = useRadioGroup({ values: options.map((o) => o.value), value, onChange });
  return (
    <div
      {...radios.group}
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-sunken p-0.5 [scrollbar-width:none]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          {...radios.item(o.value)}
          className={cx(
            'focus-ring relative shrink-0 rounded-lg font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={lid}
              transition={spring}
              className="absolute inset-0 rounded-lg bg-elev shadow-[0_1px_2px_rgba(17,17,16,0.08),0_0_0_1px_rgba(17,17,16,0.06)]"
            />
          )}
          <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Text field with a token picker and live preview (dynamic fields for PHO-3, overlay text, messages). */
export function TokenField({
  value,
  onChange,
  ctx,
  multiline,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  ctx: TokenContext;
  multiline?: boolean;
  placeholder?: string;
  label: string;
}) {
  const t = useTranslations('ui.tokenField');
  const tt = useTranslations('tokens');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const preview = useMemo(() => evaluate(value, ctx), [value, ctx]);
  const insert = (tok: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(value.slice(0, at) + tok + value.slice(end));
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tok.length, at + tok.length);
    });
  };
  const cls =
    'w-full rounded-[10px] border border-line-strong bg-elev px-3 py-2 pr-10 font-mono text-[13px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent-soft';
  return (
    <div className="relative">
      <div className="relative">
        {multiline ? (
          <textarea
            ref={ref}
            rows={3}
            value={value}
            aria-label={label}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cx(cls, 'resize-y')}
          />
        ) : (
          <input
            ref={ref}
            value={value}
            aria-label={label}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cx(cls, 'h-9 py-0')}
          />
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={t('insert')}
          aria-label={t('insert')}
          aria-expanded={open}
          className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-faint transition-colors hover:bg-sunken hover:text-fg"
        >
          <Braces className="size-3.5" />
        </button>
      </div>
      {value && (
        <div className="mt-1.5 flex items-start gap-2 text-xs text-muted" aria-live="polite">
          <span className="mt-px rounded bg-sunken px-1.5 py-px text-[10px] font-semibold tracking-wider text-faint uppercase">
            {t('preview')}
          </span>
          <span className="min-w-0 break-words">{preview || <em className="text-faint">{t('empty')}</em>}</span>
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="surface-pop absolute right-0 z-40 mt-1 max-h-80 w-80 overflow-auto rounded-xl p-2"
          >
            <TextInput value={q} onChange={setQ} placeholder={t('search')} className="mb-2 h-8" />
            {TOKEN_CATALOGUE.map((fam) => {
              const items = fam.tokens.filter(
                (tok) => !q || (tok.token + tt(`hints.${tok.hint}`)).toLowerCase().includes(q.toLowerCase()),
              );
              if (!items.length) return null;
              return (
                <div key={fam.family} className="mb-1.5">
                  <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-faint uppercase">
                    {tt(`families.${fam.family}`)}
                  </div>
                  {items.map((tok) => (
                    <button
                      type="button"
                      key={tok.token}
                      onClick={() => insert(tok.token)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sunken"
                    >
                      <code className="text-[12px] text-accent">{tok.token}</code>
                      <span className="truncate text-[11px] text-faint">
                        {evaluate(tok.token, ctx) || tt(`hints.${tok.hint}`)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  width = 'max-w-lg',
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  title?: ReactNode;
}) {
  const t = useTranslations('ui');
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    requestAnimationFrame(() => panel.current?.focus());
    return () => {
      window.removeEventListener('keydown', k);
      previous?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div className="absolute inset-0 bg-[#111110]/30" onClick={onClose} />
          <motion.div
            ref={panel}
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={softSpring}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className={cx(
              'surface-pop relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl outline-none',
              width,
            )}
          >
            {title && (
              <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
                <h3 id={titleId} className="text-base font-semibold tracking-[-0.01em]">
                  {title}
                </h3>
                <IconButton label={t('close')} onClick={onClose}>
                  <X className="size-4" />
                </IconButton>
              </div>
            )}
            <div className="min-h-0 overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Animated number for stat tiles. */
export function Counter({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -10, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="inline-block"
      >
        {value.toLocaleString()}
      </motion.span>
    </AnimatePresence>
  );
}
