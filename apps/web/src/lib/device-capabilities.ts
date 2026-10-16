import type { DeviceCapabilities } from '@immersia/shared';

async function supports(probe: () => Promise<{ supported?: boolean }> | undefined): Promise<boolean> {
  try {
    const r = await probe();
    return Boolean(r?.supported);
  } catch {
    return false;
  }
}

/**
 * Quick capability probe at device registration. It seeds the render path; the setup check (M3)
 * replaces it with a measured benchmark. Never throws: every probe degrades to `false`.
 */
export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasAudioEncoder = typeof AudioEncoder !== 'undefined';
  const hasVideoDecoder = typeof VideoDecoder !== 'undefined';
  const [h264Encode, aacEncode, hevcDecode] = await Promise.all([
    supports(() =>
      hasVideoEncoder
        ? VideoEncoder.isConfigSupported({
            codec: 'avc1.640028',
            width: 1920,
            height: 1080,
            bitrate: 8_000_000,
            framerate: 30,
          })
        : undefined,
    ),
    supports(() =>
      hasAudioEncoder
        ? AudioEncoder.isConfigSupported({
            codec: 'mp4a.40.2',
            sampleRate: 48_000,
            numberOfChannels: 2,
            bitrate: 128_000,
          })
        : undefined,
    ),
    supports(() => (hasVideoDecoder ? VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L123.B0' }) : undefined)),
  ]);
  const webgl2 = (() => {
    try {
      return Boolean(document.createElement('canvas').getContext('webgl2'));
    } catch {
      return false;
    }
  })();
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const opfs = await (async () => {
    try {
      return typeof navigator.storage?.getDirectory === 'function' && Boolean(await navigator.storage.getDirectory());
    } catch {
      return false;
    }
  })();
  const renderPath: DeviceCapabilities['renderPath'] =
    h264Encode && webgl2 ? 'local' : webgl2 && typeof WebAssembly !== 'undefined' ? 'wasm' : 'server';
  return {
    webcodecs: { h264Encode, aacEncode, hevcDecode },
    webgl2,
    webgpu,
    opfs,
    maxCameraResolution: null,
    maxCameraFps: null,
    renderPath,
    renderSpeedMs: null,
    checkedAt: new Date().toISOString(),
  };
}
