# Dual Cloudflare and Hugging Face container targets

Date: 2026-07-21

Status: both linux/amd64 targets and the same-origin hosted path are locally
validated; no Space, route, billing, or public image was created

## Question

Can one reviewed Dockerfile produce the existing private Cloudflare Compiler
API and a Hugging Face Docker Space with the complete PNG → `.limg` → Viewer
experience, without duplicating the detector environment or weakening the local
Studio and private Container boundaries?

## Primary sources reviewed

- Hugging Face Docker Spaces accept an arbitrary Dockerfile, allow `app_port`,
  and pass Space variables as Docker build arguments:
  <https://huggingface.co/docs/hub/spaces-sdks-docker>.
- Hugging Face CPU Basic currently provides free CPU hardware with ephemeral
  disk and sleeps after inactivity:
  <https://huggingface.co/docs/hub/spaces-overview>.
- Cloudflare Wrangler builds a configured Dockerfile and supports build-time
  `image_vars`:
  <https://developers.cloudflare.com/containers/platform-details/image-management/>
  and
  <https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/>.
- Docker permits named stages, `--target`, and global `ARG` expansion in
  `FROM`: <https://docs.docker.com/reference/dockerfile/#from>.

## Implementation decision

- **Decision:** one Dockerfile owns a pinned shared `compiler-runtime` and two
  explicit final targets. `living-image-cloudflare` runs only
  `compiler.container_api`; `living-image-huggingface` copies the generated
  Viewer and runs `compiler.hosted_server`.
- **Decision:** local and CI builds use explicit `--target`. Automated hosts
  can select the final stage with `LIVING_IMAGE_TARGET`; the default is the
  Hugging Face target while Wrangler explicitly fixes the Cloudflare target.
- **Confirmed:** the Cloudflare image does not reference the Node build stage,
  and the Hugging Face final image contains only `dist`, not Node/npm.
- **Decision:** retain port 8080 for both providers. The root README carries the
  Docker Space metadata with `app_port: 8080`.
- **Decision:** do not relax `compiler.studio_server` or add static routes to
  `compiler.container_api`. The new hosted server is a separate public surface.

## Hosted server boundary

- **Confirmed:** the server publishes only resolved regular files below the
  generated `dist` allow-root. It rejects directory listing, dotfiles, `..`,
  encoded traversal, backslashes, and symlinks.
- **Confirmed:** `/api/config` identifies the Hugging Face provider; Viewer copy
  discloses that bytes leave the device, the application does not intentionally
  persist inputs/outputs, provider operational logging is outside that claim,
  and sensitive images must not be uploaded.
- **Confirmed:** image compilation requires an exact `Origin` and `Host` match
  against `PUBLIC_ORIGIN` or the platform-provided `SPACE_HOST`. Forwarded host
  headers are not trusted.
- **Confirmed:** `HOSTED_COMPILER_ENABLED` defaults false. Missing trusted
  origin plus an enable request fails startup rather than opening compilation.
- **Confirmed:** size, declared length, PNG/JPEG media, signature, dimensions,
  filename bounds, reason-only reject, and temporary request scope reuse the
  existing shared Compiler service.
- **Confirmed:** inference is protected by a non-blocking process lock. A
  concurrent compile receives HTTP 429 plus `Retry-After`; threaded static and
  health requests remain available while the detector is busy.
- **Confirmed:** API responses are `no-store`; static HTML is revalidated;
  hashed assets are immutable; CSP, `nosniff`, same-origin resource policy,
  referrer policy, and restricted browser permissions are returned.
- **Decision:** application access logs are disabled so client IPs and request
  metadata are not copied into app logs. Generic failures expose only a
  server-generated request ID, not a traceback or temporary path.

## Dependency and image evidence

- Node build image: `node:24.18.0-bookworm-slim` at manifest digest
  `sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`.
- Python runtime image remains pinned at
  `sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db`.
- npm is fixed to 11.16.0. The final observed non-PyTorch Python environment is
  exact-versioned in `requirements/container.lock.txt`; PyTorch 2.2.2+cpu and
  torchvision 0.17.2+cpu remain fixed through the CPU wheel index.
- Frozen detector model hashes remained:
  - YOLOv3 `23bbc708146bcbc1c910f00fe152adbc70d7658d875a0121eaf4ee61d978b2c4`
  - HRNetV2 `e71271376406a743c01528a0460637fcc06e72aeeea583f85007cc72dc8b7a4a`
- Final Cloudflare target:
  `sha256:eda18504623d0d5d937bc2d7058cc401c28f939e9906cbfe09c7e35e90c1d361`,
  1,775,027,318 bytes, UID/GID 1000.
- Final Hugging Face target:
  `sha256:8f660095e4347ad5e7dc29124ac83e20838a3eff6f2d2be06c5388db18acdcdf`,
  1,775,175,772 bytes, UID/GID 1000.
- **Confirmed:** the Viewer target adds 148,454 bytes to the final image; it
  does not duplicate the Python/model layers.

## Real target validation

- **Confirmed:** Cloudflare target `/ping` returned 200 and `/viewer.html`
  remained 404, preserving the private API-only boundary.
- **Confirmed:** Hugging Face target `/viewer.html` returned 200 `text/html`;
  `/api/config` returned enabled hosted mode and `provider: hugging-face`.
- **Confirmed:** a local ignored source PNG passed through the actual pinned
  detector in both target containers. Each response was HTTP 200, 2,498,815
  bytes, `full`, with no disabled capabilities.
- **Confirmed:** the Cloudflare and Hugging Face responses were byte-identical:
  SHA-256
  `d42c7f9f0ba7424537793e422fdd332b13eec16a4b69c52b2166c727c376fe58`.
- **Confirmed:** the final Hugging Face image measured 7.427253 seconds on its
  first request and 4.962861 seconds warm; both produced the same response hash.
  These are Docker Desktop measurements, not provider SLOs.
- **Confirmed:** 53 Python tests and 55 TypeScript tests pass; production Viewer
  and Worker builds pass; Wrangler dry-run recognizes the selected Cloudflare
  build argument.

## Licensing and rollout decision

- **Confirmed:** no fixture PNG, hold-out image, generated `.limg`, Node runtime,
  or test media is copied into either final image. The Hugging Face target does
  include the public validation JSON report already shipped by the Viewer.
- **Open:** exact wheel hashes, Debian/Python transitive notices, and an image
  SBOM are not complete. Detector training-data provenance also remains an
  explicit product/legal review gate.
- **Decision:** do not publish a public Space or redistributable container yet.
  The next provider action is a private Hugging Face Space benchmark using the
  frozen input and artifact contract, followed by notice/SBOM and privacy/abuse
  review before public visibility.
- **Open:** measure real Space cold wake, first/warm inference, RSS, concurrent
  429 behavior, proxy preservation of `Content-Length`, shutdown, and rebuild
  byte reproducibility. Compare with authenticated Cloudflare standard-2 only
  after the respective account/billing approvals.
