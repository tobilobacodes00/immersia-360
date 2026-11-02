import type { CapacitorConfig } from '@capacitor/cli';
import { buildConfig } from './src/config.ts';

/**
 * The companion loads the deployed booth, so there is no static export to bundle: the server comes from
 * COMPANION_SERVER_URL (see README.md). The logic lives in src/config.ts, where it is unit-tested.
 */
const config: CapacitorConfig = buildConfig(process.env);

export default config;
