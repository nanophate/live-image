# External hold-out A: detector and motion validation

Run date: **2026-07-20**

Frozen fixture commit: `457ac9ebb7c7983eb6692d3af749d09451315d2a`

Manifest SHA-256: `8c614b8640fe5831fa0b885c6bf6b01f69fce7cf57f5d4568aa098430d2fdc22`

## Protocol

**Decision.** Treat the five independently sourced images in
[`../../fixtures/holdout/`](../../fixtures/holdout/) as hold-out A. Their
expected quality outcomes and control capabilities were committed before the
first detector run. Do not tune thresholds or motion limits against this set
and then continue to call it unseen hold-out evidence.

**Decision.** Keep the source PNGs as ignored local test data rather than
redistributing them in Git. The tracked manifest, hashes, provenance, frozen raw
report, and reproduction instructions retain the evidence trail without
bundling third-party media.

**Confirmed.** The first run used Node 24.18.0 through the repository's nodenv
pin, Python 3.12.13, cached detector checkpoints, and the production batch
compiler path:

```bash
nodenv exec npm run validate:holdout:offline
```

The unmodified first report is preserved as
[`2026-07-20-holdout-first-run.json`](2026-07-20-holdout-first-run.json), with
SHA-256 `c4426a0912777638462177ce7d38f73e8f87dfb0a54960d4d80dbeb03fb2474b`.
It is byte-identical to the checked current report at this checkpoint.

## Automatic detection result

**Confirmed.** Three of five frozen expectations matched. There were no
compiler errors, and the actual outcome distribution remained two `full`, one
`limited`, and two `reject` cases.

| Case | Expected | Actual | Key evidence | Interpretation |
| --- | --- | --- | --- | --- |
| stevenburrow sample 1 | full | full | quality 0.8773; eye 0.8314; pupil 1.0000 | match |
| mcproject manga girl | full | full | quality 0.9138; eye 0.8342; pupil 1.0000 | match; strong highlights did not suppress gaze |
| Kitsuge casual avatar 00 | limited | reject | landmarks 0.2683; eye symmetry 0.4595 | mismatch, but safe-side rejection of a one-eye-closed input |
| Jupiter's Daughter maid | reject | reject | face scale 0.1835 | match; face is too small for stable local deformation |
| zonked painted portrait | reject | limited | quality 0.8503; pupil 0.6000; gaze disabled | mismatch; current gates do not enforce the anime-style domain |

**Inference.** The Kitsuge mismatch means the frozen expectation was too
optimistic for the current 28-point detector, rather than demonstrating an
unsafe animation. Rejecting the asset is preferable to applying a symmetric
eye rig to an intentionally closed eye.

**Confirmed.** The zonked mismatch is a real domain-gating weakness. Geometry
confidence alone allowed a semi-realistic painted face to become a `limited`
asset. The low pupil confidence correctly disabled gaze, but blink and mouth
remained enabled.

## Deterministic motion comparison

**Decision.** Add a separate `compare.html` Viewer rather than special-case the
demo. It accepts any number of `.limg` files and applies the same normalized
states to each asset. Automatic idle and breath are disabled; each state settles
for 30 fixed `1/60`-second steps before capture.

Acceptance states:

- blink `0.50` and `1.00`, plus independent left/right winks;
- gaze X `-0.60/+0.60` and gaze Y `-0.40/+0.40`;
- mouth `0.35` and `0.62`.

Stress-only states are gaze X `-1/+1` and mouth `1`. They are visually labelled
separately and are not used as the natural-motion acceptance target. Compiler
rejections and disabled capabilities are shown as skipped cells rather than
being forced through the runtime.

**Confirmed.** Browser rendering of all five compiled assets completed without
render exceptions or console warnings/errors:

| Asset | Quality | Rendered / total | Skipped by gate | Maximum normalized state error |
| --- | --- | ---: | --- | ---: |
| stevenburrow sample 1 | full | 14 / 14 | none | 0.0025 |
| mcproject manga girl | full | 14 / 14 | none | 0.0025 |
| Kitsuge casual avatar 00 | reject | 1 / 14 | all motion | 0.0000 |
| Jupiter's Daughter maid | reject | 1 / 14 | all motion | 0.0000 |
| zonked painted portrait | limited | 8 / 14 | all six gaze states | 0.0001 |

The acceptance tolerance was fixed at `0.005`; every rendered state stayed
within it.

## Visual review

**Confirmed.** At comparison-thumbnail resolution, both `full` assets showed
distinct half/full blinks, independent winks, bidirectional gaze, and small
mouth openings using the common runtime API. Blinks remained localized to the
eye regions, gaze did not deform the whole face, and the large iris highlights
in the mcproject image remained recognizable in open-eye states. No pasted-on
replacement drawing or face-wide jelly deformation was observed.

**Confirmed.** The two rejected assets rendered neutral reference images only;
all motion cells were visibly marked `skipped`. The painted `limited` case did
not render gaze, as required by its compiled capabilities. Its blink and mouth
states rendered without an exception, but successful rendering is not evidence
that the input belongs in the supported anime domain.

**Open.** This comparison is a fixed-state review, not yet a transition/video
review. It cannot rule out one-frame seams, reopening flicker, or temporal
highlight crushing. Full-resolution frame downloads are available in the
Viewer for human review, but redistributed captures retain the source-image
license obligations recorded in
[`../../fixtures/holdout/ATTRIBUTION.md`](../../fixtures/holdout/ATTRIBUTION.md).

**Confirmed follow-up.** A sequential close/reopen strip and pixel-exact open
endpoint comparison were subsequently added and checked in
[`2026-07-20-blink-transition-validation.md`](2026-07-20-blink-transition-validation.md).

## Action

**Decision.** Do not change detector thresholds from hold-out A. The next
compiler milestone should add an explicit support-domain/style gate or a
separate review signal, then evaluate that change on a newly frozen hold-out B.
Separately, add a deterministic transition capture so blink close/reopen and
gaze motion can be inspected across time rather than only at settled endpoints.
