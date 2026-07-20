# Semantic mesh v1 first-run validation

Date: 2026-07-20

Protocol:
[`2026-07-20-semantic-mesh-v1-protocol.md`](2026-07-20-semantic-mesh-v1-protocol.md)

Raw summaries:
[`2026-07-20-semantic-mesh-v1-bounded-baseline.json`](2026-07-20-semantic-mesh-v1-bounded-baseline.json)
and
[`2026-07-20-semantic-mesh-v1-first-run.json`](2026-07-20-semantic-mesh-v1-first-run.json)

## What changed

- **Confirmed:** Compiler 0.5 emits an optional, explicit blink mesh for each
  eye: 42 source vertices, 60 triangles, one named `blink` field, per-vertex
  mobility weights, normalized maximum-displacement vectors, and an authored
  aperture loop.
- **Confirmed:** The topology is deterministic and adds no new library, model,
  weight, training data, or sample asset. Existing OpenCV analysis supplies the
  geometry and protected-line mask.
- **Confirmed:** Outer vertices are fixed. Inner mobility follows one common
  horizontal tent field and is reduced by the compiler-authored protected mask;
  there are no fixture-name branches or image-specific Runtime constants.
- **Confirmed:** Compiler preflight tests blink `0/.25/.5/.75/1`. TypeScript
  validation and Runtime planning independently reject invalid indices,
  inconsistent winding, or a triangle below 2% of its source signed area.
- **Decision:** The old `row-grid` renderer remains the default. The comparison
  UI must explicitly request `semantic-mesh-required`; a missing or invalid mesh
  is an error rather than a silent legacy fallback.
- **Decision:** Gaze continues to translate the rigid iris, mouth continues to
  use bounded disconnected bands, and breath remains a whole-character scale.
  This isolates the blink mesh instead of mixing four deformation changes.

## Frozen first run

The first candidate was compiled before any visual response using the six
source hashes and capability contracts in
`fixtures/validation/semantic-mesh-v1.manifest.json`.

| Case | Frozen role | Result | Disabled | Meshes |
| --- | --- | --- | --- | --- |
| clean-teal | supported | full | none | 2 x 42 vertices / 60 triangles |
| dark-iris-navy | supported | full | none | 2 x 42 / 60 |
| glasses-round | supported | full | none | 2 x 42 / 60 |
| light-iris-silver | difficult | limited | blink, gaze | 2 x 42 / 60, correctly unused |
| occluded-left-eye | difficult | limited | blink, gaze | 2 x 42 / 60, correctly unused |
| three-quarter | difficult | limited | blink | 2 x 42 / 60, correctly unused for blink |

- **Confirmed:** 6/6 status and capability contracts matched. The difficult
  cases did not gain capabilities.
- **Confirmed:** The lowest compiler-measured triangle area ratio was about
  `0.035`, above the pre-registered `0.02` hard floor. This small margin is a
  reason to keep the renderer experimental, not evidence of visual quality.
- **Confirmed:** The mesh metadata added between 8,639 and 8,712 bytes per
  `.limg` in the six cases. Embedded raster layers still dominate the total
  payload of roughly 2.3–2.6 MB.

## Browser result

Real Chromium ran the bounded and required-mesh modes on both tracked automatic
rigs, then ran required-mesh mode across the six local first-run artifacts.

- **Confirmed:** 3/3 browser tests passed.
- **Confirmed:** Neutral and sequential open -> reopened frames had zero
  differing full-resolution RGBA pixels.
- **Confirmed:** Every enabled state changed pixels inside its compiler-authored
  region, with zero changed pixels outside it.
- **Confirmed:** Protected eye cores had zero error pixels. Clear-mask pixels
  still moved.
- **Confirmed:** Iris radii remained invariant; gaze direction stayed correct;
  full blink/wink produced iris alpha zero and zero directly rendered iris
  texture pixels.
- **Confirmed:** The page made no external requests and reported no page or
  console errors.
- **Confirmed:** Gaze and mouth evidence was identical between modes, as expected
  from the isolated experiment.

In the two tracked rigs, semantic blink changed 13–17% fewer pixels than the
row-grid baseline:

| Rig / state | Bounded pixels | Semantic pixels | Delta |
| --- | ---: | ---: | ---: |
| teal / blink 0.5 | 37,179 | 30,787 | -17.19% |
| teal / blink 1 | 41,776 | 36,315 | -13.07% |
| copper / blink 0.5 | 29,611 | 24,763 | -16.37% |
| copper / blink 1 | 32,391 | 28,130 | -13.15% |

- **Inference:** The reduction is consistent with fixed boundaries and
  mask-aware mobility, so it may reduce broad patch motion.
- **Open:** Fewer changed pixels may instead mean an under-powered blink or
  visible triangle seams. It is not a quality win until paired frames are
  inspected.

## Generalisation and hold-out

- **Confirmed:** The full tracked validation matrix remained 12/12 expected
  outcomes (7 full, 5 limited) with Compiler 0.5 artifacts.
- **Confirmed:** The existing local hold-out remained 2/5 expected outcomes
  (1 full, 2 limited, 2 reject). The three known mismatches were not tuned away,
  and semantic mesh emission did not change their acceptance or capabilities.

## Current decision

**Decision:** Keep the explicit mesh in the optional version-one schema and keep
the comparison renderer available, but do not make it the default. The paired
review reproduced a failed full-close endpoint in both modes; see
[`2026-07-20-semantic-mesh-v1-visual-review.md`](2026-07-20-semantic-mesh-v1-visual-review.md).
Preserve this first run and test a separately named deterministic corrective
layer. Do not start face/head/hair Delaunay work until the blink representation
is accepted.

The Inspector draws every stored triangle and colors vertices by blink mobility,
so the automatic field can be inspected without editing landmarks or mesh data.
The subsequent endpoint work, including two preserved failed corrective methods
and the bounded v3 result, is recorded in
[`2026-07-20-closed-eye-corrective-v3-validation.md`](2026-07-20-closed-eye-corrective-v3-validation.md).
