import { onAccent } from './color';

/**
 * Event theme for every guest-facing surface (booth, share page, gallery, Live Display, kiosk).
 * One accent per event, on a light paper background — the Immersia Booth design language.
 */
export interface EventTheme {
  accent: string;
  background: string;
  ink: string;
  font: 'sans' | 'serif';
}

export const THEME_PRESETS: readonly { name: string; theme: EventTheme }[] = [
  { name: 'Cobalt', theme: { accent: '#2b3fe6', background: '#f7f6f2', ink: '#111110', font: 'sans' } },
  { name: 'Vermilion', theme: { accent: '#c8401c', background: '#faf7f2', ink: '#1a1714', font: 'sans' } },
  { name: 'Forest', theme: { accent: '#1f6b4a', background: '#f4f3ee', ink: '#12140f', font: 'serif' } },
  { name: 'Champagne', theme: { accent: '#8a5a2b', background: '#f8f4ec', ink: '#1e1912', font: 'serif' } },
  { name: 'Monochrome', theme: { accent: '#111110', background: '#ffffff', ink: '#111110', font: 'sans' } },
];

export const DEFAULT_THEME: EventTheme = THEME_PRESETS[0]!.theme;

/** The g-* CSS variables consumed by the `g-*` colour tokens in the design system. */
export function guestThemeVars(t: EventTheme): Record<string, string> {
  return {
    '--g-bg': t.background,
    '--g-ink': t.ink,
    '--g-accent': t.accent,
    '--g-on-accent': onAccent(t.accent),
  };
}
