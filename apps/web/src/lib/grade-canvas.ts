import { GradePreview } from '@immersia/render-engine/preview';

export interface MountedPreview {
  preview: GradePreview;
  /** Remove the canvas and hand its WebGL context back; nothing is drawn on it afterwards. */
  destroy: () => void;
}

/**
 * A GradePreview on a canvas of its own, inside `host` (an element whose children React does not
 * manage). A canvas keeps its WebGL context for life, so every preview gets a fresh canvas and the old
 * one is thrown away with its context: reusing one after its context was released leaves it unable to
 * draw (and covering the picture with a blank surface). Returns null where WebGL2 is not available.
 *
 * The canvas fills the host and covers it the way `object-fit: cover` does, so the host carries the size,
 * the mirror and the opacity.
 */
export function mountPreview(host: HTMLElement, width: number, height: number): MountedPreview | null {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover';
  let preview: GradePreview;
  try {
    preview = new GradePreview(canvas, width, height);
  } catch {
    return null;
  }
  host.append(canvas);
  return {
    preview,
    destroy: () => {
      preview.release();
      canvas.remove();
    },
  };
}
