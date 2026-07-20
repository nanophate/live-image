# Closed-eye corrective v1 protocol

Date: 2026-07-20

Status: pre-registered before implementation

Parent failed baseline:
[`2026-07-20-semantic-mesh-v1-visual-review.md`](2026-07-20-semantic-mesh-v1-visual-review.md)

## Question

Can one compiler-authored, deterministic closed-eye layer repair the unreadable
full-blink endpoint without changing automatic detection, adding a model, or
disturbing unrelated line art?

## Frozen inputs and controls

- **Decision:** Reuse the exact six source hashes and capability contracts in
  `fixtures/validation/semantic-mesh-v1.manifest.json`.
- **Decision:** Do not change detector thresholds, landmark interpretation,
  iris extraction, quality gates, source media, or image-specific parameters.
- **Decision:** Keep `row-grid` as the default and preserve
  `semantic-mesh-required` as the immutable failed visual baseline.
- **Decision:** Expose the corrective only through a separately named explicit
  comparison mode. Missing or malformed corrective data must fail closed.
- **Decision:** Derive the layer only from the detected eye polygon, existing
  deformation region, source pixels, and deterministic OpenCV operations.

## Candidate

For each eye whose existing blink/gaze path is otherwise accepted:

1. Dilate the detected eye polygon by one small scale-relative radius.
2. Protect long edge components connected to the deformation-region boundary,
   because they may be glasses or hair rather than eye texture.
3. Inpaint the remaining aperture mask from surrounding source pixels.
4. Draw one source-colour closed-lid curve between the detected eye corners,
   with its centre derived from the existing compiler close centre.
5. Encode one transparent RGBA corrective in deformation-region coordinates.
6. Blend it only in the final part of blink closure with a fixed global curve.

No generated image, learned completion, per-frame analysis, or per-image tuning
is allowed.

## Hard automated gates

- Existing six-case statuses and enabled/disabled capabilities remain exact.
- Existing schema, locality, protected-core, iris, no-external-request, and
  pixel-exact reopen gates continue to pass.
- Corrective dimensions match the eye deformation region and its alpha is
  nonempty but does not touch the region boundary.
- All encoded values are finite and the activation range is fixed in schema.
- Blink `0` renders no corrective pixels; blink `1` renders a nonempty
  corrective for every supported eye.
- Neutral and reopened frames remain pixel-identical to the source render.
- The corrective adds no pixels outside the existing eye region allowance.
- The Browser must throw in the corrective-required mode when a required layer
  is absent or malformed; it must not silently use the failed baseline.

## Visual promotion gate

Paired full-resolution captures are reviewed at neutral, blink `0.5`, blink
`1.0`, and both winks for `clean-teal`, `dark-iris-navy`, and `glasses-round`.

Promotion requires all of the following:

- full close reads as a closed eyelid rather than a dark cavity;
- no obvious solid-colour sticker, halo, triangle seam, or duplicated iris;
- glasses and hair lines crossing or bordering the eye are not erased;
- partial closure remains continuous with the uncorrected mesh;
- the opposite eye and pixels outside the eye ROI remain unchanged during a
  wink.

**Decision:** Automated success without this visual gate is recorded as a
failed experiment, not a natural-blink result.

## License and provenance

- **Confirmed:** The candidate uses only project-authored code, existing source
  pixels, automatic detector output, NumPy, and the already-recorded OpenCV
  dependency.
- **Decision:** No new entry is needed in `research/license-matrix.md` or
  `THIRD_PARTY_NOTICES.md` unless implementation introduces another artifact or
  dependency.
