# Hosting and public deployment options

Reviewed: 2026-07-21

Status: feasibility review updated after the owner selected the end-to-end
hosted product direction; the private-alpha scaffold is recorded separately in
[`hosted-compiler-platforms.md`](hosted-compiler-platforms.md)

## Question

Can the current product flow run on GitHub or Cloudflare, and what should be
completed before public deployment?

The current product has two materially different workloads:

```text
Static web Runtime / Viewer
  HTML + TypeScript bundle + Canvas 2D + local .limg loading/recording

Automatic Compiler
  Python 3.12 + PyTorch + OpenCV + anime-face-detector + two model weights
```

They should not be treated as one hosting target.

## Current repository facts

- **Confirmed:** the production web build is approximately 164 KiB before
  adding sample `.limg` files. It is ordinary static HTML/JavaScript/CSS.
- **Confirmed:** the local compiler environment is approximately 1.0 GiB on the
  reviewed machine. Its cached weights are approximately 272 MiB: YOLOv3 is
  235 MiB and HRNetV2 is 37 MiB.
- **Confirmed:** `vite.config.ts` and the HTML currently use root-absolute URLs
  such as `/viewer.html`; the product Viewer also calls `/api/compile` and
  expects the local Studio to provide generated sample `.limg` routes.
- **Confirmed:** `dist/` does not contain the sample `.limg` files. A plain
  static deployment can load a user-selected `.limg`, but the automatic sample
  and PNG compilation paths will be unavailable.
- **Confirmed:** the local Studio deliberately binds to `127.0.0.1` and rejects
  non-local Host headers. It is not a public server implementation.

## GitHub Pages

- **Confirmed:** GitHub describes Pages as a static hosting service for HTML,
  CSS, and JavaScript. It cannot run the Python compiler endpoint. Source:
  <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>.
- **Confirmed:** GitHub Pages has documented size, bandwidth, build, and usage
  limits, and says it is not intended to operate commercial SaaS. Source:
  <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>.
- **Decision:** GitHub Pages is acceptable for project documentation or a
  static `.limg` Viewer demonstration, not for the full hosted product.
- **Open:** a normal project URL such as `/live-image/` needs Vite base-path and
  navigation hardening because the current root-absolute paths target the
  account domain root. A custom root domain would avoid that specific issue but
  would not add the compiler.
- **Confirmed:** Vite requires an explicit public base for nested deployment and
  exposes `import.meta.env.BASE_URL` for dynamically constructed URLs. Source:
  <https://vite.dev/guide/build#public-base-path>.
- **Decision:** a GitHub Pages deployment also needs a dedicated Actions
  workflow that builds, uploads, and deploys `dist/`; the current CI workflow
  only tests the build. Source: <https://vite.dev/guide/static-deploy>.

## Cloudflare Pages and ordinary Workers

- **Confirmed:** Cloudflare Pages can build from GitHub/GitLab and deploy a
  configured output directory on each push, including preview deployments.
  Source: <https://developers.cloudflare.com/pages/get-started/git-integration/>.
- **Confirmed:** Pages' current Free-plan limits include 20,000 files and 25 MiB
  per static asset. Source:
  <https://developers.cloudflare.com/pages/platform/limits/>.
- **Decision:** Cloudflare Pages is the preferred first static deployment. A
  `pages.dev` or root custom domain matches the current root paths more closely,
  and it leaves a clean route to a future Worker/Container front door.
- **Confirmed:** ordinary Workers currently allow 128 MiB memory and at most a
  10 MiB paid Worker bundle; the Free CPU allowance is 10 ms and paid requests
  default to 30 seconds with a configurable maximum of five minutes. Source:
  <https://developers.cloudflare.com/workers/platform/limits/>.
- **Confirmed:** Python Workers run through Pyodide/WebAssembly and have an
  ephemeral in-memory filesystem; threading and multiprocessing are not
  functional. Source:
  <https://developers.cloudflare.com/workers/languages/python/stdlib/>.
- **Inference:** the current native PyTorch/OpenCV compiler, 1.0 GiB environment,
  and 272 MiB weights are not a credible ordinary Worker or Python Worker
  workload. Porting this path to WebAssembly would be a separate architecture
  project, not deployment configuration.

## Codex / ChatGPT Sites

- **Confirmed:** OpenAI describes Sites as hosted interactive websites and
  lightweight apps that can be created, previewed, published, and shared from
  Codex or ChatGPT Work. Access and public-publishing controls depend on the
  user's plan, region, and workspace administration. Sources:
  <https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites>
  and <https://openai.com/academy/chatgpt-sites/>.
- **Confirmed:** the Sites workflow available in the reviewed Codex environment
  targets Cloudflare Worker-compatible ESM output and can provision logical D1
  or R2 bindings. It does not provide a native PyTorch/OpenCV process runtime.
- **Inference:** Sites can host the Canvas `.limg` Viewer and its reactions,
  showcase, and recording. The current multi-page Vite repository still needs a
  Sites-compatible hosting manifest/build adaptation; it is not a zero-change
  publish.
- **Decision:** Sites is attractive for a quick private or workspace review URL.
  GitHub Pages remains preferable for the canonical public project demo tied to
  this repository and its release history.
- **Decision:** Sites does not change the hosted Compiler conclusion. PNG
  compilation stays local until a separately secured container API exists.

## Cloudflare Containers

- **Confirmed:** Cloudflare Containers are generally available on Workers Paid
  and are intended for full Linux environments and resource-intensive existing
  applications. Sources: <https://developers.cloudflare.com/containers/> and
  <https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/>.
- **Confirmed:** current predefined sizes range from 256 MiB to 12 GiB RAM; a
  `standard-1` instance provides 0.5 vCPU, 4 GiB RAM, and 8 GB disk. Source:
  <https://developers.cloudflare.com/containers/platform-details/limits/>.
- **Confirmed:** Containers are reached through a Worker, can sleep after idle,
  and cold starts are commonly 1–3 seconds before application/model start time.
  Sources: <https://developers.cloudflare.com/containers/get-started/> and
  <https://developers.cloudflare.com/containers/platform-details/architecture/>.
- **Confirmed:** Cloudflare publishes a static-frontend/container-backend
  reference pattern. Source:
  <https://developers.cloudflare.com/containers/examples/container-backend/>.
- **Inference:** a Linux/amd64 container with at least the `standard-1` class is
  a technically plausible first hosted compiler target. Actual peak memory,
  image size, weight-loading time, cold start, compile latency, and concurrent
  throughput must be measured before selecting the class or estimating cost.
- **Decision:** do not expose the current `studio_server.py`. Build a separate
  hosted API/container entrypoint behind a Worker that owns authentication,
  request limits, routing, CORS, rate limits, and observability.

## Recommended rollout

### Decision update — 2026-07-21

- **Decision:** the earlier static-first recommendation remains a useful
  fallback but is no longer the primary product-review path. The intended
  review experience is now same-origin PNG/JPEG upload, automatic compilation,
  and immediate Viewer playback.
- **Decision:** implement and measure the authenticated Cloudflare Container
  alpha before publishing a standalone static Viewer. Keep Hugging Face Docker
  Space as the provider-neutral image benchmark and fallback.
- **Confirmed:** this update does not authorize Cloudflare billing, public
  anonymous compilation, or sample-media publication.

### Phase 1 — static review deployment

- Merge and tag the current local product slice.
- Add a deployment mode with a configurable API base. When no compiler API is
  configured, say `.limg Viewer` and do not promise PNG compilation.
- Remove root-path assumptions so the same build works under GitHub's project
  subpath and a Cloudflare root domain. This includes HTML navigation,
  validation-report fetches, sample URLs, and the configurable compile API.
- Make static mode the default: accept existing `.limg` only, hide sample
  auto-loading and PNG compilation, and explain how to run the local Studio.
  Studio builds must explicitly opt into `/api/compile`.
- Decide whether the hosted demo has no bundled character, or whether a
  project-generated sample `.limg` is published separately with provenance.
- Before publishing any fixture PNG, compiled `.limg`, screenshot, or recording,
  record an owner release decision for the exact approved assets and the dated
  source/terms relied upon. Never publish local hold-out media or derivatives;
  the CC BY hold-out also requires its recorded attribution.
- Add a dedicated deploy workflow for the selected host. For GitHub's project
  Pages use `/live-image/` as the public base; for Cloudflare Pages use `/`.
- Add deployment smoke tests for direct navigation, local `.limg` load,
  reactions, demo, recording availability, missing compiler, and zero external
  requests beyond declared origins.

### Phase 2 — private hosted compiler alpha

- Containerize Python 3.12, pinned dependencies, and the exact reviewed weight
  digests; run with network disabled after the image is built where practical.
- Put a Worker in front with authentication, origin allow-listing, per-user and
  global rate limits, a bounded queue, request IDs, timeouts, and cost caps.
- Keep the existing signature, dimension, byte, and quality gates. Isolate
  temporary data per request and prove deletion after success, reject, timeout,
  cancellation, and process failure.
- Return `.limg` directly where practical. Do not persist source or output by
  default; if R2 storage is added, define encryption, access, retention, and
  deletion policy first.
- Measure cold/warm load, peak RSS, compile CPU/wall time, output size, reject
  latency, concurrency behavior, and container cost using the frozen validation
  suite.

### Phase 3 — public compiler decision

- Resolve the product decision around detector weight/training-data provenance;
  the current matrix supports a research MVP but does not declare the compiler
  commercially safe.
- Publish privacy and acceptable-use disclosures that accurately say images are
  uploaded to a compiler. Do not reuse the local Studio's “images stay on this
  machine” language.
- Decide the service operator/contact, processing purpose, retention/deletion,
  logs/backups/telemetry, regions/processors, access controls, incident path,
  user rights/consent representation, prohibited impersonation/deception, and
  report/takedown enforcement. These hosted-service terms do not need to change
  the MIT license on the repository.
- Add abuse response, quotas/billing behavior, operational alerts, incident
  handling, and deletion verification.
- Run a private alpha and cost/abuse test before allowing anonymous requests.

## Recommendation

- **Decision:** prototype Cloudflare Worker Assets plus the compiler Container
  as an authenticated private alpha. Do not make the current compiler
  anonymously public yet.
- **Decision:** retain a static Viewer-only deployment as a fallback, not as the
  final judged workflow.
- **Open:** GitHub Pages remains a reasonable documentation/static fallback,
  but Cloudflare is the more coherent path if the project intends to add a
  hosted compiler later.
- **Open:** Codex Sites may be used as a parallel private review surface, but
  should not become a second divergent Runtime implementation.

## License and provenance impact

- **Confirmed:** this review adopts no new dependency, model, weight, data, or
  sample asset; no current notice or license-matrix row changes solely because
  of the review.
- **Open:** adding Cloudflare Workers/Containers packages, a Linux container
  base image, production server, monitoring SDK, or hosted sample asset creates
  new dependency/redistribution surfaces and must update
  `THIRD_PARTY_NOTICES.md` and `research/license-matrix.md` when selected.
