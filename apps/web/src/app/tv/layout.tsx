import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// TV screens belong to one event and are never for search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The marker globals.css looks for: with it, the page scales to the screen (1rem is a fixed share of
 * the short side, so everything in rem reads the same from 720p to 4K) and never scrolls.
 */
export default function TvLayout({ children }: { children: ReactNode }) {
  return <div className="tv-root">{children}</div>;
}
