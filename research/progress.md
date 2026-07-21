# Progress checkpoints

Current branch: `codex/cloudflare-private-staging`

| Commit / PR | Checkpoint | Evidence |
| --- | --- | --- |
| `f528c15` | research and detector baseline | primary-source references, license matrix, two original fixtures, actual model scores |
| `2d3f06c` | automatic Compiler | raw 28 points, pupil/mouth derivation, confidence gate, `.limg`, overlays, Python tests |
| `a1332b1` | deterministic Runtime and Viewers | nodenv-pinned toolchain, Canvas player, Inspector, state API, TS tests, browser build |
| `50aa606` | reproducible validation handoff | README, `.limg` schema, third-party notices, browser QA, actual no-face reject |
| `aa6a0c9` | public MIT baseline | research discipline, project-level MIT license, responsible-use request, public branch without license-selection history |
| `b8d0219` | shipped-artifact license inventory | matrix reduced to detector, active dependencies, build tools, and project fixtures |
| `3d8b41b` | pull-request CI | Node 24.18 web tests/build and offline Python 3.12 compiler tests on Ubuntu 24.04 |
| `9039aac` | public MVP merged | pull request #1 merged to `main`; validation work branched from the merge commit |
| `55421e1` | multi-image validation harness | 12-case frozen manifest, public original fixtures, batch compiler, report viewer, and preserved 7/12 first-run result |
| `cc04001` | quality gate v2 | compiler 0.2.0 confidence/symmetry/resolution gates, 12/12 calibrated result, safety review fixes, tests, and research record |
| PR #3 | local external hold-out motion validation | frozen manifest and hashes without source-media redistribution, preserved 3/5 first run, deterministic comparison Viewer, browser evidence, capability skips, and local SHA-256 preflight |
| PR #4 / `8c35279` | blink transition and support-domain decision | single-player close/reopen strip with pixel-exact recovery, plus licensed review of deterministic descriptors, CLIP, and WD Tagger |
| `de8a80b` | validation capability contracts | frozen enabled/disabled capability expectations are now checked in addition to status |
| `f0308e4` | protected local deformation | compiler-authored eye rows and protected-line masks, bounded mouth bands, full-resolution recovery, 12/12 matrix and preserved 3/5 hold-out result |
| PR #5 / `0a56bb7` | real-browser motion-locality gate | exact Playwright 1.61.1 + Chromium validates 2 automatic rigs across 26 blink, wink, gaze, and mouth states with visible local effects, zero ROI leakage, and pixel-exact blink recovery |
| `1ff35ad` | protected eye-pixel gate | real Canvas sampling validates 20 eye-state renders / 36 selected-eye checks independently, with zero protected-core RGB errors and nonzero clear-mask movement; mask-bypass and one-eye no-op faults both reproduced failures |
| `068174a` | Compiler 0.4 rigid iris/base-eye layers | fully contained automatic iris RGB/alpha cages, Telea base eyes, cardinal/diagonal gaze bounds, blink-only sclera warp, direct rendered-iris Canvas control, 12/12 matrix and preserved 2/5 stricter hold-out result |
| `70da748` | source and exact motion contracts | all 12 public quality-calibration inputs pin SHA-256 plus exact blink/gaze/mouth capability partitions; real offline detection remains 12/12 and the tracked report is unit-checked |
| `c53d241` | report-only support-domain descriptors | deterministic source-bound OpenCV metrics over 12 feasibility cases, explicit contaminated A replay/procedure failure, byte-identical raw reports, malformed-artifact isolation, and no production gate change |
| `ec0172a` | semantic blink mesh and closed-eye endpoint | Compiler 0.8 explicit 42-vertex blink fields, rigid-iris aperture integration, preserved numeric-only/Telea/upper-band failures, lower-band-first affine corrective, 3/3 supported visual gate, 7/7 Chromium suite, 12/12 public matrix, and unchanged 2/5 hold-out boundary |
| `6876416` | independent closed-eye alpha audit | preserved hold-out A first-run failure, transparent-source double-alpha correction, unchanged Compiler 0.8 artifacts/capability policy, zero protected-core errors on replay, tracked translucent-source regression, 46/46 TypeScript, 34/34 Python, and 10/10 Chromium checks |
| PR #7 / `7bd42ad` | semantic eye work merged | Compiler 0.8 semantic mesh, closed-eye corrective, and independent alpha audit merged to `main` |
| `60e832b` | local product Studio and review recording | localhost-only PNG/JPEG → full/limited/reject flow, downloadable `.limg`, capability-gated named reactions, deterministic showcase, exact-neutral WebM recording, signature/dimension/Host fail-closed gates, 51/51 TypeScript, 39/39 Python, 11 Chromium passes plus 2 local-only skips, and 2/2 actual Studio browser checks |
| `c8ad373` | public hosting feasibility | Cloudflare Pages selected for the first static Viewer review, GitHub Pages retained as a static fallback, ordinary Workers rejected for the current PyTorch/OpenCV compiler, and Cloudflare Containers limited to a future authenticated private alpha after privacy/license/operations gates |
| `e57e389` | hosted compiler private-alpha scaffold | one-origin Worker Assets + private Python Container path, reviewed model hashes baked and checked offline, Viewer hosted/local/viewer-only modes, bounded fixed-length uploads with header isolation, real detector HTTP proof at 4.34 seconds warm local, 55/55 TypeScript, 44/44 Python, 13 Chromium passes plus 2 documented local-only skips, and deploy disabled pending Docker/Access/cost gates |
| `a14b9f7` | linux/amd64 container benchmark and shutdown hardening | 1.65 GiB non-root/offline image with pinned base/model digests, reproduced PID 1 forced-kill then clean SIGTERM exit, Docker healthcheck, 45/45 Python, 0.5 CPU first/warm 130.52/81.24 seconds, 1 CPU warm 38.89 seconds, approximately 0.64 GiB loaded memory, explicit standard-1/2 no-deploy decision, and a provider-performance follow-up gate |
| `273b1a0` | quota-aware deterministic Compiler runtime | isolated YOLO and HRNet timings, reproduced 12-thread cgroup oversubscription, one-thread Compiler and Container defaults, 1 CPU HTTP first/warm improvement to 10.06/4.95 seconds, byte-identical artifacts and reports, unchanged 12/12 public and 2/5 hold-out boundaries, 48/48 Python, 55/55 TypeScript, both builds, and Cloudflare dry-run |
| `a53ea76` | shared Cloudflare and Hugging Face container targets | one pinned multi-stage Dockerfile with isolated API-only and same-origin Viewer targets, exact container dependency versions, private-by-default origin/429/static-root/privacy controls, real linux/amd64 byte-identical `.limg` proof across both targets, 53/53 Python, 55/55 TypeScript, production Viewer/Worker builds, Wrangler dry-run, and 14 Chromium passes plus 2 documented local-only skips |

Commit signing was disabled for these checkpoints because the configured
1Password signing integration failed to fill its buffer; source and test results
are otherwise preserved normally.
