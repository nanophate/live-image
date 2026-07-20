# Third-party notices

This file records dependencies used by the current MVP. It is not a replacement
for the upstream license texts or legal review.

## Runtime build

- TypeScript — Apache License 2.0 — <https://github.com/microsoft/TypeScript>
- Vite — MIT License — <https://github.com/vitejs/vite>
- esbuild (transitive Vite dependency) — MIT License — <https://github.com/evanw/esbuild>
- @playwright/test / Playwright 1.61.1 — Apache License 2.0; preserve its
  NOTICE when redistributed — <https://github.com/microsoft/playwright>
- Playwright Chromium headless shell revision 1228 (Chromium
  149.0.7827.55) — Chromium BSD-style license plus bundled third-party
  notices — <https://chromium.googlesource.com/chromium/src/+/main/LICENSE>
- Playwright FFmpeg revision 1011 — GNU Lesser General Public License 2.1 or later;
  the downloaded cache includes `COPYING.LGPLv2.1` — <https://ffmpeg.org/legal.html>

No third-party package is required by the generated browser runtime at frame
time. Playwright, Chromium, and FFmpeg are development/CI-only and are not
copied into the Viewer build or release artifacts.

## Hosted deployment tooling

- @cloudflare/containers 0.3.0 — ISC License —
  <https://github.com/cloudflare/containers>
- Wrangler 4.112.0 — MIT OR Apache License 2.0 —
  <https://github.com/cloudflare/workers-sdk>
- @cloudflare/workers-types 5.20260719.1 — MIT OR Apache License 2.0 —
  <https://github.com/cloudflare/workerd>

Wrangler and the Workers type package are development/deployment tools.
`@cloudflare/containers` is bundled into the deployed Worker gateway, but none
of these packages are copied into the browser Runtime. The private compiler
image uses Python 3.12 slim-bookworm,
Debian packages, `libgomp1`, and the compiler stack below. Capture the exact
base-image digest and generated OS/Python package notices before distributing
the image itself; the current scaffold is not such a notice-complete appliance.

## Compiler

- anime-face-detector — MIT; vendored portions derived from mmcv, mmdetection,
  and mmpose are Apache License 2.0 — <https://github.com/hysts/anime-face-detector>
- anime-face-detector YOLOv3 weights — upstream model card labels MIT —
  <https://huggingface.co/hysts/anime-face-detector-yolov3>
- anime-face-detector HRNetV2 weights — upstream model card labels MIT —
  <https://huggingface.co/hysts/anime-face-detector-hrnetv2>
- PyTorch / torchvision — BSD-style license — <https://github.com/pytorch/pytorch>
- OpenCV — Apache License 2.0 — <https://github.com/opencv/opencv>
- NumPy — BSD-3-Clause — <https://github.com/numpy/numpy>
- Hugging Face Hub — Apache License 2.0 — <https://github.com/huggingface/huggingface_hub>
- safetensors — Apache License 2.0 — <https://github.com/huggingface/safetensors>

The detector model cards explicitly do not warrant the provenance of their
training data. Treat that separately from the labelled code/weight licenses and
complete a product/legal review before representing the compiler as commercially
cleared.

## Test images

The repository anime portraits were generated specifically for this repository
with OpenAI's built-in image-generation tool. The no-face gradient is generated
locally with ImageMagick, and the low-resolution validation portrait is a local
192×192 downsample of a generated source. See `fixtures/README.md` and
`fixtures/validation/prompts.json` for the prompt and provenance records.

The local external hold-out set uses four CC0 portraits and one CC BY 3.0
portrait from OpenGameArt contributors. The source images are ignored by Git
and are not distributed in this repository. These test assets and their
derivatives are not covered by the project MIT License. Exact creators, source
links, license links, changes, and SHA-256 hashes are recorded in
`fixtures/holdout/ATTRIBUTION.md`; the CC BY portrait requires credit to
Jupiter's Daughter whenever it or a derivative is distributed.
