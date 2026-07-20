# Living Image research log

This folder is the evidence trail for implementation decisions. It separates
facts verified in primary sources or local experiments from recommendations and
open questions, so a later product or legal review can reproduce the reasoning.

## Documents

- [`related-work.md`](related-work.md) — what was examined and what transfers to this project
- [`detector-selection.md`](detector-selection.md) — detector decision, fallbacks, and confidence policy
- [`runtime-and-format.md`](runtime-and-format.md) — MVP renderer and `.limg` direction
- [`local-deformation.md`](local-deformation.md) — deterministic feature meshes, protected line art, and iris/highlight-preserving blink/gaze
- [`browser-visual-ci.md`](browser-visual-ci.md) — headless-browser options, minimal Canvas 2D CI decision, cost, compatibility, and license boundaries
- [`holdout-assets.md`](holdout-assets.md) — external test-image selection, authorship evidence, license obligations, and open provenance limits
- [`support-domain-gate.md`](support-domain-gate.md) — compile-time support gate options, separate license/provenance review, and the pre-registered next experiment
- [`license-matrix.md`](license-matrix.md) — code/model/data/sample-asset licensing separately tracked
- [`sources.md`](sources.md) — primary references and the exact claims checked
- [`experiments/2026-07-19-detector-baseline.md`](experiments/2026-07-19-detector-baseline.md) — first local detector measurements
- [`experiments/2026-07-19-animation-validation.md`](experiments/2026-07-19-animation-validation.md) — end-to-end browser and reject-path results
- [`experiments/2026-07-19-validation-matrix.md`](experiments/2026-07-19-validation-matrix.md) — 12-image detector matrix, preserved first-run failures, and quality gate v2
- [`experiments/2026-07-19-validation-before-quality-gate.json`](experiments/2026-07-19-validation-before-quality-gate.json) — raw 7/12 first-run evidence before gate changes
- [`experiments/2026-07-20-holdout-motion-validation.md`](experiments/2026-07-20-holdout-motion-validation.md) — independent licensed hold-out result and deterministic blink/gaze/mouth review
- [`experiments/2026-07-20-holdout-first-run.json`](experiments/2026-07-20-holdout-first-run.json) — unmodified 3/5 first-run evidence before any response to hold-out mismatches
- [`experiments/2026-07-20-blink-transition-validation.md`](experiments/2026-07-20-blink-transition-validation.md) — sequential close/reopen samples, capability skips, and pixel-exact recovery evidence
- [`experiments/2026-07-20-local-deformation-validation.md`](experiments/2026-07-20-local-deformation-validation.md) — compiler-authored eye mesh, protected-line mask, bounded mouth bands, reproduced mask failure, and multi-image results
- [`experiments/2026-07-20-browser-locality-validation.md`](experiments/2026-07-20-browser-locality-validation.md) — actual Chromium Canvas locality counts, endpoint recovery, fault-injection failure, CI dependency cost, and license evidence
- [`experiments/2026-07-20-eye-preservation-metrics.md`](experiments/2026-07-20-eye-preservation-metrics.md) — protected-core RGB invariance, clear-mask motion evidence, mask-bypass failure, current iris/highlight claim boundary, and DPR decision
- [`experiments/2026-07-20-iris-base-eye-validation.md`](experiments/2026-07-20-iris-base-eye-validation.md) — Compiler 0.4 rigid iris/highlight texture, Telea base eye, fail-closed gates, two-rig browser evidence, 12-image matrix, and hold-out result
- [`experiments/2026-07-20-validation-contract-hardening.md`](experiments/2026-07-20-validation-contract-hardening.md) — source SHA-256 and exact blink/gaze/mouth contracts for all 12 public validation cases
- [`progress.md`](progress.md) — implementation checkpoints and commit trail

## Evidence labels

- **Confirmed** — checked in a linked primary source or reproduced locally.
- **Decision** — an engineering choice for this repository, not a claim made by a source.
- **Inference** — a conclusion drawn from confirmed facts; validate during implementation.
- **Open** — unresolved and not safe to treat as confirmed.

The research snapshot date is **2026-07-20**. Dependency releases, model terms,
and remote files can change; re-check them before a public or commercial release.
