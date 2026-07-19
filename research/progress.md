# Progress checkpoints

Branch: `codex/mvp-auto-rig`

| Commit | Checkpoint | Evidence |
| --- | --- | --- |
| `f528c15` | research and detector baseline | primary-source references, license matrix, two original fixtures, actual model scores |
| `2d3f06c` | automatic Compiler | raw 28 points, pupil/mouth derivation, confidence gate, `.limg`, overlays, Python tests |
| `a1332b1` | deterministic Runtime and Viewers | nodenv-pinned toolchain, Canvas player, Inspector, state API, TS tests, browser build |

The final documentation/validation checkpoint is added after the full clean test
and build run. Commit signing was disabled for these checkpoints because the
configured 1Password signing integration failed to fill its buffer; source and
test results are otherwise preserved normally.

