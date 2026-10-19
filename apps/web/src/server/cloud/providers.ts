/**
 * The cloud providers (SHR-7): `googleDrive` and `dropbox` implement `CloudProvider` over plain
 * `fetch` (no SDKs). They are factories taking credentials, so they stay free of environment
 * access; `config.ts` builds the configured instances.
 */
export * from './types';
export { DRIVE_SCOPE, googleDrive, type DriveConfig } from './drive';
export { DROPBOX_SCOPES, dropbox, type DropboxConfig } from './dropbox';
