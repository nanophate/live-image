# Product Studio, Runtime reactions, and review recording

Reviewed: 2026-07-20

Status: implementation decision for the first product-oriented local flow

## Product objective

Turn the existing pieces into one honest path:

```text
PNG selected locally
→ compiler returns full / limited / reject with reasons
→ the returned full or limited .limg payload is immediately loaded
→ the same payload remains downloadable as a portable character file
→ normalised state and named reaction APIs drive it
→ an automatic showcase can be reviewed or recorded
```

## Current gap

- **Confirmed:** the Python Compiler already emits `.limg`, limited capability
  metadata, or a reject diagnostic, but only through a command-line entrypoint.
- **Confirmed:** the separate Viewer loads `.limg` and exposes normalised state
  sliders, but it cannot accept PNG input and defaults to the older row-grid eye
  renderer.
- **Confirmed:** blink is the only named Runtime reaction. The mouth pulse is a
  Viewer-only timer and therefore cannot be invoked through the common API.
- **Confirmed:** fixed comparison screenshots exist, but the product Viewer has
  no deterministic showcase or downloadable motion recording.

## Decisions

### Local Compiler Studio

- **Decision:** add a Python-standard-library Studio server. It binds to
  `127.0.0.1`, serves the built app, and accepts raw PNG/JPEG bytes only at one
  local `/api/compile` endpoint.
- **Decision:** images never need to leave the machine. A first uncached run may
  still download the separately reviewed detector weights unless the server is
  started with `--offline`; the UI and documentation must not imply otherwise.
- **Decision:** cap uploads, normalise untrusted filenames, use a temporary
  directory, return no machine paths, and process requests serially. Validate
  the declared PNG/JPEG signature and header dimensions before model loading,
  then recheck decoded dimensions in the shared CLI compiler. Cache the loaded
  detector runtime inside the server process so subsequent compiles do not
  reload both models.
- **Decision:** bind only to `127.0.0.1` and reject non-local `Host` headers.
  This product slice is not an unauthenticated LAN or hosted compiler.
- **Decision:** return HTTP 422 and a reason-only diagnostic for unsupported
  images. Do not produce or animate a `.limg` for a reject result.
- **Decision:** a limited result remains downloadable and playable, with every
  disabled control visibly unavailable.
- **Decision:** keep direct `.limg` loading in the same Viewer. Static hosting
  remains a valid offline player even when the local compile endpoint is absent.

### Runtime API

- **Decision:** retain `setState()` as the normalised continuous-state API and
  add capability introspection plus a small named reaction API for `blink`,
  `talk`, and directional looks.
- **Decision:** named reactions are deterministic functions of Runtime elapsed
  time and pass through the existing capability gate. A rejected or disabled
  reaction returns `false` rather than appearing to succeed.
- **Decision:** add a `best-available` eye mode for product surfaces. It uses the
  compiler-authored semantic mesh and closed-eye corrective when present, then
  falls back per eye to the compatible path. Existing explicit required modes
  and the Runtime's row-grid default remain unchanged for compatibility/tests.

### Showcase and video

- **Confirmed:** W3C's *Media Capture from DOM Elements* draft defines
  `HTMLCanvasElement.captureStream()` and notes that consumers may not preserve
  alpha. It also requires capture to stop/mute if the canvas becomes non-origin
  clean. Source: <https://www.w3.org/TR/mediacapture-fromelement/>.
- **Confirmed:** W3C's *MediaStream Recording* draft defines `MediaRecorder`,
  data chunks, `stop()`, and MIME selection; it also warns that recording can
  fail from resource constraints even when a type appears supported. The 2026
  draft marks `isTypeSupported()` as legacy, so this implementation uses it
  only to order candidates and still treats constructor/output success as the
  authority. Source: <https://www.w3.org/TR/mediastream-recording/>.
- **Decision:** record only the local origin-clean character Canvas, without
  microphone/audio permission. Use a short bounded showcase, stop every capture
  track, and reject empty output.
- **Decision:** feature-detect capture and recording, try WebM VP9/VP8/plain
  WebM in order, catch constructor/encoding failure, and hide no limitation.
  Do not bundle FFmpeg or add a runtime dependency.
- **Decision:** recordings use an opaque Canvas, because the current Runtime is
  opaque and the capture specification does not guarantee alpha preservation.
- **Decision:** the showcase adapts to the compiled capability set: unavailable
  blink, gaze, or mouth segments become neutral rather than bypassing gates.

## Licensing and provenance

- **Confirmed:** this phase adds no third-party code, package, model, weight,
  dataset, or media asset. It uses browser APIs and Python/Node standard-library
  facilities around the existing reviewed compiler/runtime.
- **Decision:** no license-matrix or third-party-notice entry is required for
  the implementation itself. The existing detector/model provenance boundary
  remains unchanged.
- **Decision:** recorded videos are user-generated derivatives of the supplied
  source image. The UI should remind users that they need the necessary rights;
  it must not claim that the project license grants rights to character art.

## Acceptance gate

- PNG/JPEG upload either yields a downloadable, immediately playable full or
  limited `.limg`, or a visible reason-only reject without motion.
- A second compile in one server process reuses the detector runtime.
- Viewer controls exactly follow the artifact's enabled capabilities.
- `setState()` and every named reaction have deterministic tests and cannot
  bypass reject/disabled gates.
- The automatic showcase completes and returns to neutral.
- Supported Chromium records a non-empty local WebM from the showcase; missing
  APIs produce an explicit unavailable state.
- Existing `.limg`, comparison, Inspector, and validation paths keep passing.

## Open boundary

- **Open:** the standard recording documents are Working Drafts, not stable
  cross-browser guarantees. Chromium is the first verified recording target;
  other browsers remain feature-detected until tested.
- **Open:** this local Studio is not a hosted multi-user compiler service. A
  remote service would require separate authentication, isolation, abuse,
  storage, cost, privacy, and model-redistribution decisions.

## Compiler feedback update — 2026-07-21

- **Decision:** the dedicated Compiler page shows a centered loading card as
  soon as image processing begins. It uses an indeterminate animated bar and
  elapsed seconds rather than a fabricated completion percentage because the
  current synchronous Compiler API exposes no stage progress.
- **Decision:** loading copy names the actual broad work—face, eye, mouth
  analysis and character-file construction—and notes that the first model load
  can take longer.
- **Decision:** HTTP 422 is presented as `This image isn’t supported yet`,
  `not supported`, and `no file created`. Detector reasons remain visible,
  but internal status language such as `reject` is no longer the primary
  product message.
- **Decision:** reduced-motion users receive a static full progress track
  instead of the sliding animation.
- **Confirmed:** the loading layer is always removed through the compile
  `finally` path on success, unsupported input, network/API failure, or source
  preview failure.
- **Confirmed:** the focused Chromium product suite proves that the loading
  layer and progressbar are visible during a delayed compile, elapsed time
  appears, unsupported copy and detector reasons replace it, and the loading
  layer becomes hidden.
- **Confirmed:** the complete Chromium suite remains green with 15 passes and
  2 documented local-artifact skips after the feedback change.
- **Confirmed:** this UI adds no dependency, asset, or license/provenance
  surface. Existing license records and third-party notices remain unchanged.
- **Confirmed:** private mode was deployed as Worker version
  `d6008795-32ef-4cb0-a7fd-7d61756c6979`. The authenticated production
  `/compiler.html` served the new loading copy, hidden initial state, and
  non-live elapsed timer while keeping hosted compilation and origin JWT
  verification enabled. No source image was uploaded for this static delivery
  check.

### Unsupported-result prominence — 2026-07-21

- **Decision:** an unsupported compile is no longer communicated primarily by
  the small stage badge or a diagnostic card low in the control column. The
  Compiler places a high-contrast result card over the source preview so the
  outcome is visible at the user's current point of attention.
- **Decision:** the prominent card groups the outcome, `No character file
  created`, supported-image guidance, detector reasons, and a `Try another
  image` action. The detailed diagnostic remains in the control column for
  review and debugging.
- **Decision:** the result uses an alert region and receives programmatic focus
  when it appears. Starting another compile hides it and clears prior detector
  messages. Loading a valid character by any path also clears stale rejection
  state.
- **Decision:** the centered result card has a bounded height and internal
  scrolling so long detector output cannot push the retry action outside a
  small viewport.
- **Confirmed:** detector messages are inserted with `textContent`, not HTML,
  so a compiler-supplied message cannot inject markup into the result card.
- **Confirmed:** the focused product browser suite exercises a delayed 422 and
  verifies the centered result, headline, file outcome, detector reason, and
  retry action. A 390×667 viewport with 13 detector messages also verifies that
  the card remains bounded, becomes internally scrollable, and keeps the retry
  action reachable. All 5 focused Chromium checks pass.
- **Confirmed:** this presentation change adds no dependency, asset, model, or
  license/provenance surface.
