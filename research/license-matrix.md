# Shipped license and provenance matrix

Snapshot: 2026-07-21. This is an engineering record, not legal advice.

Project-authored source code is released under the MIT License. This matrix
tracks only code, models, data, and assets used by the current MVP. Evaluated
but unadopted technologies remain in [`related-work.md`](related-work.md); their
artifacts are not part of this release.

| Item | Code | Weights/data/assets | MVP use | Status |
| --- | --- | --- | --- | --- |
| anime-face-detector | MIT; vendored portions Apache-2.0 | Model cards state MIT, but training-data provenance is not warranted | compile-time detector | usable for research MVP; provenance review before commercial release |
| compiler dependency stack | OpenCV Apache-2.0; NumPy BSD-3-Clause; PyTorch/torchvision BSD-style; Hugging Face Hub and safetensors Apache-2.0 | no additional project-owned data | detector execution and checkpoint loading | versions pinned directly or transitively in the compiler environment |
| web build stack | TypeScript Apache-2.0; Vite and esbuild MIT | none | development, tests, and browser bundle generation | no third-party package is required by the generated runtime at frame time |
| container web build base | Node.js 24.18.0 / npm 11.16.0; Node.js and npm are MIT; official slim image includes Debian build-layer packages | none | build the Vite `dist` copied into the Hugging Face target | build-only stage pinned at manifest digest `sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`; Node and its OS layer are absent from both final runtime images |
| browser validation stack | @playwright/test / Playwright 1.61.1 Apache-2.0; Chromium BSD-style plus bundled third-party notices; Playwright FFmpeg LGPL-2.1-or-later | Chromium headless shell revision 1228 / 149.0.7827.55 and FFmpeg revision 1011, downloaded to an ephemeral developer or CI cache | full-resolution Canvas 2D locality and recovery tests only | exact npm version locked; browser/FFmpeg are not shipped in Viewer artifacts; preserve bundled notices before any cache, image, or test-appliance redistribution |
| Cloudflare deployment stack | @cloudflare/containers 0.3.0 ISC; Wrangler 4.112.0 and Workers types 5.20260719.1 MIT OR Apache-2.0 | no data or sample media | build-time Worker gateway, static asset upload, and private Container lifecycle | development/deployment only; not required by the browser runtime; hosted compiler remains disabled by default |
| compiler container base | Python 3.12.10 slim-bookworm base at manifest digest `sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db`, Debian packages, libgomp1, and the exact `requirements/container.lock.txt` environment | reviewed detector weights are baked into the private image cache and verified by SHA-256 | private Cloudflare API target and private Hugging Face same-origin measurement target | linux/amd64 builds are confirmed; generated OS/Python transitive package notices, wheel hashes, and SBOM remain open, so do not publish either image as a redistributable appliance before that audit |
| repository fixtures | n/a | generated specifically for this project with OpenAI image generation, plus one locally downsampled derivative | regression tests, demo, and 12-image validation | prompt/provenance recorded in `fixtures/README.md` and `fixtures/validation/prompts.json` |
| external hold-out test media | n/a | four CC0 images and one CC BY 3.0 image from five OpenGameArt contributors | independent compiler/runtime validation only | local-only and ignored by Git; exact attribution, hashes, and any derivative obligations are recorded in `fixtures/holdout/ATTRIBUTION.md` |

## Release checklist

- Freeze exact detector and weight digests inside released `.limg` provenance.
- Pin the Python base image digest and capture the Debian/Python package notices
  from the first successful container build before distributing that image.
- Preserve MIT/Apache notices for redistributed detector code or weights.
- Obtain a product/legal decision on training-data provenance before declaring a
  commercial-safe compiler path.
- Re-check all remote model cards at the release tag rather than relying on this
  dated snapshot.
- Do not add an unreviewed non-commercial, research-only, or unclear-provenance
  artifact to a release bundle.
- Keep external hold-out media out of Git and outside the MIT-licensed
  project-artwork claim; preserve the Jupiter's Daughter CC BY 3.0 attribution
  whenever that portrait or a derivative is distributed.
- Do not copy Playwright browser or FFmpeg caches into a release, container, or
  offline test appliance without carrying their bundled license/notice files
  and reviewing the resulting redistribution obligations.
