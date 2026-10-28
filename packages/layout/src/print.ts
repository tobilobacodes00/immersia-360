/**
 * Browser printing at exact size (PHO-7, PHO-8). The print is an image at 300 DPI placed on a page
 * whose CSS `@page` size is the paper size, with no margins, so the printer driver gets exactly the
 * paper it expects. In Chrome started with `--kiosk-printing` the job goes straight to the default
 * printer with no dialog (auto-print); otherwise the system dialog opens with the size preset.
 *
 * Two-up: a 2×6 strip printed twice side by side on a 4×6 sheet, for printers that only take 4×6
 * paper (most dye-sub event printers); the operator or the printer's cutter splits it.
 */

export interface PrintJob {
  /** The rendered print (JPEG or PNG). */
  image: Blob;
  /** Paper size in inches of ONE print (e.g. 2 × 6). */
  widthIn: number;
  heightIn: number;
  copies?: number;
  /** Two 2×6 strips side by side on one 4×6 sheet. */
  twoUp?: boolean;
}

/** The page markup for a job (exported for tests: page size and placement are the contract). */
export function printDocument(src: string, job: PrintJob): string {
  const copies = Math.max(1, Math.min(10, Math.round(job.copies ?? 1)));
  const twoUp = Boolean(job.twoUp);
  const pageW = twoUp ? job.widthIn * 2 : job.widthIn;
  const pageH = job.heightIn;
  const one = `<img src="${src}" alt="" style="width:${job.widthIn}in;height:${job.heightIn}in">`;
  const page = `<div class="page">${twoUp ? one + one : one}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${pageW}in ${pageH}in; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
.page { width: ${pageW}in; height: ${pageH}in; display: flex; overflow: hidden; break-after: page }
.page:last-child { break-after: auto }
img { display: block; object-fit: fill }
</style></head><body>${Array.from({ length: copies }, () => page).join('')}</body></html>`;
}

/**
 * Print through a hidden iframe. Resolves once the print has been handed to the browser (with a
 * dialog, after the operator closes it).
 */
export function browserPrint(job: PrintJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(job.image);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const cleanup = () => {
      frame.remove();
      URL.revokeObjectURL(url);
    };
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      cleanup();
      return reject(new Error('Printing is unavailable here'));
    }
    doc.open();
    doc.write(printDocument(url, job));
    doc.close();
    const images = Array.from(doc.images);
    Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((done) => {
              img.onload = () => done();
              img.onerror = () => done();
            }),
      ),
    )
      .then(() => images[0]?.decode?.().catch(() => undefined))
      .then(() => {
        win.addEventListener('afterprint', () => setTimeout(cleanup, 500), { once: true });
        win.focus();
        win.print();
        resolve();
        // Some browsers never fire afterprint (or print() returns at once): clean up anyway.
        setTimeout(cleanup, 60_000);
      }, reject);
  });
}
