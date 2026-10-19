/** Guest display type, shared by client screens and server-rendered guest pages (no 'use client'). */
export type DisplayFont = 'sans' | 'serif';

export const displayFontClass = (font: DisplayFont) =>
  font === 'serif' ? 'font-serif' : 'font-sans font-bold tracking-[-0.04em]';
