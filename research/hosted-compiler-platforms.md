# Hosted compiler platforms and container gateway

Reviewed: 2026-07-21

Status: Cloudflare Container private-alpha scaffold implemented locally; no
Cloudflare account, paid plan, public route, or hosted compiler has been enabled

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
  to one private Container. HOSTED_COMPILER_ENABLED defaults to false.
- **Confirmed:** workers.dev exposure is disabled and the gateway requires a
  Cloudflare Access assertion by default. Header presence is defense in depth;
  the future custom route must still be protected by an Access application that
  performs the actual token validation.
- **Confirmed:** wrangler.jsonc fixes one standard-1 instance and max_instances
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
- **Confirmed:** the Viewer now queries /api/config and accurately labels
  local, hosted, or Viewer-only processing. Hosted copy says that source images
  leave the device; it does not reuse the local privacy claim.

## Local validation

- **Confirmed:** nodenv exec npm run build succeeds with Node 24.18.0.
- **Confirmed:** nodenv exec npm run build:worker succeeds against
  @cloudflare/containers 0.3.0 and Workers types 5.20260719.1.
- **Confirmed:** Wrangler 4.112.0 dry-run recognizes 17 static assets, the
  COMPILER Durable Object, the CompilerContainer, and the disabled-by-default
  hosted compiler flag.
- **Confirmed:** 45 Python tests pass, including hosted health, route-surface,
  media rejection, short-body rejection, SIGTERM unwind, request ID, and .limg
  response tests.
- **Confirmed:** 55 TypeScript tests pass and the production Vite build succeeds,
  including Worker upload policy and authentication-header isolation checks.
- **Confirmed:** the complete Chromium suite passes 13 tests with 2 documented
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
- **Decision:** neither standard-1 nor standard-2 is ready for the intended
  review experience at these measured local CPU quotas. Do not pay-deploy the
  current image until profiling/optimization and a 2-vCPU or Hugging Face
  comparison are complete.
- **Open:** actual Cloudflare Container CPU behavior remains unconfirmed; the
  local quota experiment is a screening result, not a provider benchmark.

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
- **Open:** establish the actual Cloudflare account, domain, Access policy,
  regional/privacy disclosure, operator/contact, incident path, and cost ceiling.
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
