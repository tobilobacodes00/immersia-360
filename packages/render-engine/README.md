# @immersia/render-engine

The render engine behind every video Immersia 360 makes: Mediabunny demux → WebCodecs decode → timeline
(slow motion, reverse, optical-flow interpolation) → WebGL2 compositor (look, effects, overlay, cards) →
H.264 encode → MP4. It is pure TypeScript and WebGL2, so the same code runs in the booth's render worker,
in the editor's preview, and in the server render worker's headless Chrome.

## The path ladder

A booth does not always have an encoder, and a render must never be the reason a guest has no video.
Each device walks a ladder:

| rung     | where it runs                          | what encodes the H.264            |
| -------- | -------------------------------------- | --------------------------------- |
| `local`  | the booth device                       | the browser's WebCodecs encoder   |
| `wasm`   | the booth device                       | a WebAssembly encoder (see below) |
| `server` | `apps/render-worker` (headless Chrome) | Chrome's encoder on the server    |

Decoding and compositing are identical on every rung: the same `render()` and the same shaders. Only the
encoder (or the machine) changes, which is why server and local renders match.

`src/ladder.ts` holds the decisions as pure functions, tested in Node (`test/ladder.test.ts`):

- `availableRungs` — what a device can attempt, from its registered capabilities.
- `fallsBack(code)` — which `RenderError` codes move a take to the next rung: `unsupported_encoder`,
  `encoder_stall`, `gpu`, `undecodable`. A cancel and an unexplained `failed` never do (the first is the
  operator's choice, the second is not worth the server's cost).
- `nextRung` — the next rung after a failure. `wasm` is skipped unless the encoder was the problem (it
  replaces only the encoder, so it cannot help a device that cannot decode or composite).
- `recordFailure` / `startRung` — the rung memory. A rung that failed for a device-level reason
  (`unsupported_encoder`, `gpu`: 7 days; `encoder_stall`: 6 hours) is skipped by later takes until the
  skip runs out; a take that cannot be decoded says nothing about the rung. Starting always from the top
  lets a device recover its fast path.

The booth (`apps/web/src/app/booth/[eventId]/ladder-run.ts`, `use-render-queue.ts`) stores the memory in
its own database and reports the rung that worked to the server (it ends up in the device's
`capabilities.renderPath`, shown on the Devices screen). A take on the `server` rung stays on the device
as `server` while the worker renders it; the booth asks the server about it every few seconds, and the
guest's page shows "Your files are on their way" until the outputs land, as for any other rung.

The `server` rung does not run this engine on a server by magic: `apps/render-worker` loads the same
`render()` in headless Chrome and feeds it the job the booth would have built, from a recipe
(`@immersia/shared` `renderRecipeSchema`). See that app's README.

`render(job, { encoder: 'wasm' })` selects the WASM encoder; `'native'` is the default. A browser with no
H.264 encoder fails fast with `unsupported_encoder` (a `canEncodeVideo` check before any work is done),
and an encoder that dies mid-render is classified the same way.

## The `wasm` rung: encoder and licence decision

**Choice: [`h264-mp4-encoder`](https://www.npmjs.com/package/h264-mp4-encoder) 1.0.12** (published
2020-08-19, pinned in the pnpm catalog), used only as the H.264 encoder.

| piece                    | licence                             | notes                                                      |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------- |
| `h264-mp4-encoder` glue  | MIT                                 | npm `license` field and `LICENSE.md`                       |
| minih264 (the encoder)   | CC0 1.0 (public domain)             | github.com/lieff/minih264; single-header, baseline profile |
| libmp4v2 (its MP4 muxer) | MPL 1.1 (file-level, weak copyleft) | per the package README; compiled into the bundle           |

Why this one:

- **Licence.** Nothing GPL. The repository keeps no copy of the encoder (it is an npm dependency), so
  the public repository's own licence is unaffected; the built bundle carries MPL 1.1 code (libmp4v2),
  whose source is the upstream project's, unmodified by us.
- **No OpenH264 build exists on npm.** We looked (`openh264`, `openh264-wasm`, libav.js's `h264-aac`
  variant, `@mediabunny/*`). libav.js's H.264 variant (libopenh264) is not published; `@mediabunny/server`
  is for Node. Compiling OpenH264 to WASM ourselves would need an Emscripten toolchain and CI time for
  one fallback; a BSD-2 source is also no patent licence (Cisco's patent grant covers only the binaries
  Cisco builds and distributes), so it would not have been cleaner than minih264 on that front.
- **Not ffmpeg.wasm.** `@ffmpeg/core` bundles x264 and is GPL-2.0-or-later (npm says so; the older `@ffmpeg/core-st`
  is labelled MIT on npm, but the ffmpeg.wasm cores bundle x264 all the same). A GPL encoder in a browser bundle would make the
  distributed app a GPL derivative. It is deliberately **not** included and there is no flag for it. The
  encoder sits behind Mediabunny's `CustomVideoEncoder`, so a deployment that accepts the GPL could register
  its own encoder the same way; that is an explicit decision for that deployment, not a switch here.
- **Size.** `h264-encoder.js` is 1.7 MB (about 490 KB gzip, 320 KB brotli) with the WebAssembly inline.
  It is loaded lazily, only by a device that reaches the `wasm` rung, in a Worker of its own, from the
  app's own origin (`/workers/h264-encoder.js`, built by `scripts/h264-worker.mjs`). Nothing is fetched
  from a CDN at runtime. Single-threaded: it needs no `SharedArrayBuffer`, so no COOP/COEP on booth routes.
- **Speed and quality.** minih264 is a deliberately small baseline-profile encoder (no B-frames, no CABAC).
  Its author measures it near x264 `veryfast` baseline at the same quantizer, with outputs about 20% larger
  at equal quality. The booth steers the quantizer from the written size (`nextQp` in `src/wasm/avc.ts`) to
  land near the preset's bitrate, since the library's own rate control is too coarse to trust. Frame
  throughput was not benchmarked here; the browser test in CI exercises the path end to end, and the M3
  benchmark on real devices is the place to put a number on it.

**Patents.** H.264 is a patent-encumbered format, and that is true of every encoder, whatever its source
licence. The WASM rung exists for browsers that ship without an H.264 encoder; deployments that distribute
the app commercially should take their own advice on H.264 patent licensing.

How the pieces fit (`src/wasm/`):

- `wasm-h264.ts` — a Mediabunny `CustomVideoEncoder`. It claims AVC only while a WASM render is running
  (`withVideoEncoder`), so the browser's own encoder is untouched otherwise. Frames reach it from the same
  `CanvasSource` the other rungs use.
- `avc.ts` — RGBA → I420 (BT.709, limited range, tagged as such), the quantizer controller, key-frame
  detection from the bitstream (the library marks every sample as a sync sample), and the level fix (the
  library stamps a low H.264 level whatever the picture size; the decoder configuration is raised to what
  the size and frame rate need).
- `h264-glue.js` — the encoder worker's side of a small request/ack protocol. `scripts/h264-worker.mjs`
  concatenates the library's web bundle and the glue into the one classic worker script that is served.

## Tests

- `test/*.test.ts` run in Node: timeline, beats, presets, audio, and the ladder and the WASM encoder's
  pure parts (`ladder.test.ts`, `avc.test.ts`).
- `test-browser/*.browser.test.ts` run in real Chrome (`channel: 'chrome'`, SwiftShader for WebGL): golden
  renders, and `wasm-encoder.browser.test.ts` — the same render through the WASM encoder, judged by what
  the browser's decoder makes of it.

Tests run on CI.
