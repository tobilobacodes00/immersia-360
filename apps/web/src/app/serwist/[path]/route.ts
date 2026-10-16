import { createSerwistRoute } from '@serwist/turbopack';

// Revision for precached pages that are not content-hashed: the deployed commit, so every deploy
// refreshes them and a reload of the same build never does.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'dev';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'src/app/sw.ts',
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: '/~offline', revision }],
});
