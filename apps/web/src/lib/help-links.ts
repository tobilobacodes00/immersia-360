import type { Route } from 'next';

/**
 * The help articles the app links to from its own screens (HLP-2, HLP-3): an error card, a setting
 * and a wizard step each point at the article that explains them. Slugs are file names under
 * `content/help/<locale>/`; a test checks every one of them exists in every language, so a rename
 * can't leave a dead "?" link behind.
 */
export const HELP_ARTICLES = {
  gettingStarted: 'getting-started',
  setupCheck: 'setup-check',
  devices: 'devices-and-registration',
  booth360: '360-booth-setup',
  slowMotion: 'slow-motion-tips',
  captureKeys: 'capture-triggers-and-shortcuts',
  renderSpeed: 'render-speed-and-queue',
  photoBooth: 'photo-booth-and-layouts',
  printing: 'printing-setup',
  kioskPrinting: 'chrome-kiosk-printing',
  kioskLocking: 'kiosk-locking',
  livePairing: 'live-display-pairing',
  liveModeration: 'live-display-moderation',
  sharingStation: 'sharing-station',
  sharing: 'sharing-with-guests',
  gallery: 'gallery-and-zip-export',
  expiry: 'expiry-and-extending',
  googleDrive: 'connect-google-drive',
  dropbox: 'connect-dropbox',
  cloudErrors: 'cloud-copy-errors',
  offline: 'offline-mode-and-uploads',
  iosStorage: 'ios-storage-eviction',
  guestPrivacy: 'guest-privacy',
  cameraPermissions: 'camera-permissions',
  boothErrors: 'booth-error-messages',
  templates: 'templates-and-editor',
  looks: 'looks-and-effects',
  roles: 'team-roles',
  support: 'contact-and-status',
} as const;

export type HelpSlug = (typeof HELP_ARTICLES)[keyof typeof HELP_ARTICLES];

/** Where the help centre lives: inside the Studio for signed-in operators, public for everyone else. */
export type HelpScope = 'studio' | 'public';

export const HELP_BASE: Record<HelpScope, string> = { studio: '/studio/help', public: '/help' };

export function helpHref(slug: HelpSlug, scope: HelpScope = 'studio', anchor?: string): Route {
  return `${HELP_BASE[scope]}/${slug}${anchor ? `#${anchor}` : ''}` as Route;
}
