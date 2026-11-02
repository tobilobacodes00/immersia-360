# Third-party licences (assets fetched at build time)

Fonts have their own record in [`fonts/LICENSES.md`](fonts/LICENSES.md). This file covers the machine-learning assets
behind background replacement (CAP-10).

| Asset                                          | Files                                                                                                              | Source                                                                | Licence                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| MediaPipe selfie segmentation model (float16)  | `selfie_segmenter.tflite` (249,537 bytes, 256×256 input)                                                           | Google, `storage.googleapis.com/mediapipe-models/image_segmenter/...` | Apache License, Version 2.0 (see the model card) |
| MediaPipe Tasks Vision WebAssembly runtime     | `vision_wasm_internal.{js,wasm}`, `vision_wasm_nosimd_internal.{js,wasm}`, `vision_wasm_module_internal.{js,wasm}` | the `@mediapipe/tasks-vision` npm package, version 1.0.1              | Apache License, Version 2.0                      |
| `@mediapipe/tasks-vision` (JavaScript library) | bundled into the app                                                                                               | npm, pinned in `pnpm-workspace.yaml`                                  | Apache License, Version 2.0                      |

Apache-2.0 allows commercial use, modification and redistribution provided the licence text and notices are kept. We
use the model and the runtime unmodified.

## How they get into the app

Neither the model nor the WebAssembly runtime is committed to this repository.

- `apps/web/scripts/fetch-segmentation.mjs` runs before `dev` and `build`. It copies the six runtime files from the
  installed `@mediapipe/tasks-vision` package into `apps/web/public/mediapipe/`, and downloads the model from the pinned
  URL, refusing anything whose size and sha256 differ from the values recorded in the script. The model is cached by
  hash in `.next/cache/mediapipe`.
- `apps/web/public/mediapipe/` is gitignored. The built site serves the files from its own origin, and the service
  worker keeps them (a CacheFirst rule for `/mediapipe/`), so segmentation works offline.

## Where the licence texts are

- Model card (states "Licensed under Apache License, Version 2.0"):
  <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf>
- Licence text: <https://www.apache.org/licenses/LICENSE-2.0>
- Package and runtime: the `LICENSE` field of `@mediapipe/tasks-vision` (`Apache-2.0`).

## Privacy

Segmentation runs entirely in the browser (main thread or the render worker). No frame, mask or image is ever sent to a
server; the only network traffic is the one-off download of the files above from our own origin.
