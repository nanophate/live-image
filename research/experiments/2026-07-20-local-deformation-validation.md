# Compiler-authored local deformation validation

Review date: **2026-07-20**

## Question

Can the existing automatic detector drive a more local blink and mouth motion
without adding per-image runtime branches, a learned runtime dependency, or
manual rigging?

## Implementation under test

**Decision.** Compiler `0.3.0` adds optional data to `.limg` version 1. Older
version-1 files remain playable through the prior runtime fallback.

- Each eye stores six compiler-authored Y rows, its full-close rows, per-row
  gaze weights, and a fixed-boundary piecewise-affine method identifier.
- OpenCV Canny, connected components, dilation, and a one-pixel feather produce
  an embedded protected-line alpha mask. The original source pixels under that
  mask are restored after the warp. The detected eye aperture and an expanded
  active margin are explicitly excluded from protection.
- The mouth stores narrow upper/lower source bands, bounded travel, cavity
  geometry, sampled dark colour, and line contrast. Runtime moves only those
  bands instead of vertically resampling the entire rectangular mouth region.
- Runtime does no feature analysis per frame. It only interpolates values
  stored by the compiler. Feature patch boundaries remain fixed.

**Confirmed.** No dependency, checkpoint, dataset, or sample image was added.
The mask pipeline uses the already-pinned
`opencv-python-headless==4.10.0.84`; the web runtime remains project-authored
Canvas 2D/TypeScript. The licensing inventory therefore needs no new shipped
artifact row.

## Automated results

Environment:

- nodenv Node `24.18.0`, npm `11.16.0`;
- Python `3.12` project virtual environment;
- Compiler `0.3.0`, cached detector weights, offline mode;
- browser runtime at `127.0.0.1`, Canvas 2D.

**Confirmed.** The final unit/build run passed:

- TypeScript: `20/20` tests;
- Python: `22/22` tests;
- `npm run build`: passed;
- JSON schema parsed successfully.

The tests cover legacy fallback, fixed outer rows, strict row ordering across
blink samples, gaze-row weights, bounded mouth-band translation, optional
schema validation, protected-mask PNG generation, a zero-alpha requirement at
the automatically detected pupil centre, exact capability contracts, mouth-line
confidence gating, and atomic player load failure.

**Confirmed.** All 19 locally generated `.limg` artifacts (two primary, 12
matrix, and five hold-out) pass the executable runtime validator. Malformed
feature ranges, duplicate eye sides, over-limit declared image dimensions, and
decoded source-image dimension mismatches are rejected before Canvas sizing or
deformation. The current bounds are 8192 pixels per side and 33,554,432 total
pixels.

**Confirmed.** Recompiling the two primary fixtures offline retained `full`
status with scores `0.955` and `0.947`.

**Confirmed.** The 12-image automatic-detection matrix retained all frozen
expected status outcomes: `12/12`. Across accepted and capability-limited
matrix assets, the final protected-mask coverage ranged from `0.1815` to
`0.5216` of each padded eye ROI. This range is a recorded implementation
measurement, not a calibrated quality threshold.

**Confirmed.** The five local licensed hold-out inputs passed their frozen
SHA-256 preflight. The result intentionally remained `3/5`:

- both expected `full` inputs retained blink, gaze, and mouth;
- the too-small face remained rejected;
- the one-eye-closed case remained a safe-side reject rather than the expected
  mouth-only limited result;
- the semi-realistic painted input remained incorrectly limited with blink and
  mouth enabled.

Capability expectations are now enforced by the validation runner rather than
merely displayed in the manifest. The two known mismatches were not used to
change detector or deformation thresholds.

## Manual browser review and recorded failure

This section records a repeatable local Compare Viewer inspection, not a CI
browser test. The Viewer calculates the stated pixel evidence from the actual
`LivingImagePlayer` Canvas after mask PNG decoding and compositing.

**Confirmed failure.** The first mask implementation removed only a narrow
eyelid-line corridor from protection. Iris edges were then misclassified as
unrelated line art and restored over the full-close warp, making a closed eye
look partly open. This failed visual result was not hidden.

**Decision.** The final mask excludes the entire filled landmark aperture plus
an `0.18 * eyeHeight` compile-time margin. Boundary-connected line components
are still eligible for protection only outside that active eye area. A
synthetic regression test decodes the emitted PNG and requires zero protection
alpha at the detected pupil centre.

**Confirmed.** After that correction, browser comparison covered:

- the two primary fixtures;
- dark and light irises;
- round glasses;
- a hair-occluded eye with blink correctly skipped;
- two independent external `full` inputs, including a strong-highlight case;
- the known outside-domain painted case, without treating it as valid evidence
  for the supported domain.

Every available inspected blink transition reported full-resolution
open-to-reopened equality of `0` differing pixels and maximum channel delta
`0`. Rejected or disabled controls were visibly skipped. Browser console review
reported no warnings or errors.

**Inference.** The denser fixed-boundary rows reduce broad patch compression,
and the mouth bands reduce surrounding-skin resampling. The browser review did
not reveal the original pasted rectangular mouth motion at comparison scale.
This is positive engineering evidence, not a perceptual user study or proof
across arbitrary art.

## Remaining risks and next action

**Open.** The iris/highlight is still part of the deforming eye texture. The
active-aperture exclusion prevents the protection mask from reopening it, but
does not yet provide rigid iris/highlight geometry or true eyelid occlusion.

**Open.** Line-component classification can still miss an occluding bang or
glasses stroke wholly contained inside the active aperture. Current confidence
and asymmetry gates remain the safety path.

**Confirmed.** The tracked validation and hold-out reports now preserve compiler
identity, source/artifact SHA-256, capability outcomes, deformation method,
protected-mask coverage, and mouth-line measurements for each case.

**Open.** The protected-mask decode/composite path is manually exercised by the
Compare Viewer and its transactional failure path has a mocked Canvas unit test,
but there is not yet an automated headless-browser CI test. Frame hashes and
full-resolution locality metrics remain the next evidence gap.

**Decision.** The next visual-quality experiment should extract a rigid
iris/highlight layer only after its segmentation and inpaint boundary error can
be measured. Do not add TPS/MLS/ARAP first: they do not solve semantic
occlusion. In parallel, add full-resolution locality metrics for motion frames,
not only endpoint recovery.
