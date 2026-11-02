import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { JOB_FILES } from './files';

/**
 * The tiny same-origin server Chrome talks to: the render page and its assets, the job's downloaded
 * files, and a place to PUT the results. Same-origin keeps the page free of CORS (the bucket's rules
 * are the booths' business), and keeps a 100 MB video off the DevTools protocol.
 *
 * It listens on 127.0.0.1 only, and every path starts with a random per-process token, so another
 * process on the machine can not read a guest's recording or plant a result.
 */

export const OUTPUT_FILES = ['mp4', 'small_mp4', 'poster'] as const;
export type OutputFileName = (typeof OUTPUT_FILES)[number];

/** Where a result lands in the job directory. */
export const outputPath = (dir: string, kind: OutputFileName) => join(dir, `out-${kind}`);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.tflite': 'application/octet-stream',
  '.map': 'application/json',
};

export interface FileServer {
  /** `http://127.0.0.1:port/token` */
  base: string;
  /** Serve the job routes from this directory (null: none). One job at a time. */
  setJobDir(dir: string | null): void;
  close(): Promise<void>;
}

const MAX_PUT_BYTES = 2 * 1024 ** 3;

export async function startFileServer(roots: Record<string, string>): Promise<FileServer> {
  const token = randomBytes(18).toString('base64url');
  let jobDir: string | null = null;

  const send = (res: http.ServerResponse, status: number, body = '') => {
    res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(body);
  };

  async function serveFile(res: http.ServerResponse, path: string) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(path)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== token) return send(res, 404, 'not found');
      const [, area, ...rest] = parts;

      if (req.method === 'GET' && area === 'job') {
        const name = rest[0];
        if (!jobDir || rest.length !== 1 || !(JOB_FILES as readonly string[]).includes(name ?? ''))
          return send(res, 404, 'not found');
        return serveFile(res, join(jobDir, name!));
      }
      if (req.method === 'PUT' && area === 'out') {
        const kind = rest[0];
        if (!jobDir || rest.length !== 1 || !(OUTPUT_FILES as readonly string[]).includes(kind ?? ''))
          return send(res, 404, 'not found');
        if (Number(req.headers['content-length'] ?? 0) > MAX_PUT_BYTES) return send(res, 413, 'too large');
        await pipeline(req, createWriteStream(outputPath(jobDir, kind as OutputFileName)));
        return send(res, 204);
      }
      if (req.method === 'GET' && area && Object.hasOwn(roots, area)) {
        const root = resolve(roots[area]!);
        const target = resolve(root, ...(rest.length ? rest : ['index.html']));
        // Nothing outside the root, however the path is spelled.
        if (target !== root && !target.startsWith(root + sep)) return send(res, 404, 'not found');
        return serveFile(res, target);
      }
      return send(res, 404, 'not found');
    })().catch(() => {
      if (!res.headersSent) send(res, 500, 'error');
      else res.destroy();
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/${token}`,
    setJobDir: (dir) => {
      jobDir = dir;
    },
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}
