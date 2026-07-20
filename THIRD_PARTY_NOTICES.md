# Third-party notices

This file records dependencies used by the current MVP. It is not a replacement
for the upstream license texts or legal review.

## Runtime build

- TypeScript — Apache License 2.0 — <https://github.com/microsoft/TypeScript>
- Vite — MIT License — <https://github.com/vitejs/vite>
- esbuild (transitive Vite dependency) — MIT License — <https://github.com/evanw/esbuild>

No third-party package is required by the generated browser runtime at frame
time; Vite and TypeScript are development/build tools.

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
