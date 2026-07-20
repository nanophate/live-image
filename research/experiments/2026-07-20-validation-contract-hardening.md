# Validation source and capability contract hardening

Date: **2026-07-20**

## Outcome

**Confirmed.** The public 12-image calibration manifest now pins the SHA-256 of
every source image and the exact expected enabled/disabled motion capabilities.
The validation runner already supported both checks; this checkpoint applies
them to every real case rather than checking only `full` / `limited` status.

**Confirmed locally.** Running
`nodenv exec npm run validate:fixtures:offline` with Compiler 0.4.0 completed all
12 automatic detections with:

- 12/12 source hashes verified;
- 12/12 expected quality statuses matched;
- 12/12 exact `blink`, `gaze`, and `mouth` capability partitions matched;
- 7 `full`, 5 `limited`, 0 `reject`, and 0 `error` outcomes.

**Confirmed locally.** `nodenv exec npm run test:py` completed 27/27 tests. A
repository-level test now loads the tracked manifest and report, verifies every
source hash, requires an explicit capability contract for every case, and
checks that the tracked result still matches that contract.

## Why this matters

**Decision.** Treat a wrong capability partition as a validation failure even
when the top-level status is unchanged. For example, an occluded-eye input that
remains `limited` but accidentally re-enables gaze is not a successful
regression result.

**Decision.** Treat source-image integrity as part of the experiment contract.
A changed PNG must fail before the detector runs instead of silently producing
a different report under the same case ID.

**Confirmed.** The exact contract is stored in
[`../../fixtures/validation/manifest.json`](../../fixtures/validation/manifest.json),
and the reproduced output is stored in
[`../../fixtures/validation/report.json`](../../fixtures/validation/report.json).

## Claim boundary

**Decision.** This remains a calibration/regression suite, not an independent
generalisation score. The capability contract was made explicit after the
suite had already informed earlier quality thresholds; it must not be described
as a newly pre-registered hold-out result.

**Confirmed.** External hold-out A remains frozen and currently matches 2/5
expected cases under Compiler 0.4.0. Its strong-highlight and one-eye-closed
failures are safe-side rejection/degradation; its painted-portrait acceptance
remains an unsafe support-domain failure.

## Next action

**Decision.** Do not tune a production threshold from hold-out A. Add the
pre-registered deterministic support-domain descriptors as a report-only probe,
calibrate them on a separate rights-cleared set, freeze the rule, and only then
run a new unseen hold-out B.

**Open.** Iris-crossing occlusion, local effective eye resolution, and mouth-line
shape evidence need explicit metrics. Detector confidence alone cannot separate
the accepted painted portrait from safe anime inputs.
