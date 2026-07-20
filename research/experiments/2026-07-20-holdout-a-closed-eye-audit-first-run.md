# Hold-out A closed-eye audit: first run

Date: 2026-07-20

Status: preserved before the Runtime correction described below

Protocol: [`2026-07-20-holdout-a-closed-eye-audit-protocol.md`](2026-07-20-holdout-a-closed-eye-audit-protocol.md)

## Frozen input

- **Confirmed:** the five local source hashes and Compiler 0.8 artifact hashes
  matched `fixtures/holdout/manifest.json` and `fixtures/holdout/report.json`.
- **Confirmed:** only `stevenburrow-sample1` had blink and gaze enabled. The
  other four cases retained their actual limited/reject capability contracts.
- **Confirmed:** the reviewed artifact SHA-256 was
  `acd2ae6a1c1c5cb034df7289869e6fecca8bd293b6fed3f38625de0f61858b21`.

## Unmodified first run

Command:

```text
nodenv exec npx playwright test tests/browser/closed-eye-holdout-local.spec.ts
```

Result: `1 passed, 1 failed`.

- **Confirmed:** every artifact loaded and rendered in
  `semantic-mesh-corrective-required` mode without a page, console, external
  request, or Runtime exception.
- **Confirmed:** all expected disabled-control cells were explicitly skipped.
- **Confirmed:** blink `0.5`, blink `1.0`, both winks, and all six gaze states
  stayed inside the compiler-authored ROI and produced a visible local change.
- **Confirmed:** all ten moving eye cells failed the protected-core invariant.
- **Confirmed:** the blink cells reported the following protected-core errors:

| State | Error pixels / checked pixels | Maximum RGB error | Outside ROI |
| --- | ---: | ---: | ---: |
| Blink 0.50 | 25 / 2021 | 95 | 0 |
| Blink 1.00 | 26 / 2021 | 87 | 0 |
| Wink left | 21 / 1382 | 82 | 0 |
| Wink right | 5 / 639 | 87 | 0 |

- **Confirmed:** full close rendered zero iris-texture pixels in both eyes.
- **Confirmed:** the four downloaded frame hashes were:

| Capture | SHA-256 |
| --- | --- |
| Blink 0.50 | `11b8232a5b8ddbb4d7ff803e3efb58ac7b95db73cb709d58ab98a9ab4eae3eab` |
| Blink 1.00 | `321e6244d277bc7cb0dc5612ac31a93371c1e97ce4f03fc0c46448146de08f2d` |
| Wink left | `d1546ec6be668454e302ec8abe24fa21aa29c86ee6150c36584e86e70b2f6e3c` |
| Wink right | `7697322d34d4cf70a38f2b218373b8b0743ed65882e521b83af62d954278f4d5` |

The local five-state review strip had SHA-256
`61cbba8581a1afa6c8df534fb463cc466524309f6ea50a8c229a2be3843b8bb9`.
The source-derived captures remain ignored and are not redistributed.

## Visual review

- **Confirmed:** both full-close endpoints read as closed eyelids at full image
  scale. No iris duplication, solid rectangular fill, face-wide deformation, or
  outside-ROI leak was visible.
- **Confirmed:** each wink left its opposite eye visually open and the partial
  close connected plausibly to the endpoint.
- **Open:** this is one blink-enabled independent image, so it cannot establish
  endpoint generality or select a production quality threshold.

## Root-cause evidence

- **Confirmed:** the source PNG contains transparency. Within exact-alpha-255
  pixels of the compiler protection masks, 39 / 1407 left-eye source pixels and
  7 / 668 right-eye source pixels had source alpha below 255.
- **Confirmed:** the player renders its destination canvas with `alpha: false`,
  so the source is first composited against opaque black. The protection cache
  was built on an alpha-enabled canvas, retained the source alpha, and then
  composited those pixels a second time over the already-rendered source.
- **Inference:** the close match between semi-transparent protected source
  pixels and observed error counts identifies double alpha compositing, not
  detector offset or corrective-fit quality, as the protected-core failure.
- **Decision:** correct the general Runtime compositing contract by caching the
  protected crop as it appears on the opaque player canvas before applying the
  mask. Do not change detector thresholds, corrective constants, artifact
  contents, or capability policy in response to this audit.

## Promotion boundary

- **Decision:** a passing replay after the general compositing correction may
  count as a Runtime regression result, but not as a fresh model-quality result.
- **Open:** a newly frozen hold-out B is still required before selecting a
  closed-eye residual gate or making a production-readiness claim.
