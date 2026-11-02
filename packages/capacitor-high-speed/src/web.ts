import { WebPlugin } from '@capacitor/core';
import type {
  HighSpeedCapabilities,
  HighSpeedPermissionStatus,
  HighSpeedPlugin,
  PreviewInfo,
  RecordingFile,
  RecordingResult,
} from './definitions';

const MESSAGE = 'High-speed capture needs the Immersia companion app; browsers cannot record 120 to 240 fps.';

/**
 * The web side of the plugin: there is no high-speed recorder in a browser, so it reports that and
 * every call that would need one is rejected with `UNAVAILABLE`. The booth never reaches it (it only
 * loads the plugin inside the companion), but a page that does gets a clear answer instead of a hang.
 */
export class HighSpeedWeb extends WebPlugin implements HighSpeedPlugin {
  async capabilities(): Promise<HighSpeedCapabilities> {
    return { available: false, platform: 'web', mime: '', codecs: [], motionSampling: false, lenses: [] };
  }

  async checkPermissions(): Promise<HighSpeedPermissionStatus> {
    return { camera: 'prompt', microphone: 'prompt' };
  }

  async requestPermissions(): Promise<HighSpeedPermissionStatus> {
    throw this.unavailable(MESSAGE);
  }

  async startPreview(): Promise<PreviewInfo> {
    throw this.unavailable(MESSAGE);
  }

  async setMirrored(): Promise<void> {
    throw this.unavailable(MESSAGE);
  }

  async stopPreview(): Promise<void> {
    // Nothing runs on the web, so there is nothing to close.
  }

  async startMotionSampling(): Promise<void> {
    throw this.unavailable(MESSAGE);
  }

  async stopMotionSampling(): Promise<void> {
    // Nothing runs on the web.
  }

  async startRecording(): Promise<{ id: string }> {
    throw this.unavailable(MESSAGE);
  }

  async stopRecording(): Promise<RecordingResult> {
    throw this.unavailable(MESSAGE);
  }

  async deleteRecording(): Promise<void> {
    // Nothing is stored on the web.
  }

  async listRecordings(): Promise<{ recordings: RecordingFile[] }> {
    return { recordings: [] };
  }
}
