# Hosted compiler platforms and container gateway

Reviewed: 2026-07-21

Status: Workers Paid and a route-free, compiler-disabled first Cloudflare
deployment are confirmed; no public route, Access application, or hosted
compiler has been enabled

## Product question

The useful review experience is one continuous path:

    Open a web page
    → choose PNG or JPEG
    → automatic Compiler returns full / limited / reject
    → accepted .limg loads immediately in the Viewer
    → blink, gaze, mouth, breathing, reactions, and recording work in that page

Requiring an evaluator to run a local compiler and manually transfer .limg to a
second hosted Viewer is useful engineering evidence, but it is not the target
product experience.

## Cloudflare Containers

- **Confirmed:** Containers run Linux/amd64 images behind a Worker and a
  Durable Object binding. A static frontend plus Container backend is an
  official reference pattern. Sources:
  <https://developers.cloudflare.com/containers/> and
  <https://developers.cloudflare.com/containers/examples/container-backend/>.
- **Confirmed:** Containers are available on Workers Paid. Current predefined
  instances range from lite (256 MiB) to standard-4 (12 GiB). standard-1
  provides 0.5 vCPU, 4 GiB RAM, and 8 GB disk; standard-2 provides 1 vCPU,
  6 GiB RAM, and 12 GB disk. Source:
  <https://developers.cloudflare.com/containers/platform-details/limits/>.
- **Confirmed:** the current price includes 25 GiB-hours memory, 375 vCPU
  minutes, and 200 GB-hours disk in the $5 monthly Workers Paid plan. Overage is
  metered separately, and network, Worker, Durable Object, and logs can add
  cost. Source: <https://developers.cloudflare.com/workers/platform/pricing/>.
- **Confirmed:** container disk is ephemeral. An idle container may sleep and
  later start from its original image; cold starts are commonly 1–3 seconds
  before application and model initialization. Source:
  <https://developers.cloudflare.com/containers/platform-details/architecture/>.
- **Confirmed:** the documented Container sizes list vCPU, memory, and disk but
  no GPU option. Workers AI is a separate catalog inference service, not a
  native runtime for these arbitrary PyTorch weights.
- **Inference:** the current approximately 1.0 GiB Python environment plus
  approximately 272 MiB weights should fit standard-1, but its 0.5 vCPU may
  make CPU inference too slow. standard-2 is the first performance comparison
  candidate, not an assumed requirement.
- **Decision:** serve the Vite dist directory as Worker Assets and invoke the
  Worker first only for /api paths. Route /api/compile to one named Container
  so the loaded detector can be reused. Keep max_instances at one until latency,
  queueing, and cost are measured.
- **Decision:** keep the public Container with outbound internet disabled.
  Download weights during the controlled image build and verify the reviewed
  SHA-256 values before the image can finish building.

## Hugging Face comparison

- **Confirmed:** Hugging Face Docker Spaces accept an arbitrary Dockerfile,
  expose an application port, and can use CPU or upgraded GPU hardware. Source:
  <https://huggingface.co/docs/hub/spaces-sdks-docker>.
- **Confirmed:** the current free CPU Space provides 2 vCPU, 16 GB RAM, and
  non-persistent disk; free hardware sleeps after inactivity. Upgraded hardware
  is charged while Starting or Running, and paid hardware can use a configured
  sleep time. Sources: <https://huggingface.co/docs/hub/spaces-overview> and
  <https://huggingface.co/docs/hub/spaces-gpus>.
- **Confirmed:** public Spaces expose both source and application. Protected
  Spaces keep source private while the application remains public, and private
  Spaces restrict both. Protected visibility is a paid-plan feature; it is not
  itself per-user API authorization. Source:
  <https://huggingface.co/docs/hub/spaces-overview>.
- **Confirmed:** ZeroGPU is a Gradio SDK feature rather than a Docker Space
  GPU mode, so adopting it would change the current web UI/API architecture.
  Source: <https://huggingface.co/docs/hub/spaces-zerogpu>.
- **Inference:** a Docker Space is the simplest alternate host for demonstrating
  this Python compiler, especially if Cloudflare CPU inference is too slow. A
  Cloudflare Worker remains a stronger front door when separate authentication,
  quotas, cost control, or a private inference endpoint is needed.
- **Decision:** keep the compiler image provider-neutral. Cloudflare-specific
  lifecycle and routing remain in deploy/cloudflare/worker.ts; the Python image
  exposes ordinary HTTP /ping, /healthz, and /api/compile routes.

## Implemented private-alpha boundary

- **Confirmed:** compiler/compiler_service.py now owns the shared size, media,
  signature, dimension, temporary-directory, quality, and result handling.
- **Confirmed:** the existing compiler/studio_server.py remains localhost-only
  and serves the local UI. It was not relaxed into a public server.
- **Confirmed:** compiler/container_api.py serves no static files and exposes
  only process health, readiness, and compilation. It returns request IDs
  without returning machine paths or exception details.
- **Confirmed:** deploy/cloudflare/worker.ts validates method, media type,
  declared size, and same-origin browser requests before streaming the request
  to one private Container. The owner-approved normal mode now keeps
  HOSTED_COMPILER_ENABLED true behind Access.
- **Confirmed:** workers.dev and preview URL exposure are disabled. Review of
  the first deployed gateway found that checking only for an Access assertion
  header was insufficient and could accept a forged value if the Worker were
  reachable outside the intended Access path.
- **Confirmed:** the corrected gateway uses jose 6.2.3 and the account JWKS to
  verify RS256 signature, exact team-domain issuer, application AUD, and expiry.
  Missing configuration returns 503, a missing assertion returns 401, and an
  invalid assertion returns 403 without exposing verification details.
- **Decision:** Worker-wide Cloudflare Access remains the first gate. JWT
  verification is required in addition and compilation cannot be enabled until
  both `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` are stored outside Git.
- **Confirmed:** wrangler.jsonc fixes one standard-2 instance and max_instances
  at one. Container outbound access is disabled and idle sleep is five minutes.
- **Confirmed:** Dockerfile uses Python 3.12, CPU PyTorch 2.2.2, torchvision
  0.17.2, a non-root UID, offline runtime, and baked model cache. It opens the
  health port before lazy in-process model load so Cloudflare port readiness is
  not coupled to PyTorch/model initialization.
- **Confirmed:** the reviewed model SHA-256 values are:
  - YOLOv3:
    23bbc708146bcbc1c910f00fe152adbc70d7658d875a0121eaf4ee61d978b2c4
  - HRNetV2:
    e71271376406a743c01528a0460637fcc06e72aeeea583f85007cc72dc8b7a4a
- **Confirmed:** the Compiler page queries /api/config and accurately labels
  local, Access-protected, time-boxed public-review, or provider-hosted
  processing. The separate Viewer makes no Compiler request. Hosted copy says
  that source images leave the device; it does not reuse the local privacy
  claim.

## Local validation

- **Confirmed:** nodenv exec npm run build succeeds with Node 24.18.0.
- **Confirmed:** nodenv exec npm run build:worker succeeds against
  @cloudflare/containers 0.3.0 and Workers types 5.20260719.1.
- **Confirmed:** Wrangler 4.112.0 dry-run recognizes 18 static assets, the
  COMPILER Durable Object, the CompilerContainer, the Access-required normal
  mode, and the bounded review-window variables.
- **Confirmed:** 53 Python tests pass, including hosted health, route-surface,
  media rejection, short-body rejection, SIGTERM unwind, request ID, and .limg
  response tests.
- **Confirmed:** 57 TypeScript tests pass and the production Vite build succeeds,
  including Worker upload policy and authentication-header isolation checks.
- **Confirmed:** the complete Chromium suite passes 14 tests with 2 documented
  local-artifact skips, including Viewer-only input gating and a hosted
  non-JSON Access rejection with a visible request ID.
- **Confirmed:** the Worker rebuilds the Container request from an explicit
  three-header allowlist and uses FixedLengthStream, so Cloudflare Access
  assertions, cookies, authorization headers, and client-network metadata do
  not reach Python and the forwarded body cannot diverge from its declared size.
- **Confirmed:** the local cached weight files match both reviewed hashes while
  Hugging Face Hub is forced offline.
- **Confirmed:** the hosted Python entrypoint itself was exercised on localhost
  with the tracked teal-librarian PNG. It returned a full 2,498,807-byte .limg
  in 4.339968 seconds. The bound protocol and artifact hash are recorded in
  experiments/2026-07-21-hosted-compiler-api-validation.md.
- **Confirmed:** the linux/amd64 image builds successfully at 1,774,865,798
  bytes (approximately 1.65 GiB), runs non-root and offline, becomes Docker
  healthy, and exits cleanly on idle SIGTERM. The exact image and base digests
  are recorded in
  experiments/2026-07-21-container-benchmark.md.
- **Confirmed:** under a local standard-1-shaped 0.5 CPU / 4 GiB limit, the
  first request took 130.52 seconds and the second warm request took 81.24
  seconds. Loaded memory was about 594 MiB. Under a standard-2-shaped 1 CPU /
  6 GiB limit, warm compile took 38.89 seconds and a no-face reject took 25.52
  seconds; memory reached about 638 MiB.
- **Decision (superseded by the thread-control follow-up below):** neither
  standard-1 nor standard-2 is ready for the intended review experience at
  these measured local CPU quotas. Do not pay-deploy the current image until
  profiling/optimization and a 2-vCPU or Hugging Face comparison are complete.
- **Open:** actual Cloudflare Container CPU behavior remains unconfirmed; the
  local quota experiment is a screening result, not a provider benchmark.
- **Confirmed:** follow-up profiling found the Docker VM exposed 12 CPUs to
  PyTorch despite the 0.5/1 CPU quotas. Setting the Compiler default to one
  intra-op and one inter-op thread reduced the 1-CPU profiled warm path from
  63.72 to 9.54 seconds. The final real HTTP path measured 10.06 seconds first
  and 4.95 seconds warm at 1 CPU, with byte-identical artifacts and about 550
  MiB loaded memory.
- **Confirmed:** the reproducible thread default preserves the public 12/12
  status/capability matrix and the intentionally unchanged 2/5 external
  hold-out boundary. Two runs of each report were byte-identical.
- **Decision:** the earlier standard-2 no-deploy screening decision is
  superseded for authenticated private staging. standard-2 is now the first
  provider measurement candidate; this does not authorize billing or a route.
- **Decision:** standard-1 remains a comparison because its one-thread profile
  took 14.77 seconds at 0.5 CPU. A 2-CPU/2-thread profile took 7.04 seconds warm,
  so higher CPU is not yet justified before real provider measurements.

## Dual-target follow-up

- **Confirmed:** one pinned multi-stage Dockerfile now builds an API-only
  `living-image-cloudflare` target and a same-origin Viewer + Compiler
  `living-image-huggingface` target over the same exact Python/model layers.
- **Confirmed:** the Hugging Face target serves only generated `dist`, requires
  exact `SPACE_HOST`/`PUBLIC_ORIGIN` Host and Origin matching, defaults compile
  off, returns 429 while inference is busy, and does not application-log client
  request metadata.
- **Confirmed:** both real linux/amd64 target containers returned the same
  2,498,815-byte full `.limg`, SHA-256
  `d42c7f9f0ba7424537793e422fdd332b13eec16a4b69c52b2166c727c376fe58`.
- **Decision:** benchmark a private Hugging Face Space before deciding whether
  the free CPU path should become the review demo. Do not publish the image
  until wheel hashes, notices, SBOM, privacy/abuse controls, and the existing
  detector-provenance product decision are complete.
- Full evidence:
  [`experiments/2026-07-21-dual-target-container-validation.md`](experiments/2026-07-21-dual-target-container-validation.md).

## Security, privacy, and operations gates

- **Decision:** do not enable anonymous hosted compilation merely by changing
  HOSTED_COMPILER_ENABLED. The first deployed compiler must be an authenticated
  private alpha with a short bounded queue, request timeout, per-user/global
  quota, spending alert, and log review.
- **Decision:** source images and generated .limg files are response-only and
  are not written to R2, a database, application logs, or analytics. Any future
  persistence requires a separate retention/deletion decision.
- **Decision:** keep signature, byte, dimension, decoded-pixel, detector
  confidence, and reject gates in the Container even when the Worker validates
  the request first.
- **Open:** a Worker timeout does not necessarily terminate native Python
  inference. Before public use, choose and test a supervised child-process
  deadline or a Container restart policy.
- **Confirmed:** the project owner enabled Workers Paid on the `LogosAct`
  account. A first deployment registered the Worker, Durable Object namespace,
  and standard-2 Container application with zero instances and no deployed
  targets; no route or compiler was enabled.
- **Open:** create and test a Worker-wide Access application, select the staging
  endpoint, store the team domain/AUD, and establish regional/privacy
  disclosure, operator/contact, incident path, and cost ceiling.
- Full deployment evidence:
  [`experiments/2026-07-21-cloudflare-private-staging.md`](experiments/2026-07-21-cloudflare-private-staging.md).
- **Open:** confirm in private staging that Cloudflare exposes Content-Length
  for browser HTTP/2 uploads. Both gateway and Container intentionally reject a
  missing length today; the accepted stream is bounded and length-enforced
  again before it reaches the Container.
- **Open:** the upstream weight cards label the weights MIT, but their
  training-data provenance is not warranted. This remains a separate product
  review gate for commercial hosted inference.

## Decision

- **Decision:** the product direction is now the end-to-end hosted flow, not a
  permanent local-compile/manual-transfer split.
- **Decision:** Cloudflare Worker Assets plus a private Container is the first
  implementation target because it preserves one origin and scale-to-zero.
- **Decision:** Hugging Face Docker Space is the measured fallback/benchmark,
  especially if CPU latency on Cloudflare is not acceptable.
- **Open:** actual provider selection remains conditional on the same frozen
  validation images producing acceptable cold/warm latency, peak RSS, and cost.
