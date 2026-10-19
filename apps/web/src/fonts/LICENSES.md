# Font licences

| Font                                 | Files                                                    | Source                            | Licence                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satoshi (variable, upright + italic) | `Satoshi-Variable.woff2`, `Satoshi-VariableItalic.woff2` | Indian Type Foundry via Fontshare | ITF Free Font License (FFL): free for personal and commercial use, including web embedding; the font files may not be sold or redistributed on their own. |

The Satoshi files are therefore **not in this repository**. `apps/web/scripts/fetch-fonts.mjs` downloads them from
Fontshare before `dev` and `build` (they are gitignored), and the built site self-hosts them as web fonts, which the
licence allows.

Instrument Serif and the PHO-9 font library are loaded through `next/font/google` (SIL OFL 1.1), self-hosted at build
time.
