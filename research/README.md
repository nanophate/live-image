# Living Image research log

This folder is the evidence trail for implementation decisions. It separates
facts verified in primary sources or local experiments from recommendations and
open questions, so a later product or legal review can reproduce the reasoning.

## Documents

- [`related-work.md`](related-work.md) — what was examined and what transfers to this project
- [`hugging-face-and-motion-landscape.md`](hugging-face-and-motion-landscape.md) — Hugging Face demos, closest compile-once precedents, license boundaries, and the next architecture experiment
- [`detector-selection.md`](detector-selection.md) — detector decision, fallbacks, and confidence policy
- [`runtime-and-format.md`](runtime-and-format.md) — MVP renderer and `.limg` direction
- [`product-studio-and-recording.md`](product-studio-and-recording.md) — local PNG-to-Viewer product flow, capability/reaction API, Canvas WebM review recording, and security/license boundary
- [`hosting-and-public-deployment.md`](hosting-and-public-deployment.md) — GitHub Pages, Cloudflare Pages/Workers/Containers, and Codex Sites feasibility, current deployment blockers, and staged public-release gates
- [`hosted-compiler-platforms.md`](hosted-compiler-platforms.md) — Cloudflare Container and Hugging Face Docker Space comparison, private-alpha gateway implementation, local validation, and deployment gates
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
- [`experiments/2026-07-20-support-domain-descriptor-probe.md`](experiments/2026-07-20-support-domain-descriptor-probe.md) — report-only OpenCV warp-support metrics, explicit contaminated hold-out replay, source/artifact binding, and reproduced false-positive boundaries
- [`experiments/2026-07-20-semantic-mesh-v1-protocol.md`](experiments/2026-07-20-semantic-mesh-v1-protocol.md) — frozen six-case bounded-versus-mesh protocol, exact capability contracts, hard geometry/locality gates, and promotion rule
- [`experiments/2026-07-20-semantic-mesh-v1-bounded-baseline.json`](experiments/2026-07-20-semantic-mesh-v1-bounded-baseline.json) — pre-implementation Compiler 0.4 artifact hashes, six-case capability result, and existing Canvas browser anchor
- [`experiments/2026-07-20-semantic-mesh-v1-first-run.json`](experiments/2026-07-20-semantic-mesh-v1-first-run.json) — immutable Compiler 0.5 six-case artifact hashes, topology floor, payload delta, and browser gate summary
- [`experiments/2026-07-20-semantic-mesh-v1-validation.md`](experiments/2026-07-20-semantic-mesh-v1-validation.md) — explicit blink mesh implementation, bounded A/B numbers, 12-image and hold-out outcomes, and visual-review boundary
- [`experiments/2026-07-20-semantic-mesh-v1-visual-review.md`](experiments/2026-07-20-semantic-mesh-v1-visual-review.md) — hashed local captures, the reproduced full-close visual failure, and the corrective-layer decision
- [`experiments/2026-07-20-closed-eye-corrective-v1-protocol.md`](experiments/2026-07-20-closed-eye-corrective-v1-protocol.md) — pre-registered deterministic skin-fill/eyelid endpoint experiment and visual promotion gate
- [`experiments/2026-07-20-closed-eye-corrective-v1-first-run.md`](experiments/2026-07-20-closed-eye-corrective-v1-first-run.md) — preserved Compiler 0.6 hashes and the reproduced Telea/open-eye visual failure
- [`experiments/2026-07-20-closed-eye-corrective-v2-protocol.md`](experiments/2026-07-20-closed-eye-corrective-v2-protocol.md) — pre-registered robust outside-eye affine skin-fit replacement
- [`experiments/2026-07-20-closed-eye-corrective-v2-first-run.md`](experiments/2026-07-20-closed-eye-corrective-v2-first-run.md) — two-image improvement, dark-hair coherent fit failure, and bound artifacts
- [`experiments/2026-07-20-closed-eye-corrective-v3-protocol.md`](experiments/2026-07-20-closed-eye-corrective-v3-protocol.md) — pre-registered lower-band-first sampling test
- [`experiments/2026-07-20-closed-eye-corrective-v3-validation.md`](experiments/2026-07-20-closed-eye-corrective-v3-validation.md) — Compiler 0.8 implementation, 3/3 visual endpoint gate, 7/7 browser result, 12/12 public matrix, and preserved hold-out boundary
- [`experiments/2026-07-20-holdout-a-closed-eye-audit-protocol.md`](experiments/2026-07-20-holdout-a-closed-eye-audit-protocol.md) — pre-registered report-only corrective audit over the already-opened independent licensed set
- [`experiments/2026-07-20-holdout-a-closed-eye-audit-first-run.md`](experiments/2026-07-20-holdout-a-closed-eye-audit-first-run.md) — preserved independent first-run protected-core failure, hashed visual evidence, and double-alpha root cause
- [`experiments/2026-07-20-holdout-a-closed-eye-audit-validation.md`](experiments/2026-07-20-holdout-a-closed-eye-audit-validation.md) — opaque-cache correction, zero-error hold-out replay, translucent-source CI regression, and unchanged promotion boundary
- [`experiments/2026-07-20-product-studio-validation.md`](experiments/2026-07-20-product-studio-validation.md) — real PNG-to-`.limg` Studio, reason-only reject, capability-gated reactions, deterministic showcase, and actual Chromium WebM evidence
- [`experiments/2026-07-21-hosted-compiler-api-validation.md`](experiments/2026-07-21-hosted-compiler-api-validation.md) — provider-neutral hosted API health and real detector PNG-to-`.limg` response timing, hashes, and remaining Docker boundary
- [`progress.md`](progress.md) — implementation checkpoints and commit trail

## Evidence labels

- **Confirmed** — checked in a linked primary source or reproduced locally.
- **Decision** — an engineering choice for this repository, not a claim made by a source.
- **Inference** — a conclusion drawn from confirmed facts; validate during implementation.
- **Open** — unresolved and not safe to treat as confirmed.

The research snapshot date is **2026-07-21**. Dependency releases, model terms,
and remote files can change; re-check them before a public or commercial release.
