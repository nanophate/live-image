# Semantic mesh v1 protocol

Pre-registered: 2026-07-20, before the candidate mesh representation or
renderer was implemented.

## Question

Can the current compiler-authored eye grid and bounded mouth bands be expressed
as a portable semantic triangle mesh and rendered from the same normalized API
without breaking source reconstruction, locality, eye protection, capability
gates, or deterministic neutral recovery?

This is a representation and rendering probe. It is not evidence that an
adaptive mesh improves motion quality until the fixed visual and numeric
comparison has been reviewed.

## Frozen cases

The exact six cases, source SHA-256 values, roles, statuses, and capability
contracts are stored in
`fixtures/validation/semantic-mesh-v1.manifest.json`.

- Supported: `clean-teal`, `dark-iris-navy`, `glasses-round`
- Difficult: `light-iris-silver`, `occluded-left-eye`, `three-quarter`

The local hold-out is excluded. It is not an independent mesh-quality set and
must not be used for tuning this first implementation.

## Frozen constraints

- Do not change a source image, detector, detector threshold, iris extraction
  rule, quality threshold, or capability contract between bounded and semantic
  modes.
- Do not add fixture-name branches or per-image Runtime constants.
- Use the same control samples and fixed-step settling in both modes.
- Disabled controls are skipped, not rendered and then presented as success.
- Preserve the first candidate run before responding to its failures.
- Source-derived `.limg` files and rendered frames stay in ignored local
  artifact directories. Checked-in reports contain hashes and numeric evidence,
  not duplicate source media.

## Fixed state samples

- Blink: `0`, `0.5`, `1`; left and right wink at `1`
- Gaze acceptance: X `-0.6`, `0.6`; Y `-0.4`, `0.4`
- Mouth acceptance: `0.35`, `0.62`
- Report-only stress: gaze X `-1`, `1`; mouth `1`
- Blink timeline: the Runtime's existing 11 close/reopen samples, including its
  exact peak and both neutral endpoints

## Hard gates

1. Every source hash and frozen capability partition matches.
2. Neutral canonical render and open-after-reopen differ by zero RGBA pixels.
3. Every enabled control visibly changes at least one pixel in its authored
   region and zero pixels outside it, allowing the existing one-pixel raster
   boundary when calculating the region.
4. Protected eye-core pixels have zero error pixels and maximum RGB delta at
   most one; clear-mask pixels visibly move.
5. Iris radii stay invariant, gaze translates in the requested direction, and
   the directly rendered iris layer has alpha zero and zero pixels at full
   blink/wink.
6. Every triangle keeps its source winding and at least 2% of its source signed
   area at blink `0/.25/.5/.75/1`, every gaze corner, and mouth
   `0/.35/.62/1`.
7. Browser rendering produces no console/page errors and no external requests.
8. A mesh topology failure disables that feature; it must not broaden motion or
   silently fall back to a face-wide warp.

## Report-only comparisons

- bounded-versus-semantic changed pixels in/out of the allowed region;
- protected-core errors and clear-mask changed pixels;
- directly rendered iris pixels and alpha across the blink timeline;
- triangle count, inversion count, and minimum signed-area ratio;
- `.limg` bytes and embedded-layer bytes;
- median and p95 fixed-step render time in one Chromium run;
- visual review for seams, face-jelly motion, crushed highlights, duplicate
  irises, pasted mouth appearance, and motion through hair/glasses.

These values must not be used alone to claim that one renderer is perceptually
better.

## Promotion rule

The first implementation may promote a generic mesh representation into the
version-one optional schema only if schema validation is fail-closed and the
existing bounded renderer remains the default. Runtime promotion requires all
hard gates plus paired visual evidence. Adaptive contour/edge vertex placement
is a later experiment; it must not be mixed into this representation baseline.
