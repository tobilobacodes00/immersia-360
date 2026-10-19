# Font licences

| Font                                 | Files                                                    | Source                            | Licence                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satoshi (variable, upright + italic) | `Satoshi-Variable.woff2`, `Satoshi-VariableItalic.woff2` | Indian Type Foundry via Fontshare | ITF Free Font License (FFL): free for personal and commercial use, including web embedding; the font files may not be sold or redistributed on their own. |

The Satoshi files are therefore **not in this repository**. `apps/web/scripts/fetch-fonts.mjs` downloads them from
Fontshare before `dev` and `build` (they are gitignored), and the built site self-hosts them as web fonts, which the
licence allows.

Instrument Serif is loaded through `next/font/google` (SIL OFL 1.1), self-hosted at build time.

## PHO-9 font library

The font library offered in the layout editor and drawn by the booth (130+ families: sans, serif, display, handwriting,
mono) contains only families that Google Fonts publishes under the **SIL Open Font License 1.1** or the **Apache
License 2.0**; the licence of each family is recorded in `packages/fonts/src/catalogue.ts`. Both licences allow
embedding and redistributing the fonts as web fonts, commercially included. We serve the unmodified files Google
serves, so the OFL Reserved Font Names are not touched, and the fonts are never sold on their own.

The font files are **not in this repository**. `apps/web/scripts/fetch-font-library.mjs` downloads them from Google's
static host (`fonts.gstatic.com`) before `dev` and `build`, from the exact URLs pinned in
`packages/fonts/src/library.json` together with each file's sha256, and refuses anything that does not match. They land
in `apps/web/public/fonts/lib/` (gitignored) and are served from our own origin, so no request goes to Google at runtime.
Each family's copyright line, read from the font file itself, is stored in `library.json`. The manifest is regenerated
with `pnpm --filter @immersia/fonts generate`, which also fails if a font's embedded licence contradicts the catalogue.
