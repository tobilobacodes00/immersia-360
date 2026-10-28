/** JSON column types. The zod schemas in @immersia/shared are the source of truth. */
export type {
  BrandingSettings,
  DeviceCapabilities,
  DisplaySettings,
  OutputSettings,
  ShareSettings,
} from '@immersia/shared/event';
export type { DeviceStatus } from '@immersia/shared/device';
export type { TemplateCanvas, TemplateElement } from '@immersia/shared/template';

/** Everything the server render worker needs to reproduce a local render (the zod schema is the source of truth). */
export type { RenderRecipe } from '@immersia/shared/render';
