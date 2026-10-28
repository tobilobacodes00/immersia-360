import { renderRecipeSchema } from '@immersia/shared/render';
import type { RunOutput } from './protocol';
import { PageError, codeOf, renderFromRecipe } from './render-page';

/**
 * The production entry of the render page. The worker (Node) has already downloaded the job's files and
 * serves them, same-origin, from its own local file server; this page fetches them, renders, and PUTs the
 * results back the same way. Nothing here talks to the internet, and the finished video never travels
 * over the DevTools protocol (a 100 MB base64 string), only a small summary does.
 */

async function fetchBlob(url: string | undefined): Promise<Blob | null> {
  if (!url) return null;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new PageError('download_failed', `GET ${url}: ${res.status}`);
  return res.blob();
}

async function put(url: string, blob: Blob) {
  const res = await fetch(url, { method: 'PUT', body: blob });
  if (!res.ok) throw new PageError('upload_failed', `PUT ${url}: ${res.status}`);
}

window.__run = async (spec) => {
  try {
    const recipe = renderRecipeSchema.safeParse(spec.recipe);
    if (!recipe.success) throw new PageError('invalid_recipe', 'The recipe does not validate');
    const original = await fetchBlob(spec.files.original);
    if (!original) throw new PageError('source_missing', 'The recording is gone');
    const [overlay, endCard, intro, outro, music, background] = await Promise.all([
      fetchBlob(spec.files.overlay),
      fetchBlob(spec.files.endCard),
      fetchBlob(spec.files.intro),
      fetchBlob(spec.files.outro),
      fetchBlob(spec.files.music),
      fetchBlob(spec.files.background),
    ]);
    const done = await renderFromRecipe(
      recipe.data,
      { original, overlay, endCard, intro, outro, music, background },
      { mediapipeBase: spec.mediapipeBase, onProgress: (p) => void window.__progress?.(p) },
    );
    const outputs: RunOutput[] = [
      { kind: 'mp4', bytes: done.mp4.size, width: done.width, height: done.height, durationMs: done.durationMs },
    ];
    await put(spec.put.mp4, done.mp4);
    if (done.small) {
      await put(spec.put.small, done.small);
      outputs.push({
        kind: 'small_mp4',
        bytes: done.small.size,
        width: done.smallWidth,
        height: done.smallHeight,
        durationMs: done.durationMs,
      });
    }
    if (done.poster) {
      await put(spec.put.poster, done.poster);
      outputs.push({ kind: 'poster', bytes: done.poster.size, width: done.width, height: done.height, durationMs: 0 });
    }
    return {
      ok: true,
      outputs,
      renderMs: done.renderMs,
      frames: done.frames,
      encoder: done.encoder,
      background: done.background,
    };
  } catch (err) {
    return { ok: false, code: codeOf(err), message: err instanceof Error ? err.message : String(err) };
  }
};
