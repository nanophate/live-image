# Closed-eye corrective v2 protocol

Date: 2026-07-20

Status: pre-registered before v2 implementation

Failed v1:
[`2026-07-20-closed-eye-corrective-v1-first-run.md`](2026-07-20-closed-eye-corrective-v1-first-run.md)

## Single change

- **Decision:** Keep the frozen six cases, semantic mesh, Runtime blend,
  corrective alpha geometry, closed-lid curve, quality thresholds, and all
  existing automated/visual gates unchanged.
- **Decision:** Replace Telea aperture inpainting with a robust affine BGR skin
  plane fitted only from low-edge pixels above and below the eye.
- **Decision:** The fit excludes the eye polygon expanded by 20% of eye height,
  the existing protected mask, and one-pixel-dilated Canny edges.
- **Decision:** Require at least `max(48, 0.20 * aperturePixels)` retained
  samples, at least 25% below-eye samples, and horizontal support spanning 65%
  of eye width. Otherwise omit the corrective.
- **Decision:** Fit `colour = a + bx + cy` independently for B/G/R, discard
  residual outliers above median plus three MADs, and refit once.
- **Decision:** Record retained sample count and median BGR residual in the
  `.limg`. Do not call this a calibrated confidence score.
- **Decision:** The opaque correction mask no longer subtracts connected eye
  edges. The existing protected line-art overlay remains the final draw step;
  visual review of `glasses-round` is the required check for this tradeoff.

## Promotion boundary

The v1 protocol's hard and visual gates remain binding. In particular, a clean
skin fill that erases glasses/hair, looks like a flat sticker, or ghosts during
partial blink is still a failed result. No per-case tuning is allowed after the
first v2 captures.

## License and provenance

- **Confirmed:** This changes only project-authored deterministic math over
  existing pixels and uses no new dependency, model, weight, or asset.
