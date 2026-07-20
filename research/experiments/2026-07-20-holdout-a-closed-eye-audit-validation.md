# Hold-out A closed-eye audit: Runtime validation

Date: 2026-07-20

Status: report-only Runtime result; not fresh quality calibration

Protocol: [`2026-07-20-holdout-a-closed-eye-audit-protocol.md`](2026-07-20-holdout-a-closed-eye-audit-protocol.md)

First run: [`2026-07-20-holdout-a-closed-eye-audit-first-run.md`](2026-07-20-holdout-a-closed-eye-audit-first-run.md)

## Change under test

- **Confirmed:** the first run isolated double alpha compositing in the Runtime
  protection cache for transparent source PNG pixels.
- **Decision:** the protected crop is now composited against the same opaque
  black backing used by the player Canvas before the compiler mask is applied.
- **Confirmed:** no detector output, `.limg` artifact, source image, closed-eye
  corrective, quality threshold, capability decision, dependency, or model was
  changed.
- **Decision:** Playwright now builds immediately before starting Vite preview,
  preventing a targeted browser run from silently exercising a stale `dist/`.

## Results

After a fresh `nodenv exec npm run build`:

```text
nodenv exec npx playwright test tests/browser/closed-eye-holdout-local.spec.ts
2 passed
```

- **Confirmed:** all five Compiler 0.8 hold-out artifacts retained their report
  hashes, result classes, and capability partitions.
- **Confirmed:** all ten moving eye states for the one blink-enabled hold-out
  case reported zero protected-core errors, zero outside-ROI pixels, and no
  render/page/console/external-request error.
- **Confirmed:** full blink and both winks rendered zero direct iris-texture
  pixels for each closed eye.
- **Confirmed:** disabled controls for the other four images remained explicit
  skipped results rather than forced animations.

A tracked browser-only regression made the entire source image 50% translucent
at runtime while reusing the exact compiler rig:

```text
nodenv exec npx playwright test tests/browser/runtime-locality.spec.ts
4 passed
```

- **Confirmed:** row-grid, semantic-mesh, and semantic-mesh-corrective modes
  retained zero protected-core errors on the tracked opaque fixtures.
- **Confirmed:** the new translucent-source regression retained zero
  protected-core errors for mid/full blink, both winks, and horizontal gaze.
  This test needs no local hold-out media and can run in CI.

TypeScript/build result:

```text
nodenv exec npm run build
passed
nodenv exec npm run test:ts
46 passed
```

## Corrected local visual evidence

The source-derived captures remain ignored and local.

| Capture | SHA-256 |
| --- | --- |
| Blink 0.50 | `7296a32151905d539023fc1a9c6a6f80cdeb2447c31ac779af246e9f5da11070` |
| Blink 1.00 | `465df9acd5675efcb1aae1e8edec515f93cd57cf834dcdaf65094385a4957fbf` |
| Wink left | `21a4d4c1f38b56b1d88969800edcd38c7d8db8f8b59380b80624095027344e2a` |
| Wink right | `f200a58e7dbb90798151d973656185c514d87a4f640e6f265180e3b078f59aa8` |
| Five-state strip | `2f7b23a9a15fce7dc55dff03ce48bb0397bb1cba8862eba7449f22acd8bfe8f4` |

- **Confirmed:** the corrected frames preserve the first-run visual result:
  both endpoints read as closed eyes, the opposite eye stays open in each wink,
  and no rectangular fill, duplicated iris, or face-wide distortion is visible.

## Decision and remaining boundary

- **Decision:** the Runtime compositing correction passes this audit and the
  tracked CI regression. It is suitable to keep on the current feature branch.
- **Confirmed:** hold-out A contributes only one blink-enabled endpoint image.
- **Open:** endpoint generality and any residual-based production gate still
  require a newly licensed, frozen hold-out B. These results must not be used to
  tune that threshold.
