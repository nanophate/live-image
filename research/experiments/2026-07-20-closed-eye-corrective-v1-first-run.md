# Closed-eye corrective v1 first run

Date: 2026-07-20

Protocol:
[`2026-07-20-closed-eye-corrective-v1-protocol.md`](2026-07-20-closed-eye-corrective-v1-protocol.md)

## Frozen result

- **Confirmed:** Compiler 0.6.0 preserved all six frozen source hashes, status
  outcomes, and capability partitions.
- **Confirmed:** Real Chromium rendered all enabled states in
  `semantic-mesh-corrective-required` with no render error, external request, or
  changed pixel outside the compiler-authored ROI.
- **Confirmed:** 45 TypeScript tests, 34 Python tests, and the production build
  passed before visual review.
- **Confirmed:** The full-resolution visual promotion gate failed. The filled
  region retained the original open iris and eyelash texture, so blink `1.0`
  still read as an open eye rather than a closed eyelid.
- **Inference:** Telea propagated dark pixels from the eye-mask boundary. The
  boundary-connected edge exclusion also left holes in the mask; both effects
  violate the assumption that local inpainting can recover skin from an
  open-eye aperture.

## Artifact binding

The ignored `.limg` outputs were:

| Case | SHA-256 |
| --- | --- |
| clean-teal | `1ecc278596341dc32a17f545dfc3b35ff7a2f8a1ae29a210f676738cde5df570` |
| dark-iris-navy | `2168b2d58501d7c1995beab4c604350d260f4d571b98eeaaae6dab4db5f43fc8` |
| glasses-round | `b6d73a2ef0233b45b4ddc12f36e547b13c175364505850c479b208e1bd050f82` |
| light-iris-silver | `90313ae1878bc2f55fa97279c0597e84709af9587a412679d2cc8acb27225f32` |
| occluded-left-eye | `6647dcfd438dbc3732b3dcb7d4f3c553803e3b5a7e2c6d6504d6e8809b0a4501` |
| three-quarter | `06b88e8e4004da7d8e76e5ea9a629b71d820c4333f1e24ad35586991a293b77a` |

The reviewed full-close PNG hashes were:

| Case | SHA-256 |
| --- | --- |
| clean-teal | `f40e2b5b820fcedc852427f4231266874682369070b92802dc59e0531fa32a14` |
| dark-iris-navy | `f14fd586e7a446747c55a6a4e1dd8cb5ec537c1bb90f53ec387aef73f44d3355` |
| glasses-round | `de65d48b83845fcfbc8506fedea6994aa67c136c1d08e5123e908e86bbb22b95` |

The local images remain ignored. The browser capture test and hashes are the
reproduction trail without committing source-derived media.

## Decision

**Decision:** Do not promote or tune this first run in place. Retain Runtime
support so the bound failed artifact remains inspectable, and test a separately
named v2 compiler method that fits skin from explicitly selected pixels outside
the eye instead of propagating the aperture boundary.
