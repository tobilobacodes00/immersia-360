'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CircleAlert, Loader2 } from 'lucide-react';
import { SHORT_CODE_LENGTH } from '@immersia/shared/ids';
import { BrandMark, cx, useHydrated } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';
import { readDisplayToken, saveDisplayToken } from './display-token';
import { cellsFrom, fillCells, firstEmpty, pairingChars } from './pairing';

type ErrorKey = 'incomplete' | 'invalid' | 'expired' | 'too_many' | 'offline' | 'storage' | 'unavailable';
type Phase = 'idle' | 'pairing' | 'paired';

const noSubscribe = () => () => {};

/**
 * Screen 24: the TV's pairing screen (LIV-1). Big, remote-friendly boxes for the six-character code,
 * or `?code=` from the pairing QR, which pairs without typing. Sized in rem, which scales with the
 * short side of the screen (see globals.css), so it reads from across a room at 720p or 4K.
 */
export function PairingScreen({ initialCode }: { initialCode: string }) {
  const t = useTranslations('tv.pair');
  const router = useRouter();
  const hydrated = useHydrated();
  const hasToken = useSyncExternalStore(
    noSubscribe,
    () => readDisplayToken() !== null,
    () => false,
  );
  const auto = initialCode.length === SHORT_CODE_LENGTH;

  const [cells, setCells] = useState(() => cellsFrom(initialCode));
  const [phase, setPhase] = useState<Phase>(auto ? 'pairing' : 'idle');
  const [error, setError] = useState<ErrorKey | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const connect = useRef<HTMLButtonElement>(null);
  const started = useRef(false);

  const pair = useCallback(
    async (code: string) => {
      let failure: ErrorKey = 'unavailable';
      try {
        const res = await fetch('/api/live/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { token?: string } | null;
          if (body?.token && saveDisplayToken(body.token)) {
            setPhase('paired');
            router.replace('/tv/live');
            return;
          }
          failure = body?.token ? 'storage' : 'unavailable';
        } else if (res.status === 429) failure = 'too_many';
        else if (res.status === 404 || res.status === 400) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          failure = body?.error === 'expired' ? 'expired' : 'invalid';
        }
      } catch {
        failure = 'offline';
      }
      setError(failure);
      setPhase('idle');
      // Back to the boxes, so the fix is a keystroke away.
      inputs.current[SHORT_CODE_LENGTH - 1]?.focus();
    },
    [router],
  );

  // A TV that is already paired goes straight to its display, unless it was sent a new code.
  const redirecting = hasToken && !auto;
  useEffect(() => {
    if (redirecting) router.replace('/tv/live');
  }, [redirecting, router]);

  // `?code=` pairs once: Strict Mode's second run, or a re-render, must not spend the code twice.
  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void pair(initialCode);
  }, [auto, initialCode, pair]);

  // The first empty box is where a remote or keyboard starts.
  useEffect(() => {
    if (!auto) inputs.current[Math.max(0, firstEmpty(cellsFrom(initialCode)))]?.focus();
  }, [auto, initialCode]);

  const focusAfter = (next: string[], at: number) => {
    const empty = firstEmpty(next);
    if (at >= SHORT_CODE_LENGTH) {
      if (empty === -1) connect.current?.focus();
      else inputs.current[empty]?.focus();
    } else inputs.current[at]?.focus();
  };

  const onChange = (i: number, e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const chars = pairingChars(raw);
    // Nothing a code can contain (a 0, an O): keep what the box held.
    if (raw && !chars) return;
    setError(null);
    if (!raw) {
      setCells(cells.map((c, j) => (j === i ? '' : c)));
      return;
    }
    const next = fillCells(cells, i, chars);
    setCells(next);
    focusAfter(next, i + chars.length);
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const chars = pairingChars(e.clipboardData.getData('text'));
    if (!chars) return;
    setError(null);
    // A whole code replaces what was typed; a fragment goes in from this box.
    const start = chars.length >= SHORT_CODE_LENGTH ? 0 : i;
    const next = fillCells(cells, start, chars);
    setCells(next);
    focusAfter(next, start + chars.length);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !cells[i] && i > 0) {
      e.preventDefault();
      setCells(cells.map((c, j) => (j === i - 1 ? '' : c)));
      inputs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      inputs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < SHORT_CODE_LENGTH - 1) {
      e.preventDefault();
      inputs.current[i + 1]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      connect.current?.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (phase !== 'idle') return;
    const missing = firstEmpty(cells);
    if (missing !== -1) {
      setError('incomplete');
      inputs.current[missing]?.focus();
      return;
    }
    setError(null);
    setPhase('pairing');
    void pair(cells.join(''));
  };

  if (redirecting) return <div className="min-h-dvh bg-bg" aria-busy="true" />;

  const busy = phase !== 'idle';
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <main className="flex flex-1 items-center px-[8vmin] py-[6vmin]">
        <div className="w-full max-w-[64rem]">
          <div className="flex items-center gap-[1rem]">
            <BrandMark size={48} />
            <span className="text-[1.5rem] font-semibold tracking-[-0.01em]">Immersia 360</span>
          </div>
          <h1 className="mt-[3rem] text-[4.5rem] leading-[0.95] font-bold tracking-[-0.04em] text-balance">
            {t('title')}
          </h1>
          <p className="mt-[1.25rem] max-w-[46rem] text-[1.5rem] leading-snug text-muted">{t('body')}</p>

          <form onSubmit={submit} noValidate className="mt-[3rem]">
            <div role="group" aria-labelledby="pair-code-label">
              <p id="pair-code-label" className="text-[1.15rem] font-semibold tracking-[0.14em] text-faint uppercase">
                {t('codeLabel')}
              </p>
              <div className="mt-[1rem] flex items-center gap-[1rem]">
                {cells.map((cell, i) => (
                  <Fragment key={i}>
                    {i === SHORT_CODE_LENGTH / 2 && (
                      <span aria-hidden className="h-[0.3rem] w-[1.4rem] rounded-full bg-line-strong" />
                    )}
                    <input
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      value={cell}
                      onChange={(e) => onChange(i, e)}
                      onKeyDown={(e) => onKeyDown(i, e)}
                      onPaste={(e) => onPaste(i, e)}
                      onFocus={(e) => e.currentTarget.select()}
                      readOnly={busy}
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint={i === SHORT_CODE_LENGTH - 1 ? 'go' : 'next'}
                      aria-label={t('character', { n: i + 1, total: SHORT_CODE_LENGTH })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? 'pair-error' : 'pair-hint'}
                      className={cx(
                        'h-[8rem] w-[6rem] rounded-[1rem] border-[0.2rem] bg-elev text-center font-mono text-[4.25rem] leading-none font-bold text-fg uppercase outline-none transition-colors',
                        'focus-visible:border-accent focus-visible:ring-[0.4rem] focus-visible:ring-accent-soft',
                        error ? 'border-bad' : cell ? 'border-ink' : 'border-faint',
                      )}
                    />
                  </Fragment>
                ))}
              </div>
            </div>

            <p id="pair-hint" className="mt-[1.25rem] text-[1.15rem] text-faint">
              {t('hint')}
            </p>
            {error && (
              <p
                id="pair-error"
                role="alert"
                className="mt-[1.25rem] flex items-center gap-[0.75rem] text-[1.5rem] font-medium text-bad"
              >
                <CircleAlert className="size-[1.75rem] shrink-0" aria-hidden />
                {t(`errors.${error}`)}
              </p>
            )}

            <div className="mt-[2.5rem] flex flex-wrap items-center gap-[1.5rem]">
              <button
                ref={connect}
                type="submit"
                disabled={!hydrated || busy}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const missing = firstEmpty(cells);
                    inputs.current[missing === -1 ? SHORT_CODE_LENGTH - 1 : missing]?.focus();
                  }
                }}
                className="inline-flex h-[5.5rem] min-w-[18rem] items-center justify-center gap-[1rem] rounded-full bg-ink px-[3.5rem] text-[1.9rem] font-semibold text-white transition-colors focus-visible:outline-[0.3rem] focus-visible:outline-offset-[0.3rem] focus-visible:outline-accent enabled:hover:bg-[#2a2a28] disabled:opacity-60"
              >
                {busy && <Loader2 className="size-[2rem] animate-spin motion-reduce:animate-none" aria-hidden />}
                {busy ? t(phase === 'paired' ? 'connected' : 'connecting') : t('submit')}
              </button>
              {hasToken && (
                <button
                  type="button"
                  onClick={() => router.replace('/tv/live')}
                  className="inline-flex h-[5.5rem] items-center justify-center rounded-full border-[0.2rem] border-line-strong bg-elev px-[3rem] text-[1.6rem] font-semibold text-fg focus-visible:outline-[0.3rem] focus-visible:outline-offset-[0.3rem] focus-visible:outline-accent"
                >
                  {t('backToDisplay')}
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
      <footer className="px-[8vmin] pb-[4vmin]">
        <LanguagePicker className="w-[16rem] [&_select]:h-[3.25rem] [&_select]:text-[1.2rem]" />
      </footer>
    </div>
  );
}
