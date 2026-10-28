'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'motion/react';
import type { DisplayConfig, DisplayItem } from '@immersia/shared';
import { DEFAULT_THEME, guestThemeVars } from '@immersia/shared/theme';
import { cx } from '@immersia/ui';
import { emitDisplayEvent } from '@/lib/analytics-client';
import { useLiveFeed } from '@/lib/live-feed';
import { useAnalyticsFlusher } from '@/lib/use-analytics-flusher';
import { DISPLAY_FEED_KEY, clearDisplayToken, readDisplayToken } from '../display-token';
import { Controls, EventBackground } from './chrome';
import { DisplayProvider, type DisplayView } from './context';
import { Counter, Idle, Mosaic, Spotlight, Ticker } from './layouts';
import { usePlayback } from './use-playback';
import { useMediaCacheSync } from './use-media';
import { useActivity, useBackgroundMusic, useFlash, useFullscreen, useUserGesture, useWakeLock } from './use-tv';

/** The cursor goes after this long without the mouse or a key. */
const IDLE_MS = 3000;
/** A connection change stays on screen this long. */
const STATUS_MS = 5000;
/** Music sits well under the room; under a video that has its own sound it steps further back. */
const MUSIC_VOLUME = 0.35;
const MUSIC_VOLUME_UNDER_VIDEO = 0.1;

const NO_ITEMS: DisplayItem[] = [];

/**
 * Screen 17: a paired TV's Live Display. Everything it shows comes from its token's feed; a TV
 * with no token (or one the operator removed) goes back to the pairing screen.
 */
export function DisplayApp() {
  const router = useRouter();
  // Client-only (loaded with ssr: false), so reading storage while rendering is safe.
  const [token] = useState(readDisplayToken);
  useEffect(() => {
    if (!token) router.replace('/tv');
  }, [token, router]);
  return token ? <Display token={token} /> : <Quiet />;
}

function Quiet() {
  return <div className="fixed inset-0 bg-bg" aria-busy="true" />;
}

function Display({ token }: { token: string }) {
  const router = useRouter();
  const t = useTranslations('tv.display');
  const onUnauthorized = useCallback(() => {
    clearDisplayToken();
    router.replace('/tv');
  }, [router]);
  const { feed, items, connection } = useLiveFeed({
    url: '/api/live/feed',
    headers: { authorization: `Bearer ${token}` },
    cacheKey: DISPLAY_FEED_KEY,
    onUnauthorized,
  });

  const config = feed?.config ?? null;
  // Items show only while Live Display is on, even if the screen still holds some (PRD privacy).
  const live = config?.event.live ?? false;
  const playable = live ? items : NO_ITEMS;
  const playback = usePlayback(config ? playable : null, config?.settings.dwellSeconds ?? 8);

  // LIV-12: the newest 200 items and the event's own files, kept on the device.
  useMediaCacheSync(playable, [config?.event.logoUrl, config?.event.background?.url, config?.event.backgroundMusicUrl]);

  useWakeLock();
  const active = useActivity(IDLE_MS);
  const fullscreen = useFullscreen();
  const statusRecent = useFlash(connection, STATUS_MS);
  const reduced = useReducedMotion();

  const unlocked = useUserGesture();
  const [soundBlocked, setSoundBlocked] = useState(false);
  const reportSoundBlocked = useCallback(() => setSoundBlocked(true), []);
  const videoHasSound = playback.current?.media.type === 'video' && config?.settings.videosMuted === false;
  useBackgroundMusic({
    url: config?.event.backgroundMusicUrl ?? null,
    volume: videoHasSound ? MUSIC_VOLUME_UNDER_VIDEO : MUSIC_VOLUME,
    unlocked,
    onBlocked: reportSoundBlocked,
  });

  const layout = pickLayout(config, playback.current);

  // Live Display analytics: how long each item stayed on screen (a play ends when the next begins,
  // or the screen closes). Buffered on the device and sent in the background, never on the way of playback.
  useAnalyticsFlusher('display', token);
  const playingId = layout === 'idle' || layout === 'counter' ? null : (playback.current?.id ?? null);
  const playId = playback.playId;
  const layoutName = config?.layout;
  useEffect(() => {
    if (!playingId) return;
    const startedAt = performance.now();
    return () => {
      const seconds = (performance.now() - startedAt) / 1000;
      if (seconds >= 1)
        emitDisplayEvent({ name: 'item_displayed', seconds_on_screen: Math.min(seconds, 3600), layout: layoutName });
    };
  }, [playingId, playId, layoutName]);
  const view: DisplayView | null = config && {
    config,
    items: playback.items,
    current: playback.current,
    playId: playback.playId,
    durationMs: playback.durationMs,
    currentJustIn: playback.currentJustIn,
    justIn: playback.justIn,
    unlocked,
    reportLength: playback.reportLength,
    fail: playback.fail,
    reportSoundBlocked,
  };

  return (
    <div
      className={cx(
        'fixed inset-0 overflow-hidden bg-g-bg text-g-ink select-none',
        // The cursor is for the operator: gone after a few quiet seconds, buttons included.
        !active && 'cursor-none [&_*]:cursor-none',
      )}
      style={guestThemeVars(config?.event.theme ?? DEFAULT_THEME)}
    >
      {view ? (
        <DisplayProvider value={view}>
          <EventBackground />
          <motion.div
            key={layout}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.5 }}
          >
            {layout === 'spotlight' && <Spotlight />}
            {layout === 'mosaic' && <Mosaic />}
            {layout === 'ticker' && <Ticker />}
            {layout === 'counter' && <Counter />}
            {layout === 'idle' && <Idle />}
          </motion.div>
        </DisplayProvider>
      ) : (
        // No feed yet (the first start, offline): quiet, branded by the paper itself, not an error.
        <p role="status" className="absolute inset-0 grid place-items-center text-[1.6rem] font-medium text-muted">
          {t('connecting')}
        </p>
      )}
      <Controls
        connection={connection}
        statusVisible={statusRecent}
        controlsVisible={active}
        soundHint={soundBlocked && !unlocked}
        fullscreen={fullscreen}
      />
    </div>
  );
}

/**
 * Which screen to draw. The configured layout, unless there is nothing to play (no items yet, or
 * Live Display off): then the branded idle screen. Counter shows no items, so it always stands.
 */
function pickLayout(config: DisplayConfig | null, current: DisplayItem | null): DisplayConfig['layout'] | 'idle' {
  if (!config) return 'idle';
  if (config.layout === 'counter') return 'counter';
  return config.event.live && current ? config.layout : 'idle';
}
