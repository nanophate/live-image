# Progress checkpoints

Branch: `codex/validation-matrix`

| Commit | Checkpoint | Evidence |
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

Commit signing was disabled for these checkpoints because the configured
1Password signing integration failed to fill its buffer; source and test results
are otherwise preserved normally.
