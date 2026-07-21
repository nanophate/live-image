# Hosted compiler linux/amd64 container benchmark

Date: 2026-07-21

Status: local Docker boundary confirmed; Cloudflare runtime remains unvalidated

## Protocol

- Host: Darwin 24.6.0 x86_64.
- Docker Engine: 29.6.1, linux/amd64 VM, 12 reported CPUs and 8,216,600,576
  bytes memory.
- Base: `python:3.12.10-slim-bookworm`, manifest digest
  `sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db`.
- Source: `fixtures/source/teal-librarian.png`, 1,641,156 bytes, SHA-256
  `4480e53d53959ac7aa8665a91166ec3c5e839bb10bd53aaa96d708607b5798e6`.
- Reject source: `fixtures/source/unsupported-no-face.png`, 3,342 bytes,
  SHA-256 `43ae455b95d01639a52dc438b5dd2e101360230f93ad99636758d308de20ea8a`.
- The successful compile benchmark used image
  `sha256:44659fd6e094c84056ac6128344420be4d8d154e1fa5c2ecde4a78b7b62f59fa`.
  It contains the same compiler, dependencies, and verified detector bytes as
  the final image; the subsequent changes pin the base digest and add offline
  environment, healthcheck, and SIGTERM handling.
- The final built image is
  `sha256:07ee20f61245745b5a9968111e63a46983f3093079c0aebfd602ce8f2100c1cc`,
  linux/amd64, 1,774,865,798 bytes (approximately 1.65 GiB).

The first build attempts timed out while Docker Desktop waited on its
`desktop` credential helper. **Decision:** do not modify or log out the user's
Docker authentication. The successful public-image pull and builds used a
temporary empty Docker config. The unnecessary `docker/dockerfile:1.7`
frontend directive was removed because no 1.7-only feature was used.

## Results

### Image and process boundary

- **Confirmed:** the build downloaded both reviewed detector files and matched
  YOLOv3 SHA-256
  `23bbc708146bcbc1c910f00fe152adbc70d7658d875a0121eaf4ee61d978b2c4`
  and HRNetV2 SHA-256
  `e71271376406a743c01528a0460637fcc06e72aeeea583f85007cc72dc8b7a4a`.
- **Confirmed:** the final image runs as UID/GID `10001:10001`, sets
  `HF_HUB_OFFLINE=1`, disables Hub telemetry, and contains a `/ping` Docker
  healthcheck with a 30-second start period.
- **Confirmed:** before model load, `/ping` returned HTTP 200 in 0.015471
  seconds while `/healthz` correctly returned HTTP 503 `starting`; idle memory
  was 182 MiB.
- **Confirmed:** after the first compile, `/healthz` returned HTTP 200 `ready`.
- **Confirmed:** a five-second health start period produced one expected
  connection-refused probe during Python import and then became healthy. The
  final image uses 30 seconds to avoid treating import startup as a failure.
- **Confirmed:** the original PID 1 behavior did not exit within a ten-second
  Docker stop grace period and was killed with exit 137. The SIGTERM handler
  added after reproducing this failure exited the container with code 0,
  `OOMKilled=false`, in approximately two seconds while idle.

### CPU-constrained compile

| Limit | Phase | HTTP | Time | Output | Observed memory |
| --- | --- | ---: | ---: | ---: | ---: |
| 0.5 CPU / 4 GiB | first request, lazy model load | 200 | 130.517932 s | 2,498,825 bytes | 593.6 MiB after response |
| 0.5 CPU / 4 GiB | second request, warm | 200 | 81.241646 s | 2,498,823 bytes | not separately sampled |
| 1 CPU / 6 GiB | warm | 200 | 38.888589 s | 2,498,833 bytes | 638.3 MiB after response |
| 1 CPU / 6 GiB | no-face reject | 422 | 25.524145 s | 92 bytes | not separately sampled |

- **Confirmed:** every accepted artifact parsed as `format=living-image`,
  `quality.status=full`, Compiler 0.8.0, with no disabled capabilities.
- **Confirmed:** output sizes and hashes differ because the requested portable
  filename changes the manifest ID. No image or `.limg` from this benchmark was
  added to Git.
- **Confirmed:** the reject response contained only
  `no near-frontal anime face detected` and no machine path.
- **Inference:** memory is not the immediate constraint for standard-1 or
  standard-2. CPU latency is the product blocker.
- **Decision:** do not deploy standard-1 as the review experience. A warm
  81-second compile is not acceptable for the intended select-and-review flow.
- **Decision:** standard-2 is also not deployment-ready at the measured
  38.9-second warm time. Before paid staging, profile the detector stages,
  investigate thread/runtime configuration and model alternatives, and compare
  a 2-vCPU target or Hugging Face CPU/GPU hardware with the same frozen input.

## Follow-up

- **Confirmed:** the stage/thread investigation was completed after this
  baseline. PyTorch was sizing its pool from the 12-CPU Docker VM while the
  process was constrained to 0.5 or 1 CPU.
- **Confirmed:** the final one-thread image returned the same full `.limg` in
  10.06 seconds on its first 1-CPU HTTP request and 4.95 seconds warm, with
  byte-identical first/warm artifacts.
- **Decision:** the standard-2 no-deploy decision immediately above is
  superseded for private staging only. Standard-2 is now a plausible
  authenticated measurement target; public deployment remains unauthorized.
- Full evidence: [`2026-07-21-container-thread-profile.md`](2026-07-21-container-thread-profile.md).

## Limitations and next actions

- **Confirmed:** these are local CPU-quota measurements, not Cloudflare
  Container measurements. Scheduling and CPU characteristics can differ.
- **Open:** rerun the final image's first and second compile after the final
  boundary-only rebuild. The attempt to start that additional validation was
  rejected by the local execution approval limit; no container was created.
- **Open:** measure one queued pair of requests and SIGTERM during an active
  compile. Idle SIGTERM is confirmed, but an in-flight deadline/restart policy
  is still required before public use.
- **Open:** generate and review an image SBOM and frozen transitive Python/OS
  inventory before distributing the image as a reusable appliance.
- **Open:** profile YOLO, HRNet, post-processing, image encoding, and manifest
  serialization separately. Current measurements only expose end-to-end time.
