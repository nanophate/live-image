# Judging submission readiness

Reviewed: 2026-07-22

Status: submission materials prepared; access strategy remains open

## Confirmed evidence

- **Confirmed:** the deployed product demonstrates PNG/JPEG → automatic
  analysis → full/limited/reject → `.limg` → separate Viewer.
- **Confirmed:** Runtime playback exposes blink, gaze, mouth, breath, named
  reactions, and deterministic showcase behavior through the same normalized
  API. Playback does not perform per-frame model inference.
- **Confirmed:** unsupported input produces no character file and displays a
  prominent reason and retry path.
- **Confirmed:** Compiler → Viewer uses an atomic one-time browser-local handoff
  with no second upload; `.limg` download remains the durable fallback.
- **Confirmed:** project-owned success and reject fixtures exist in
  `fixtures/source/` and can be used in the submission without relying on
  ignored hold-out media.

## Submission risks

- **Open / P0:** the production hostname is protected by Cloudflare Access. The
  existing two-hour review mode is safe only for a known supervised window and
  is not an asynchronous judging solution.
- **Open / P0:** the hosted UI does not currently bundle a known-good input.
  The submission must attach/link the project fixture or add an explicitly
  approved demo-sample path.
- **Open / P0:** a broadly anonymous Compiler still lacks rate limiting,
  Turnstile, and a tested cost/abuse budget. Do not leave review mode public.
- **Confirmed / P1:** the private Cloudflare evidence measured approximately
  29.1 seconds on first use and 4.6 seconds warm for the reviewed input. These
  measurements are evidence, not a service-level guarantee.
- **Open / P1:** detector model cards label code/weights MIT, but training-data
  provenance is not sufficient to claim the complete path is commercially
  cleared.

## Communication decisions

- **Decision:** lead with “compile once into a reusable character asset,” not
  video generation.
- **Decision:** describe the supported envelope as near-frontal anime portraits;
  never claim arbitrary-image, Live2D-equivalent, or commercial-quality support.
- **Decision:** use “local, offline, deterministic, model-free” only for Runtime
  playback. Hosted compilation sends the selected image to the Compiler.
- **Decision:** show both a successful compile and an explicit safe reject in
  the judging video.
- **Decision:** use external screen recording for the final narrated MP4. The
  app's built-in recording is a silent character Canvas WebM demonstration.

## Prepared artifacts

- [`../submission/README.md`](../submission/README.md)
- [`../submission/form-copy.md`](../submission/form-copy.md)
- [`../submission/video-script-ja.md`](../submission/video-script-ja.md)
- [`../submission/recording-runbook.md`](../submission/recording-runbook.md)
- [`../submission/reviewer-guide.md`](../submission/reviewer-guide.md)
- [`../submission/final-checklist.md`](../submission/final-checklist.md)

This phase adds documentation only. It introduces no dependency, model, asset,
or new licensing surface.
