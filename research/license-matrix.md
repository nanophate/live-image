# Shipped license and provenance matrix

Snapshot: 2026-07-19. This is an engineering record, not legal advice.

Project-authored source code is released under the MIT License. This matrix
tracks only code, models, data, and assets used by the current MVP. Evaluated
but unadopted technologies remain in [`related-work.md`](related-work.md); their
artifacts are not part of this release.

| Item | Code | Weights/data/assets | MVP use | Status |
| --- | --- | --- | --- | --- |
| anime-face-detector | MIT; vendored portions Apache-2.0 | Model cards state MIT, but training-data provenance is not warranted | compile-time detector | usable for research MVP; provenance review before commercial release |
| compiler dependency stack | OpenCV Apache-2.0; NumPy BSD-3-Clause; PyTorch/torchvision BSD-style; Hugging Face Hub and safetensors Apache-2.0 | no additional project-owned data | detector execution and checkpoint loading | versions pinned directly or transitively in the compiler environment |
| web build stack | TypeScript Apache-2.0; Vite and esbuild MIT | none | development, tests, and browser bundle generation | no third-party package is required by the generated runtime at frame time |
| repository fixtures | n/a | generated specifically for this project with OpenAI image generation | regression tests and demo | prompt/provenance recorded in `fixtures/README.md` |

## Release checklist

- Freeze exact detector and weight digests inside released `.limg` provenance.
- Preserve MIT/Apache notices for redistributed detector code or weights.
- Obtain a product/legal decision on training-data provenance before declaring a
  commercial-safe compiler path.
- Re-check all remote model cards at the release tag rather than relying on this
  dated snapshot.
- Do not add an unreviewed non-commercial, research-only, or unclear-provenance
  artifact to a release bundle.
