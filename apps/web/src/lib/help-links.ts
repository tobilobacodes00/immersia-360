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

export function helpHref(slug: string, scope: HelpScope = 'studio', anchor?: string): Route {
  return `${HELP_BASE[scope]}/${slug}${anchor ? `#${anchor}` : ''}` as Route;
}

/** A place in a help article: the article and the heading (by its `{#id}`) that answers the question. */
export interface HelpTarget {
  slug: HelpSlug;
  anchor?: string;
}

/**
 * Headings with a fixed id, in every language (`## Title {#id}`), that a screen links straight to.
 * `content.test.ts` checks that each one exists in each language's article.
 */
export const HELP_TARGETS = {
  expiryPeriod: { slug: HELP_ARTICLES.expiry, anchor: 'period' },
  expiryExtend: { slug: HELP_ARTICLES.expiry, anchor: 'extend' },
  shareSettings: { slug: HELP_ARTICLES.sharing, anchor: 'settings' },
  guestForm: { slug: HELP_ARTICLES.guestPrivacy, anchor: 'guest-form' },
  guestList: { slug: HELP_ARTICLES.guestPrivacy, anchor: 'guests' },
  guestRequests: { slug: HELP_ARTICLES.guestPrivacy, anchor: 'requests' },
  yourData: { slug: HELP_ARTICLES.guestPrivacy, anchor: 'your-data' },
  pairDisplay: { slug: HELP_ARTICLES.livePairing, anchor: 'pair' },
  signage: { slug: HELP_ARTICLES.gallery, anchor: 'signage' },
  zipExport: { slug: HELP_ARTICLES.gallery, anchor: 'zip' },
  dynamicFields: { slug: HELP_ARTICLES.templates, anchor: 'fields' },
  assets: { slug: HELP_ARTICLES.templates, anchor: 'assets' },
  inviteMember: { slug: HELP_ARTICLES.roles, anchor: 'invite' },
  background: { slug: HELP_ARTICLES.looks, anchor: 'background' },
  kioskLock: { slug: HELP_ARTICLES.kioskLocking, anchor: 'lock' },
  printingOn: { slug: HELP_ARTICLES.printing, anchor: 'turn-on' },
} as const satisfies Record<string, HelpTarget>;

/**
 * The camera error codes of the booth (`booth.errors.*`) and where each is explained. The access
 * problems and the lost camera have steps per browser in `camera-permissions`; a browser that can't
 * record, and an unknown failure, are in `booth-error-messages`. A test keeps both articles' anchors
 * in step with these codes.
 */
export function cameraErrorHelp(code: string): HelpTarget {
  switch (code) {
    case 'permission':
    case 'not_found':
    case 'in_use':
    case 'overconstrained':
    case 'insecure':
    case 'lost':
      return { slug: HELP_ARTICLES.cameraPermissions, anchor: code };
    case 'recording_unsupported':
      return { slug: HELP_ARTICLES.boothErrors, anchor: code };
    default:
      return { slug: HELP_ARTICLES.boothErrors, anchor: 'unknown' };
  }
}

/** The render error codes of a failed take (`booth.renderErrors.*`); anything else is the generic one. */
const RENDER_ERROR_ANCHORS = new Set([
  'undecodable',
  'unsupported_encoder',
  'encoder_stall',
  'gpu',
  'cancelled',
  'failed',
]);
export const renderErrorHelp = (code: string | null | undefined): HelpTarget => ({
  slug: HELP_ARTICLES.boothErrors,
  anchor: code && RENDER_ERROR_ANCHORS.has(code) ? code : 'failed',
});

/**
 * The copy errors of a cloud (`studio.integrations.copyErrors.*`) and the connect errors
 * (`connectErrors.*`) are both explained, under their own code, in `cloud-copy-errors`.
 */
export const cloudErrorHelp = (code: string): HelpTarget => ({ slug: HELP_ARTICLES.cloudErrors, anchor: code });
