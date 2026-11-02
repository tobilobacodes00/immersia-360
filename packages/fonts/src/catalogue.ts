/**
 * PHO-9: the curated list of open-licence families the editor and the booth can draw with.
 *
 * Every family is on Google Fonts under SIL OFL 1.1 or Apache 2.0 (checked against each family's
 * METADATA.pb in github.com/google/fonts, which sorts families into ofl/ and apache/ directories).
 * Nothing under the Ubuntu Font Licence or a proprietary one. Instrument Serif and Satoshi are
 * app built-ins, loaded through next/font, so they are not listed here.
 *
 * This file is also the input of scripts/generate.mjs, which Node loads directly (type stripping), so
 * it stays self-contained: no imports and only erasable TypeScript syntax.
 */

export const FONT_CATEGORIES = ['sans', 'serif', 'display', 'handwriting', 'mono'] as const;

export type FontCategory = (typeof FONT_CATEGORIES)[number];
export type FontLicence = 'OFL-1.1' | 'Apache-2.0';

export interface CatalogueFamily {
  family: string;
  /** Directory name under /fonts/lib: kebab-case of the family. */
  slug: string;
  category: FontCategory;
  /** The weights we ship (upright). Only the useful subset of what the family offers. */
  weights: number[];
  /** Also ship 400 italic (kept for a handful of text faces where it earns its bytes). */
  italic: boolean;
  licence: FontLicence;
}

export function slugOf(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface Options {
  weights?: number[];
  italic?: boolean;
  /** Licensed under Apache 2.0 rather than OFL 1.1. */
  apache?: boolean;
}

const group =
  (category: FontCategory, defaultWeights: number[]) =>
  (family: string, o: Options = {}): CatalogueFamily => ({
    family,
    slug: slugOf(family),
    category,
    weights: [...(o.weights ?? defaultWeights)],
    italic: o.italic ?? false,
    licence: o.apache ? 'Apache-2.0' : 'OFL-1.1',
  });

// Text families come in regular and bold; display and script faces are mostly one weight.
const sans = group('sans', [400, 700]);
const serif = group('serif', [400, 700]);
const display = group('display', [400]);
const handwriting = group('handwriting', [400]);
const mono = group('mono', [400, 700]);

export const CATALOGUE: readonly CatalogueFamily[] = [
  // Sans
  sans('Inter', { italic: true }),
  sans('Roboto'),
  sans('Open Sans', { italic: true }),
  sans('Lato', { italic: true }),
  sans('Montserrat'),
  sans('Poppins'),
  sans('Nunito'),
  sans('Raleway'),
  sans('Work Sans'),
  sans('DM Sans'),
  sans('Manrope'),
  sans('Outfit'),
  sans('Plus Jakarta Sans'),
  sans('Rubik'),
  sans('Karla'),
  sans('Mulish'),
  sans('Figtree'),
  sans('Sora'),
  sans('Lexend'),
  sans('Urbanist'),
  sans('Barlow'),
  sans('Barlow Condensed'),
  sans('Josefin Sans'),
  sans('Quicksand'),
  sans('Cabin'),
  sans('Fira Sans'),
  sans('Source Sans 3'),
  sans('IBM Plex Sans'),
  sans('Noto Sans'),
  sans('Albert Sans'),
  sans('Red Hat Display'),
  sans('Jost'),
  sans('Space Grotesk'),
  sans('Instrument Sans'),
  sans('Oswald'),
  sans('Varela Round', { weights: [400] }),
  sans('Questrial', { weights: [400] }),

  // Serif
  serif('Playfair Display', { italic: true }),
  serif('Cormorant Garamond', { italic: true }),
  serif('Cormorant'),
  serif('Lora', { italic: true }),
  serif('Merriweather'),
  serif('Libre Baskerville', { italic: true }),
  serif('EB Garamond', { italic: true }),
  serif('Crimson Pro'),
  serif('DM Serif Display', { weights: [400], italic: true }),
  serif('DM Serif Text', { weights: [400] }),
  serif('Bitter'),
  serif('Noto Serif'),
  serif('Source Serif 4', { italic: true }),
  serif('PT Serif'),
  serif('Cardo'),
  serif('Spectral'),
  serif('Fraunces'),
  serif('Newsreader'),
  serif('Libre Caslon Text'),
  serif('Bodoni Moda'),
  serif('Old Standard TT'),
  serif('Vollkorn'),
  serif('Alegreya'),
  serif('Zilla Slab'),
  serif('Roboto Slab', { apache: true }),
  serif('Cinzel'),
  serif('Libre Bodoni'),
  serif('Marcellus', { weights: [400] }),
  serif('Prata', { weights: [400] }),
  serif('Young Serif', { weights: [400] }),

  // Display
  display('Bebas Neue'),
  display('Anton'),
  display('Abril Fatface'),
  display('Righteous'),
  display('Bangers'),
  display('Monoton'),
  display('Shrikhand'),
  display('Alfa Slab One'),
  display('Archivo Black'),
  display('Fjalla One'),
  display('Passion One', { weights: [400, 700] }),
  display('Luckiest Guy', { apache: true }),
  display('Chewy', { apache: true }),
  display('Press Start 2P'),
  display('Audiowide'),
  display('Staatliches'),
  display('Limelight'),
  display('Cinzel Decorative', { weights: [400, 700] }),
  display('Comfortaa', { weights: [400, 700] }),
  display('Lilita One'),
  display('Poiret One'),
  display('Creepster'),
  display('Pirata One'),
  display('Henny Penny'),
  display('Big Shoulders Display', { weights: [400, 700] }),
  display('Gloock'),
  display('Yeseva One'),
  display('Italiana'),
  display('Syne', { weights: [400, 700] }),
  display('Bricolage Grotesque', { weights: [400, 700] }),

  // Handwriting and script (wedding scripts first)
  handwriting('Great Vibes'),
  handwriting('Parisienne'),
  handwriting('Allura'),
  handwriting('Pinyon Script'),
  handwriting('Alex Brush'),
  handwriting('Dancing Script', { weights: [400, 700] }),
  handwriting('Sacramento'),
  handwriting('Tangerine', { weights: [400, 700] }),
  handwriting('Italianno'),
  handwriting('Mr Dafoe'),
  handwriting('Mrs Saint Delafield'),
  handwriting('Herr Von Muellerhoff'),
  handwriting('Rouge Script'),
  handwriting('Arizonia'),
  handwriting('Imperial Script'),
  handwriting('Birthstone'),
  handwriting('Allison'),
  handwriting('Whisper'),
  handwriting('Playball'),
  handwriting('Satisfy', { apache: true }),
  handwriting('Yellowtail', { apache: true }),
  handwriting('Kaushan Script'),
  handwriting('Cookie'),
  handwriting('Courgette'),
  handwriting('Lobster'),
  handwriting('Pacifico'),
  handwriting('Caveat', { weights: [400, 700] }),
  handwriting('Shadows Into Light'),
  handwriting('Indie Flower'),
  handwriting('Amatic SC', { weights: [400, 700] }),
  handwriting('Permanent Marker', { apache: true }),
  handwriting('Rock Salt', { apache: true }),

  // Monospace
  mono('JetBrains Mono'),
  mono('Fira Code'),
  mono('IBM Plex Mono'),
  mono('Roboto Mono'),
  mono('Space Mono'),
  mono('Source Code Pro'),
  mono('DM Mono', { weights: [400, 500] }),
  mono('Courier Prime'),
  mono('Inconsolata'),
];
