import { ImageResponse } from 'next/og';

const APERTURE_PATHS = [
  'm14.31 8 5.74 9.94',
  'M9.69 8h11.48',
  'm7.38 12 5.74-9.94',
  'M9.69 16 3.95 6.06',
  'M14.31 16H2.83',
  'm16.62 12-5.74 9.94',
];

/**
 * The Immersia mark (lucide aperture on an ink tile, as in Immersia Booth) as a PNG.
 * `maskable` fills the whole square and keeps the glyph inside the 80% safe zone.
 */
export function brandIcon(size: number, { maskable = false } = {}) {
  const glyph = Math.round(size * (maskable ? 0.46 : 0.58));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: maskable ? '#111110' : 'transparent',
      }}
    >
      <div
        style={{
          width: maskable ? size : Math.round(size * 0.9),
          height: maskable ? size : Math.round(size * 0.9),
          borderRadius: maskable ? 0 : Math.round(size * 0.2),
          background: '#111110',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          {APERTURE_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    </div>,
    { width: size, height: size },
  );
}
