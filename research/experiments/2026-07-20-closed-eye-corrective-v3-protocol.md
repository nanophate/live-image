# Closed-eye corrective v3 protocol

Date: 2026-07-20

Status: pre-registered before v3 implementation

Failed v2:
[`2026-07-20-closed-eye-corrective-v2-first-run.md`](2026-07-20-closed-eye-corrective-v2-first-run.md)

## Single change

- **Decision:** Keep every v2 input, alpha, curve, blend, schema field, Runtime
  path, and acceptance gate unchanged.
- **Decision:** Fit from the valid below-eye band first. Add valid upper-band
  pixels only when its median BGR colour is within Euclidean distance `12` of
  the lower-band median.
- **Decision:** The lower band alone must meet the existing minimum sample and
  65% horizontal-span gates; no upper pixels may rescue an unsafe lower band.
- **Decision:** Record whether the upper band was included as
  `upperSamplesIncluded`. Do not tune the threshold per image.

The purpose is narrowly to test the coherent-contamination diagnosis. The same
three supported full-resolution frames remain the promotion gate.
