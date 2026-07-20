# Closed-eye corrective v2 first run

Date: 2026-07-20

Protocol:
[`2026-07-20-closed-eye-corrective-v2-protocol.md`](2026-07-20-closed-eye-corrective-v2-protocol.md)

## Result

- **Confirmed:** Compiler 0.7.0 preserved the six frozen quality/capability
  outcomes. Unit, build, and real-browser gates passed.
- **Confirmed:** The affine fill fixed the v1 open-iris failure on `clean-teal`
  and retained the round-glasses lines on `glasses-round`.
- **Confirmed:** The visual promotion gate still failed across supported cases.
  The left eye of `dark-iris-navy` acquired a large gray-brown block below the
  lid while the right eye remained plausible.
- **Confirmed:** That eye also had the largest recorded median BGR fit residual,
  about `18.50`; the other reviewed eyes ranged from about `1.40` to `4.34`.
- **Inference:** Pooling the upper and lower sample bands allowed dark hair or
  shadow from the upper band to bias one affine plane. Robust residual trimming
  was insufficient because the contaminated band was spatially coherent rather
  than a small set of isolated outliers.

## Artifact binding

| Case | `.limg` SHA-256 |
| --- | --- |
| clean-teal | `8993c3957d6a06b858f976bc85a97d5c4c84f8f0e03af92cc9582e8c85f2af06` |
| dark-iris-navy | `716b3a38b1654dc63cf4ca12663f168f54c96ae4bea552b5107abc8bbcec182b` |
| glasses-round | `84b914b3655f82a2ea13f9a8efd15ea25b1fbc41f1acfadc7ae6d9a641ec7f6a` |
| light-iris-silver | `9d583b64c07fce14729802f916a7bc819c6a625fc5a4da1ed5c73329c2d4034a` |
| occluded-left-eye | `4d0405227b0f974df07708ce7f64b003e8b134bdff8b3d77cb76fb1ef6dfa4a5` |
| three-quarter | `eebeea5fb3e753a9310b64fb970d8a06e7d6c9f6e3c3aebda03f3c02a53e99e7` |

| Reviewed full-close frame | SHA-256 |
| --- | --- |
| clean-teal | `790fb96db1bd16c921637b9fad92dd0541ece863bec251abe55e92d750662696` |
| dark-iris-navy | `9a5a33947042851057e1ff1b1b7c66884d4ffb071edadcf64ce807a1fa750364` |
| glasses-round | `d4e04a403ef217565067aefbf21db1ae5b5e40a96f95618552c9485341fafd94` |

## Decision

**Decision:** Do not promote v2. Preserve it as the first successful
closed-aperture proof on two images, but require the same method to avoid the
coherent upper-band contamination on the third supported image.
