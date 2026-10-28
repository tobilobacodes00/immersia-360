import { describe, expect, it } from 'vitest';
import {
  SERVER_FILE_LIMITS,
  recipeAssetIds,
  renderRecipeSchema,
  renderPathRequestSchema,
  serverFilesRequestSchema,
  workerOutputsRequestSchema,
  type RenderRecipe,
} from '../src/render';

const ASSET = '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f01';
const OTHER = '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f02';

const recipe = (patch: Partial<RenderRecipe> = {}): RenderRecipe => ({
  version: 2,
  output: { width: 1080, height: 1920, fps: 30, bitrate: 6_000_000 },
  preset: 'balanced',
  slowMotion: { enabled: true, startS: 2, endS: 6, speed: 0.5 },
  reverse: 'none',
  look: { id: 'film', intensity: 1 },
  effects: [{ id: 'confetti', intensity: 0.8, colorMode: 'gold' }],
  beats: [0.5, 1, 1.5],
  seed: 421,
  music: {
    assetId: ASSET,
    trimStartMs: 0,
    trimEndMs: null,
    offsetMs: 0,
    fadeInMs: 500,
    fadeOutMs: 1000,
    volume: 0.9,
  },
  background: { kind: 'color', color: '#2b3fe6' },
  intro: { assetId: OTHER, kind: 'image', seconds: 2 },
  outro: null,
  endCard: { seconds: 2 },
  files: {
    original: { bytes: 12_000_000, mime: 'video/webm' },
    overlay: { bytes: 80_000, mime: 'image/png' },
    endCard: { bytes: 60_000, mime: 'image/png' },
  },
  derive: { poster: true, small: true },
  ...patch,
});

describe('render recipe (server render request)', () => {
  it('accepts what the booth builds from its own render job', () => {
    expect(renderRecipeSchema.safeParse(recipe()).success).toBe(true);
  });

  it('refuses unknown fields: a client can not smuggle an object key or a URL into a job', () => {
    const withKey = { ...recipe(), objectKey: 'o/other-org/e/x/y.mp4' };
    expect(renderRecipeSchema.safeParse(withKey).success).toBe(false);
    const nested = recipe({
      files: { ...recipe().files, original: { ...recipe().files.original, key: 'k' } as never },
    });
    expect(renderRecipeSchema.safeParse(nested).success).toBe(false);
  });

  it('refuses a recipe of another version, so an old booth and a new worker never guess', () => {
    expect(renderRecipeSchema.safeParse({ ...recipe(), version: 1 }).success).toBe(false);
  });

  it('keeps the end card and its file together', () => {
    expect(renderRecipeSchema.safeParse(recipe({ endCard: null })).success).toBe(false);
    expect(renderRecipeSchema.safeParse(recipe({ files: { ...recipe().files, endCard: null } })).success).toBe(false);
    expect(
      renderRecipeSchema.safeParse(recipe({ endCard: null, files: { ...recipe().files, endCard: null } })).success,
    ).toBe(true);
  });

  it('bounds every value that drives work or cost', () => {
    const bad = (patch: Partial<RenderRecipe>) => renderRecipeSchema.safeParse(recipe(patch)).success;
    expect(bad({ output: { width: 1080, height: 1920, fps: 120, bitrate: 6_000_000 } })).toBe(false);
    expect(bad({ output: { width: 100_000, height: 1920, fps: 30, bitrate: 6_000_000 } })).toBe(false);
    expect(bad({ output: { width: 1080, height: 1920, fps: 30, bitrate: 10 } })).toBe(false);
    expect(bad({ slowMotion: { enabled: true, startS: 0, endS: 3, speed: 0.01 } })).toBe(false);
    expect(bad({ beats: Array.from({ length: 4001 }, (_, i) => i) })).toBe(false);
    expect(bad({ effects: Array.from({ length: 9 }, () => ({ id: 'a', intensity: 1, colorMode: null })) })).toBe(false);
    expect(bad({ intro: { assetId: 'not-a-uuid', kind: 'image', seconds: 2 } })).toBe(false);
    expect(bad({ intro: { assetId: OTHER, kind: 'image', seconds: 60 } })).toBe(false);
  });

  it('limits the original by size and type', () => {
    const big = SERVER_FILE_LIMITS.original.maxBytes + 1;
    const files = (original: { bytes: number; mime: string }) =>
      recipe({ files: { ...recipe().files, original: original as never } });
    expect(renderRecipeSchema.safeParse(files({ bytes: big, mime: 'video/webm' })).success).toBe(false);
    expect(renderRecipeSchema.safeParse(files({ bytes: 1000, mime: 'application/zip' })).success).toBe(false);
    expect(renderRecipeSchema.safeParse(files({ bytes: 1000, mime: 'video/mp4' })).success).toBe(true);
  });

  it('lists the library assets a job needs, once each', () => {
    expect(recipeAssetIds(recipe())).toEqual([ASSET, OTHER]);
    expect(recipeAssetIds(recipe({ music: null, intro: null }))).toEqual([]);
    expect(recipeAssetIds(recipe({ outro: { assetId: OTHER, kind: 'video', seconds: 2 } }))).toEqual([ASSET, OTHER]);
  });

  it('counts a background picture or video as an asset, and a colour or blur as none', () => {
    const BG = '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f03';
    const only = { music: null, intro: null };
    expect(recipeAssetIds(recipe({ ...only, background: { kind: 'image', assetId: BG } }))).toEqual([BG]);
    expect(recipeAssetIds(recipe({ ...only, background: { kind: 'video', assetId: BG } }))).toEqual([BG]);
    expect(recipeAssetIds(recipe({ ...only, background: { kind: 'blur' } }))).toEqual([]);
    expect(recipeAssetIds(recipe({ ...only, background: null }))).toEqual([]);
  });

  it('validates the background', () => {
    const ok = (background: unknown) => renderRecipeSchema.safeParse({ ...recipe(), background }).success;
    expect(ok({ kind: 'color', color: '#00ff88' })).toBe(true);
    expect(ok({ kind: 'blur' })).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok({ kind: 'color', color: 'red' })).toBe(false);
    expect(ok({ kind: 'image', assetId: 'nope' })).toBe(false);
    expect(ok({ kind: 'blur', extra: 1 })).toBe(false);
    expect(ok({ kind: 'gif', assetId: ASSET })).toBe(false);
  });
});

describe('upload requests', () => {
  it('asks for each file once, within its limits', () => {
    const file = (role: string, bytes: number, mime: string) => ({ role, bytes, mime });
    const ok = serverFilesRequestSchema.safeParse({
      files: [file('original', 1000, 'video/webm'), file('overlay', 10, 'image/png')],
    });
    expect(ok.success).toBe(true);
    expect(
      serverFilesRequestSchema.safeParse({
        files: [file('original', 1000, 'video/webm'), file('original', 1000, 'video/webm')],
      }).success,
    ).toBe(false);
    expect(serverFilesRequestSchema.safeParse({ files: [file('overlay', 10, 'video/mp4')] }).success).toBe(false);
    expect(serverFilesRequestSchema.safeParse({ files: [file('whatever', 10, 'image/png')] }).success).toBe(false);
    expect(serverFilesRequestSchema.safeParse({ files: [] }).success).toBe(false);
  });
});

describe('worker contracts', () => {
  const token = 'a'.repeat(32);
  it('takes each output kind once and bounds its size', () => {
    const out = (kind: string, bytes = 1000) => ({ kind, bytes, width: 720, height: 1280, durationMs: 4000 });
    expect(
      workerOutputsRequestSchema.safeParse({ claimToken: token, outputs: [out('mp4'), out('poster')] }).success,
    ).toBe(true);
    expect(workerOutputsRequestSchema.safeParse({ claimToken: token, outputs: [out('mp4'), out('mp4')] }).success).toBe(
      false,
    );
    expect(workerOutputsRequestSchema.safeParse({ claimToken: token, outputs: [out('gif')] }).success).toBe(false);
    expect(workerOutputsRequestSchema.safeParse({ claimToken: 'short', outputs: [out('mp4')] }).success).toBe(false);
  });
});

describe('the rung a booth reports', () => {
  it('is one of the three rungs of the ladder', () => {
    for (const path of ['local', 'wasm', 'server'])
      expect(renderPathRequestSchema.safeParse({ path }).success).toBe(true);
    expect(renderPathRequestSchema.safeParse({ path: 'cloud' }).success).toBe(false);
    expect(renderPathRequestSchema.safeParse({}).success).toBe(false);
    expect(renderPathRequestSchema.safeParse({ path: 'wasm', extra: 1 }).success).toBe(false);
  });
});
