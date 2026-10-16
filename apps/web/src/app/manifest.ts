import type { MetadataRoute } from 'next';

/** PWA manifest (NFR Installability): home-screen icon, full-screen display, offline shell. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Immersia 360',
    short_name: 'Immersia',
    description: 'Free 360 video and photo booth that runs in your browser.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#f7f6f2',
    theme_color: '#f7f6f2',
    categories: ['photo', 'entertainment', 'productivity'],
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
