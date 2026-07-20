# Hold-out A closed-eye audit protocol

Date: 2026-07-20

Status: pre-registered before corrective endpoint review

## Purpose

Audit Compiler 0.8's closed-eye corrective on the already-opened independent
licensed hold-out A without treating this set as fresh calibration data.

## Contamination boundary

- **Confirmed:** Hold-out A was first opened for earlier Compiler and motion
  work. Its five images and prior outcomes are no longer unseen.
- **Decision:** This audit is report-only. It must not select a fit-residual,
  coverage, retained-sample, or colour-distance threshold.
- **Decision:** Do not change source files, expectations, detector thresholds,
  corrective constants, or quality policy in response to this audit.
- **Decision:** A future production gate still requires a newly frozen hold-out
  B whose expected endpoint review is registered before Compiler execution.

## Frozen material

Use the five exact source hashes in `fixtures/holdout/manifest.json` and the
Compiler 0.8 artifacts currently bound by `fixtures/holdout/report.json`.

Only `stevenburrow-sample1` currently has blink enabled. The other four cases
must be shown as skipped according to their actual Compiler 0.8 capability
partition; they must not be forced through the corrected Runtime.

## Automated gates

- Every source and `.limg` hash matches the checked report.
- Every artifact identifies Compiler `0.8.0` and contains the exact actual
  quality status/capability partition in the report.
- `semantic-mesh-corrective-required` loads all five without render, console,
  page, or external-request errors.
- Disabled controls render explicit skipped cells.
- For every blink-enabled case, blink `0.5`, blink `1.0`, and both winks are
  visible, remain inside the compiler-authored ROI, preserve protected cores,
  and render zero iris-texture pixels at full close.
- Neutral and reopened frames remain pixel-identical.

## Visual gate

Review full-resolution neutral, blink `0.5`, blink `1.0`, and both winks for
each blink-enabled case. Record, without tuning:

- whether full close reads as a closed eyelid;
- solid fill, halo, seam, duplicated iris, or source-line erasure;
- whether partial close connects plausibly to full close;
- whether the opposite eye remains unchanged in a wink.

## Media and licensing

- **Confirmed:** Hold-out provenance and exact upstream licenses are recorded in
  [`../holdout-assets.md`](../holdout-assets.md) and
  `fixtures/holdout/ATTRIBUTION.md`.
- **Decision:** Source-derived PNG captures stay local and ignored. Checked
  research stores hashes and observations only.
- **Decision:** No dependency, model, weight, or redistributed sample is added,
  so the third-party license inventory does not change.
