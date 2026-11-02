'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';

/** SHR-5: the client's optional password, asked once per browser (a week-long cookie). */
export function GalleryLock({ slug }: { slug: string }) {
  const t = useTranslations('gallery.lock');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<null | 'wrong' | 'tooMany' | 'failed'>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/g/${slug}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return router.refresh();
    setError(res?.status === 401 ? 'wrong' : res?.status === 429 ? 'tooMany' : 'failed');
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-3" noValidate>
      <p className="flex items-center gap-2 opacity-70">
        <Lock className="size-4" aria-hidden /> {t('body')}
      </p>
      <label htmlFor="gallery-password" className="block font-semibold">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <input
          id="gallery-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error === 'wrong' || undefined}
          aria-describedby={error ? 'gallery-password-error' : undefined}
          className="focus-ring h-12 min-w-0 flex-1 rounded-full border border-g-ink/20 bg-white px-5 text-[#111110]"
        />
        <button
          type="submit"
          disabled={busy || !password}
          className="focus-ring h-12 rounded-full bg-g-accent px-6 font-semibold text-g-on-accent disabled:opacity-60"
        >
          {t('open')}
        </button>
      </div>
      {error && (
        <p id="gallery-password-error" role="alert">
          {t(`errors.${error}`)}
        </p>
      )}
    </form>
  );
}
