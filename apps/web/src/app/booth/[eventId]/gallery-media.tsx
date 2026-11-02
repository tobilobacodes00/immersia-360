'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TakeStore } from '@immersia/offline';
import { cx } from '@immersia/ui';
import { isVideoMime, thumbSource, type GalleryItem } from './gallery-model';

/**
 * One IntersectionObserver for the whole grid, rooted on the scrolling panel, so a few hundred cards
 * cost one observer. A card learns when it is within a screen of view and loads its file only then.
 */
export class ViewObserver {
  private root: Element | null = null;
  private io: IntersectionObserver | null = null;
  private listeners = new Map<Element, (visible: boolean) => void>();

  setRoot(root: Element | null) {
    this.root = root;
  }

  /** Start watching; returns the function that stops. */
  observe(el: Element, onChange: (visible: boolean) => void): () => void {
    this.io ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) this.listeners.get(e.target)?.(e.isIntersecting);
      },
      // A screen's worth of lead, so scrolling at a normal pace never shows an empty card.
      { root: this.root, rootMargin: '100% 0px' },
    );
    this.listeners.set(el, onChange);
    this.io.observe(el);
    return () => {
      this.listeners.delete(el);
      this.io?.unobserve(el);
    };
  }

  dispose() {
    this.io?.disconnect();
    this.io = null;
    this.listeners.clear();
  }
}

/**
 * An object URL for a file on the device, made when the component mounts and revoked when it
 * unmounts: the URL (and the decoded media behind it) lives only while the card is on screen.
 */
export function useBlobUrl(store: TakeStore, path: string, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    store
      .read(path, mime)
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((err) => console.warn('[gallery] unreadable', path, err));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [store, path, mime]);
  return url;
}

function Loaded({ item, store }: { item: GalleryItem; store: TakeStore }) {
  const source = thumbSource(item);
  const url = useBlobUrl(store, source.path, source.mime);
  if (!url) return null;
  if (source.element === 'video')
    return (
      // #t nudges Safari to paint the first frame; metadata alone leaves the box black.
      <video
        src={`${url}#t=0.001`}
        preload="metadata"
        muted
        playsInline
        disablePictureInPicture
        aria-hidden
        tabIndex={-1}
        className="size-full object-cover"
      />
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise
    <img
      src={url}
      alt=""
      decoding="async"
      draggable={false}
      className={cx('size-full', item.kind === 'strip' ? 'object-contain p-2' : 'object-cover')}
    />
  );
}

/**
 * A card's picture. It reads the file only while the card is near the viewport, and not at all
 * while the booth is capturing (`paused`): decoding competes with the recorder for the device.
 */
export function Thumb({
  item,
  store,
  viewer,
  paused,
  children,
}: {
  item: GalleryItem;
  store: TakeStore | null;
  viewer: ViewObserver;
  paused: boolean;
  /** Badges drawn over the picture. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    return viewer.observe(el, setNear);
  }, [viewer]);
  return (
    <span ref={box} className="relative block aspect-[4/5] overflow-hidden bg-sunken">
      {near && !paused && store && <Loaded item={item} store={store} />}
      {children}
    </span>
  );
}

/** The large preview in the detail sheet. */
export function Preview({ item, store, label }: { item: GalleryItem; store: TakeStore; label: string }) {
  const url = useBlobUrl(store, item.path, item.mime);
  if (!url) return <span className="block size-24 animate-pulse rounded-xl bg-line motion-reduce:animate-none" />;
  if (isVideoMime(item.mime))
    // Muted autoplay plays everywhere without a gesture; the operator can unmute.
    return (
      <video
        src={url}
        controls
        autoPlay
        muted
        loop
        playsInline
        aria-label={label}
        className="block max-h-[60dvh] w-full rounded-lg bg-black"
      />
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise
    <img src={url} alt={label} className="block max-h-[60dvh] w-auto max-w-full rounded-lg object-contain" />
  );
}
