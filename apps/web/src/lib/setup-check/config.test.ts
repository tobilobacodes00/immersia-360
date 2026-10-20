import { describe, expect, it } from 'vitest';
import { defaultOutputSettings, outputSettingsSchema } from '@immersia/shared';
import { planCheck } from './config';

describe('setup check plan', () => {
  it("the 360 booth is checked with the event's own camera request and render preset", () => {
    const output = outputSettingsSchema.parse({
      video360: { resolution: '2160p', fps: 30, aspect: '1:1', microphone: true, quality: 'original' },
    });
    const plan = planCheck('video360', output);
    expect(plan.camera).toEqual({ resolution: '2160p', frameRate: 30, audio: true });
    expect(plan.render).toBe(output.video360);
    expect(plan.print).toBeNull();
  });

  it('the photo booth asks for what PhotoBooth asks for, and renders the standard preset', () => {
    const plan = planCheck('photo', defaultOutputSettings());
    expect(plan.camera).toEqual({ resolution: '1080p', frameRate: 30, audio: false });
    expect(plan.render).toMatchObject({ resolution: '1080p', fps: 30, aspect: '9:16', effects: [] });
  });

  it('the photo booth prints two strips on one sheet only for a 2×6 layout with that option on', () => {
    const photo = (printSize: string, doubleStrip: boolean) =>
      planCheck(
        'photo',
        outputSettingsSchema.parse({
          photo: { printSize, print: { enabled: true, autoPrint: false, copies: 1, maxGuestCopies: 2, doubleStrip } },
        }),
      ).print;
    expect(photo('2x6', true)).toEqual({ size: '2x6', twoUp: true, enabled: true });
    expect(photo('2x6', false)?.twoUp).toBe(false);
    expect(photo('4x6', true)?.twoUp).toBe(false);
  });
});
