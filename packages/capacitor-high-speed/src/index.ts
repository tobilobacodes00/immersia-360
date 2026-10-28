import { registerPlugin } from '@capacitor/core';
import type { HighSpeedPlugin } from './definitions';

/**
 * The plugin name is `HighSpeed` on both platforms (`jsName` in Swift, `@CapacitorPlugin(name)` in
 * Kotlin). The web implementation is a separate chunk that is only fetched where there is no native
 * plugin, so inside the companion it is never downloaded.
 */
export const PLUGIN_NAME = 'HighSpeed';

const HighSpeed = registerPlugin<HighSpeedPlugin>(PLUGIN_NAME, {
  web: () => import('./web').then((m) => new m.HighSpeedWeb()),
});

export * from './definitions';
export { HighSpeed };
