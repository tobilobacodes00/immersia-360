import type { DownloadRoute } from './routes';
import type { OutputKind } from './session';

/**
 * First-party analytics events (PRD "Tracked events"). The union is the contract between the
 * clients that emit and the API that stores; adding an event means adding it here first.
 */
export type CaptureTrigger = 'tap' | 'timer' | 'motion' | 'remote' | 'keyboard';
export type RenderPath = 'local' | 'wasm' | 'server';
export type UploadTarget = 'hosted' | 'drive' | 'dropbox';

export type AnalyticsEvent =
  | { name: 'event_created'; mode: 'video360' | 'photo'; from_duplicate: boolean }
  | { name: 'setup_check_completed'; render_speed_ms: number; camera_fps: number; browser: string }
  | {
      name: 'take_recorded';
      mode: 'video360' | 'photo';
      duration_s: number;
      fps: number;
      resolution: string;
      trigger: CaptureTrigger;
    }
  | { name: 'render_completed'; render_ms: number; path: RenderPath; preset: string; effects_count: number }
  | { name: 'render_failed'; error_code: string; path: RenderPath; browser: string }
  | { name: 'qr_shown'; seconds_since_take: number }
  | { name: 'share_page_viewed'; output_kind: OutputKind | 'session'; route: DownloadRoute }
  /** SHR-5, DL-7: the event gallery, by how guests reached it (event QR, display, NFC…). */
  | { name: 'gallery_viewed'; route: DownloadRoute }
  | { name: 'file_downloaded'; output_kind: OutputKind; bytes: number }
  | { name: 'print_sent'; size: string; copies: number; double_strip: boolean }
  | { name: 'upload_completed'; target: UploadTarget; bytes: number; retries: number }
  | { name: 'device_registered'; platform: string; browser: string }
  | { name: 'display_paired'; layout: string; screen_size: string }
  | { name: 'item_displayed'; seconds_on_screen: number }
  | { name: 'display_qr_scanned'; layout: string }
  /** SHR-6: counts only, never the guest's details. */
  | { name: 'guest_form_submitted'; scope: 'session' | 'gallery' }
  | { name: 'guest_form_skipped'; scope: 'session' | 'gallery' }
  /** Privacy: a session was erased, by the guest holding its link or by an operator on their request. */
  | { name: 'guest_data_erased'; by: 'guest' | 'operator' };

export type AnalyticsEventName = AnalyticsEvent['name'];
