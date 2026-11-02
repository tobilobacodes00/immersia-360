import { useCallback, useEffect, useRef, useState } from 'react';
import { detectNativeHfr, type HighSpeedCapabilities, type HighSpeedPlugin } from '@immersia/capture';

/** The companion's native high-speed camera, loaded: the plugin and what this device's lenses can do. */
export interface NativeHfr {
  bridge: HighSpeedPlugin;
  capabilities: HighSpeedCapabilities;
}

/**
 * Load the native recorder (CAP-14) where the booth runs inside the companion app, and nowhere else. The
 * detection is a check of the `Capacitor` global the app injects; only when it passes is the plugin imported
 * (a separate chunk: a browser never downloads it) and the device asked what its lenses can record.
 * Resolves null in a browser, and when the plugin fails to load.
 */
export async function loadNativeHfr(): Promise<NativeHfr | null> {
  if (!detectNativeHfr()) return null;
  try {
    const { HighSpeed } = await import('@immersia/capacitor-high-speed');
    return { bridge: HighSpeed, capabilities: await HighSpeed.capabilities() };
  } catch (err) {
    console.warn('[booth] the native high-speed camera could not be loaded', err);
    return null;
  }
}

/**
 * The native camera for the booth: `native` is null in a browser and until the companion has answered;
 * `ensure()` resolves with the answer (asked once), for a camera that opens before the state has updated.
 */
export function useNativeHfr() {
  const [native, setNative] = useState<NativeHfr | null>(null);
  const pending = useRef<Promise<NativeHfr | null> | null>(null);

  const ensure = useCallback(() => {
    pending.current ??= loadNativeHfr();
    return pending.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ensure().then((loaded) => {
      if (!cancelled) setNative(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [ensure]);

  return { native, ensure };
}
