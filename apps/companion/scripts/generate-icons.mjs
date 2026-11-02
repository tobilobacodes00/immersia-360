/**
 * Renders the companion's launcher icons and splash images from the PWA icon's mark, so the app and the
 * installed web app look the same. The mark (the aperture glyph on an ink tile, and its proportions) is read
 * from apps/web/src/lib/brand-icon.tsx, the one place the PWA icons are drawn; nothing is copied by hand.
 *
 *   node scripts/generate-icons.mjs
 *
 * The output is committed: this runs when the brand changes, not on every build.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandIconPath = join(root, '..', 'web', 'src', 'lib', 'brand-icon.tsx');
const androidRes = join(root, 'android', 'app', 'src', 'main', 'res');
const iosAssets = join(root, 'ios', 'App', 'App', 'Assets.xcassets');

const INK = '#111110';
const PAPER = '#f7f6f2';

/** The glyph's six paths, as brand-icon.tsx lists them. */
async function readAperturePaths() {
  const source = await readFile(brandIconPath, 'utf8');
  const list = /APERTURE_PATHS\s*=\s*\[([\s\S]*?)\]/.exec(source)?.[1];
  const paths = [...(list ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (paths.length !== 6) throw new Error(`Could not read the aperture paths from ${brandIconPath}`);
  return paths;
}

/** brand-icon.tsx sizes the glyph at 46% of a full-bleed (maskable) icon and 58% of a plain one. */
const MASKABLE_GLYPH = 0.46;
const PLAIN_GLYPH = 0.58;
/** ... and the plain icon's tile is 90% of the canvas with 20% rounded corners. */
const PLAIN_TILE = 0.9;
const PLAIN_RADIUS = 0.2;

function glyph(paths, canvas, ratio) {
  const size = canvas * ratio;
  const offset = (canvas - size) / 2;
  const strokes = paths.map((d) => `<path d="${d}"/>`).join('');
  return (
    `<g transform="translate(${offset} ${offset}) scale(${size / 24})" fill="none" stroke="#ffffff" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>${strokes}</g>`
  );
}

const svg = (canvas, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">${body}</svg>`,
  );

/** Full-bleed ink with the glyph: the iOS icon (iOS rounds it), as apple-icon.tsx does. */
const fullBleed = (paths, canvas) =>
  svg(canvas, `<rect width="${canvas}" height="${canvas}" fill="${INK}"/>${glyph(paths, canvas, MASKABLE_GLYPH)}`);

/** The rounded ink tile on a transparent canvas: the pre-Android-8 launcher icon. */
const plainTile = (paths, canvas) => {
  const tile = canvas * PLAIN_TILE;
  const margin = (canvas - tile) / 2;
  return svg(
    canvas,
    `<rect x="${margin}" y="${margin}" width="${tile}" height="${tile}" rx="${canvas * PLAIN_RADIUS}" fill="${INK}"/>` +
      glyph(paths, canvas, PLAIN_GLYPH),
  );
};

/** A circle of ink: the round launcher icon. */
const roundTile = (paths, canvas) =>
  svg(
    canvas,
    `<circle cx="${canvas / 2}" cy="${canvas / 2}" r="${canvas / 2}" fill="${INK}"/>${glyph(paths, canvas, MASKABLE_GLYPH)}`,
  );

/** The glyph alone: Android's adaptive icon draws it over its own ink background, inside the safe zone. */
const foreground = (paths, canvas) => svg(canvas, glyph(paths, canvas, MASKABLE_GLYPH));

/** Paper with the plain tile in the middle, at whatever size the template's image has. */
function splash(paths, width, height) {
  const edge = Math.min(width, height) * 0.2;
  const left = (width - edge) / 2;
  const top = (height - edge) / 2;
  const mark = glyph(paths, edge, PLAIN_GLYPH);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="${PAPER}"/>` +
      `<g transform="translate(${left} ${top})"><rect width="${edge}" height="${edge}" rx="${edge * PLAIN_RADIUS}" fill="${INK}"/>${mark}</g>` +
      `</svg>`,
  );
}

const png = (input) => sharp(input).png({ compressionLevel: 9 });

async function main() {
  const paths = await readAperturePaths();

  if (existsSync(androidRes)) {
    const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [density, scale] of Object.entries(densities)) {
      const dir = join(androidRes, `mipmap-${density}`);
      const launcher = Math.round(48 * scale);
      const adaptive = Math.round(108 * scale);
      await png(plainTile(paths, launcher)).toFile(join(dir, 'ic_launcher.png'));
      await png(roundTile(paths, launcher)).toFile(join(dir, 'ic_launcher_round.png'));
      await png(foreground(paths, adaptive)).toFile(join(dir, 'ic_launcher_foreground.png'));
    }
    // The template's vector foreground is the Capacitor logo; the adaptive icon uses the mipmaps above.
    await rm(join(androidRes, 'drawable-v24', 'ic_launcher_foreground.xml'), { force: true });

    // Splash images keep the size the template gave them.
    for (const entry of await readdir(androidRes, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('drawable')) continue;
      const file = join(androidRes, entry.name, 'splash.png');
      if (!existsSync(file)) continue;
      const { width, height } = await sharp(file).metadata();
      await png(splash(paths, width, height)).toFile(file);
    }
  }

  if (existsSync(iosAssets)) {
    await png(fullBleed(paths, 1024))
      .flatten({ background: INK })
      .toFile(join(iosAssets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
    const splashDir = join(iosAssets, 'Splash.imageset');
    for (const name of await readdir(splashDir)) {
      if (!name.endsWith('.png')) continue;
      const file = join(splashDir, name);
      const { width, height } = await sharp(file).metadata();
      await png(splash(paths, width, height)).toFile(file);
    }
  }
}

await main();
