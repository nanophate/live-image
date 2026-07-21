# Product Studio and recording validation

Date: 2026-07-20

Branch: `codex/product-demo-recording`

Protocol: [`../product-studio-and-recording.md`](../product-studio-and-recording.md)

The final commit SHA is recorded in [`../progress.md`](../progress.md). The
verified environment used Node 24.18.0; `package-lock.json` SHA-256 was
`6a2e519cff2af8831f9d8d9c36d4f344936ce9b1f8d62e24cfe47538bb744a8e`, and
`requirements/compiler.txt` SHA-256 was
`5097c4d5590f37cbc250771a0e341b32bbff90bc15f2fd8ecc383259d9e7ef13`.

## Scope

Validate the first product-oriented flow without changing detector thresholds,
model weights, sample images, or the `.limg` quality policy:

```text
local PNG → automatic compile → full / limited / reject
          → downloadable .limg → same-page Runtime review → local WebM
```

## Preserved implementation failures

- **Confirmed:** the first TypeScript run passed 48/50 tests. The new mouth
  envelope assertion sampled too sparsely to hit its deterministic peak, and
  the showcase returned negative zero for the final gaze Y value. The tests
  exposed representation/test-sampling defects; dense samples and exact neutral
  normalisation fixed them without changing capability policy.
- **Confirmed:** the first local reject UI test failed because the initial sample
  player's cached capabilities re-enabled the Demo button after a new PNG was
  rejected. Capability controls now require a current compiled manifest, not
  merely a previously loaded Runtime asset. The unchanged test then passed.
- **Confirmed:** final review found that a declared media type and byte limit
  alone did not prevent compressed oversized images or mislabeled image bytes
  from reaching OpenCV/model loading. PNG/JPEG signatures and header dimensions
  are now checked before detector initialisation; decoded CLI images are checked
  again against the Runtime's 8192px/33,554,432-pixel limit.
- **Confirmed:** final review also found that the documented localhost boundary
  was weakened by a general `--host` option. The option was removed; the server
  binds to `127.0.0.1` and rejects non-local Host headers.
- **Confirmed:** the first exact-neutral browser assertion failed because its
  baseline was captured immediately after disabling idle and therefore retained
  a preceding smoothed breath frame. The test now explicitly resets before
  establishing its baseline. Runtime `resetToNeutral()` synchronously clears
  manual, reaction, and rendered history; recording calls it before
  `MediaRecorder.start()` and at showcase completion.

## Real compiler results

The local server ran with `nodenv exec npm run studio:offline` on
`127.0.0.1:8787`, using already-cached reviewed detector weights.

### Supported input

- **Confirmed:** `fixtures/source/teal-librarian.png` returned HTTP 200.
- **Confirmed:** the returned manifest was Compiler 0.8, status `full`, quality
  score `0.947`, with blink, gaze, mouth, and breath enabled.
- **Confirmed:** its YOLOv3 model SHA-256 was
  `23bbc708146bcbc1c910f00fe152adbc70d7658d875a0121eaf4ee61d978b2c4`;
  HRNetV2 was
  `e71271376406a743c01528a0460637fcc06e72aeeea583f85007cc72dc8b7a4a`.
- **Confirmed:** the generated `teal-product-check.limg` was 2.4 MiB and had
  SHA-256 `74a9dd277a834c15bb6c094128f0f2ef7d4d69d4c285fa4c1ca70381eb392678`.
- **Confirmed:** an actual browser upload produced a visible full result,
  downloadable `.limg`, and immediately ran the shared 6.4-second showcase.

### Unsupported input

- **Confirmed:** `fixtures/source/unsupported-no-face.png` returned HTTP 422.
- **Confirmed:** the response contained only status `reject`, the reason
  `no near-frontal anime face detected`, and an empty warning list. It exposed
  no local machine path and no `.limg` payload.
- **Confirmed:** the reason-only diagnostic had SHA-256
  `81a1b1f01103d77e380a14e66fc390498db526abfbbe9ed137d8012e47d88262`.
- **Confirmed:** the actual Viewer showed `Not supported · no character file
  created`, hid the character download, and disabled Demo and Record.

## Browser review and recording

- **Confirmed:** Chromium loaded a real automatically compiled rig and invoked
  capability-gated blink, deterministic showcase, and Canvas recording.
- **Confirmed:** the showcase returned progress and all continuous controls to
  exact neutral.
- **Confirmed:** `captureStream()` + `MediaRecorder` produced a non-empty WebM
  file of 899,364 bytes with SHA-256
  `fbf21a56e5d69eb8345da4bc576c2c408166ee339f1e54a7d99a0ca9818d1a11`.
  The recording requested no microphone and stopped every capture track.
- **Confirmed:** the local Studio showcase screenshot had SHA-256
  `db64cd877974121bbab567f3cb29ff608e9fd04a83161d19037b6a23e07a1263`.
  Generated video, screenshot, compiled asset, and upload diagnostics remain
  local/ignored; only hashes and results are tracked.

## Automated result

- **Confirmed:** TypeScript: 51/51 passed, including a MediaRecorder failure
  path that settles the recorder and stops tracks before preserving the original
  showcase error.
- **Confirmed:** targeted local Studio browser: 2/2 passed after the preserved
  reject-state failure above.
- **Confirmed:** targeted product Viewer recording browser: 1/1 passed.
- **Confirmed:** Python: 39/39 passed, including signature/dimension/Host gates,
  detector-cache reuse, and the shared decoded-dimension recheck before
  detection.
- **Confirmed:** full Chromium suite: 11 passed, 2 local-only tests skipped in
  2.1 minutes. The run includes all prior row-grid, semantic mesh, corrective,
  iris, protected-line, locality, transparent-source, and exact recovery gates,
  plus the new product Viewer recording test.
- **Confirmed:** the two skipped localhost-compiler cases were run separately
  against the actual offline Studio and passed 2/2. They intentionally require
  an explicit `LIVING_IMAGE_STUDIO_URL` so the ordinary browser suite does not
  launch or download detector models.
- **Confirmed:** `nodenv exec npm run build` passed with Node 24.18.0.
- **Confirmed:** live HTTP fault checks returned 415 for PNG bytes declared as
  JPEG and 421 for a non-local Host header; neither reached compilation.

Replay the actual local Compiler/Viewer boundary in two terminals after the
detector weights and validation fixtures are available:

```bash
# Terminal 1
nodenv exec npm run studio:offline

# Terminal 2
LIVING_IMAGE_STUDIO_URL=http://127.0.0.1:8787 \
  nodenv exec npx playwright test tests/browser/studio-compile-local.spec.ts
```

## Licensing and release boundary

- **Confirmed:** no dependency, model, weight, data, sample-media, or transitive
  runtime surface was added. `THIRD_PARTY_NOTICES.md` and the license matrix do
  not need a new entry for this change.
- **Decision:** recorded media is a derivative of the user's source artwork.
  The project MIT license does not grant rights to that artwork; users remain
  responsible for source and output rights.
- **Open:** only Chromium recording is verified. Other browsers remain
  feature-detected and cannot be advertised as confirmed.
- **Open:** this localhost-only tool is not hardened or licensed as a hosted
  multi-tenant compiler service.
