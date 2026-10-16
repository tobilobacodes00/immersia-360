/**
 * QR codes as inline SVG (uqr). Server-safe: the share page, signage and Live Display render codes
 * without shipping a QR library to the client. Error correction M survives a printed strip being
 * handled; quiet zone of 1 module plus the card's own padding keeps scanners happy.
 */
import { renderSVG } from 'uqr';
import { cx } from './cx';

export function qrSvg(value: string, { dark = '#111110', light = '#ffffff' } = {}): string {
  return renderSVG(value, { ecc: 'M', border: 1, blackColor: dark, whiteColor: light });
}

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cx('aspect-square w-full [&>svg]:block [&>svg]:size-full', className)}
      // uqr output is generated from our own string; it contains no user-controlled markup.
      dangerouslySetInnerHTML={{ __html: qrSvg(value) }}
    />
  );
}
