import { describe, expect, it } from 'vitest';
import { checkKioskPin, kioskPinHash, sameDigest } from '../src/kiosk';

describe('kiosk PIN (KIO-1)', () => {
  it('checks a PIN against its stored hash', async () => {
    const hash = await kioskPinHash('evt-1', '2468');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await checkKioskPin('evt-1', '2468', hash)).toBe(true);
    expect(await checkKioskPin('evt-1', '2469', hash)).toBe(false);
  });

  it('salts by event, so one PIN hashes differently per event', async () => {
    expect(await kioskPinHash('evt-1', '2468')).not.toBe(await kioskPinHash('evt-2', '2468'));
  });

  it('rejects malformed PINs before hashing', async () => {
    const hash = await kioskPinHash('evt-1', '12');
    expect(await checkKioskPin('evt-1', '12', hash)).toBe(false); // too short to be a valid PIN
    expect(await checkKioskPin('evt-1', '12a4', await kioskPinHash('evt-1', '12a4'))).toBe(false);
  });

  it('compares digests in constant time', () => {
    expect(sameDigest('abcd', 'abcd')).toBe(true);
    expect(sameDigest('abcd', 'abce')).toBe(false);
    expect(sameDigest('abcd', 'abc')).toBe(false);
  });
});
