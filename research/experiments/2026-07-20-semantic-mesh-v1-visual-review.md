# Semantic mesh v1 visual review

Date: 2026-07-20

Related protocol:
[`2026-07-20-semantic-mesh-v1-protocol.md`](2026-07-20-semantic-mesh-v1-protocol.md)

Raw numeric run:
[`2026-07-20-semantic-mesh-v1-first-run.json`](2026-07-20-semantic-mesh-v1-first-run.json)

## Review material

The browser rendered full-resolution PNGs from the local `clean-teal` fixture.
The fixture and the rendered frames remain ignored because they are
source-derived visual artifacts. These hashes bind this review to the exact
local captures without redistributing another copy:

| Mode / state | Local SHA-256 |
| --- | --- |
| row-grid / strip | `f2f136cfafd806c8d884024733cfb5a223f227cf8a5cda079a47feb552604002` |
| row-grid / blink 0.5 | `3561ba4ebaf9cab873c9bb0ae10df596b1d8bb5cd8ce160998b8dd6a008dd7db` |
| row-grid / blink 1.0 | `24b26e15224b0d8e2f5dbb615613a049964ace1b6fb0f877bc613fb2d3da48b4` |
| semantic mesh / strip | `32f5e1b75a1a529f823eb15dd048aa835a4cc4120ab36795c9ca4be65b2a65a1` |
| semantic mesh / blink 0.5 | `2f685a11e401d8b19b2ae4e4fe0a524e7f29b7c304610f71b20b72105a4bf36a` |
| semantic mesh / blink 1.0 | `44bb3e670e385b692a8d735eb9ca924e051681d147ba84a02286eef1cc7d33b6` |

Reproduction uses the local-only Playwright test
`tests/browser/semantic-mesh-visual-local.spec.ts`. It writes under
`fixtures/validation/artifacts/semantic-mesh-v1-visual/`, which is ignored.

## Result

- **Confirmed:** Both modes pass the numeric locality, protected-core,
  topology, iris-alpha, and pixel-exact reopen gates.
- **Confirmed:** Both modes fail the visual full-close criterion on the
  reviewed image. The result is a dark, open-eye-shaped cavity with a harsh
  horizontal collapse, not a readable closed eyelid.
- **Confirmed:** The semantic mesh moves fewer pixels and its patch boundary is
  calmer, but it does not solve the missing closed-eye appearance.
- **Confirmed:** At partial close the semantic mesh is visibly under-powered;
  the eye remains more open than the row-grid result.
- **Inference:** Removing the rigid iris at full blink is necessary but not
  sufficient. The inpainted base-eye patch retains dark source material outside
  the conservative iris ellipse, and collapsing that open-eye texture cannot
  invent the skin fill and eyelid stroke required by a closed eye.
- **Open:** A compiler-authored deterministic corrective made from nearby skin
  plus a source-derived eyelid curve may repair the endpoint. It must be tested
  on glasses, bangs, and dark/light iris cases before it can be promoted.

## Decision

**Decision:** Semantic mesh v1 is not promoted to the default renderer. The
first run remains preserved as a failed visual baseline. Triangle validity and
ROI locality remain useful safety gates, but a future promotion gate must also
require a reviewed closed-eye endpoint; numeric motion alone is not evidence of
natural blinking.

**Decision:** The next bounded experiment may add a high-blink corrective layer
without changing detection thresholds, the six-case manifest, or the default
row-grid path. Any corrective must be compiler-authored from the same automatic
landmarks and source pixels, optional in schema v1, and fail closed when safe
skin sampling or occlusion protection is unavailable.
