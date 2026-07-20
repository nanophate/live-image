# Closed-eye corrective v3 validation

Date: 2026-07-20

Protocol:
[`2026-07-20-closed-eye-corrective-v3-protocol.md`](2026-07-20-closed-eye-corrective-v3-protocol.md)

## Implementation

- **Confirmed:** Compiler 0.8.0 emits an optional
  `affine-skin-fill-curve-v3` RGBA layer per eye. It is derived only from the
  automatic eye polygon, existing protected mask, nearby source pixels, and a
  fixed robust affine fit.
- **Confirmed:** The below-eye band must independently meet the minimum sample
  and horizontal-span gates. Upper samples join only when their median BGR
  distance from the lower samples is at most `12`.
- **Confirmed:** The manifest records the alpha coverage, sample exclusion
  radius, retained sample count, median fit residual, upper-band decision, line
  thickness, and blend start. Runtime has no per-image corrective constant.
- **Decision:** `row-grid` remains the default. The candidate is exposed only as
  `semantic-mesh-corrective-required`; missing mesh/layers throw instead of
  falling back.

No new dependency, model, weight, training data, or sample asset was added.
`research/license-matrix.md` and `THIRD_PARTY_NOTICES.md` therefore do not
change.

## Frozen six-case result

- **Confirmed:** All 6 frozen source hashes, statuses, and exact capability
  partitions matched.
- **Confirmed:** The dark-iris left eye rejected its upper sample band and its
  median fit residual fell from v2 `18.50` to `1.49`. The fixed rule also
  rejected the upper band on one glasses eye; no fixture-name branch exists.
- **Confirmed:** The three supported cases produced both corrective layers.
  Difficult cases kept blink disabled exactly as frozen, even if report-only
  corrective metadata could be authored.

| Case | `.limg` SHA-256 | Bytes |
| --- | --- | ---: |
| clean-teal | `2aab372e5180b63e83ba6c5f84ce226db713021d7359e31ddd60b7eb3c227d07` | 2,498,805 |
| dark-iris-navy | `a1a4bd549ae762ae19c502f337325458b8d52ae36b76705ea716114eb624949d` | 2,386,177 |
| glasses-round | `56277cce39eef915f9de8929305f119edadea41b1d4a70e65dad035309e48b21` | 2,524,642 |
| light-iris-silver | `e2c8401e197628598715e4b9cf7c1bc94d0d59df8a13ce74d68c93263e4cfb28` | 2,565,846 |
| occluded-left-eye | `dbaff412c133c45c097882573ed398a8bf22f3ff244e73ed7d00df164fea7d09` | 2,333,024 |
| three-quarter | `c4f2be037ae0af2553ef7419176261ac6ff7d2b86b45236fab5563bdb5c480b3` | 2,616,065 |

## Real-browser evidence

- **Confirmed:** The complete browser suite passed 7/7 in Chromium across the
  tracked row-grid, semantic-mesh, and corrected-semantic modes plus both local
  frozen experiments.
- **Confirmed:** The corrected tracked rigs retained zero outside-ROI changes,
  zero protected-core RGB errors, nonzero clear-mask movement, zero rendered
  iris-texture pixels at full blink/wink, and pixel-exact open/reopen recovery.
- **Confirmed:** Corrected full blink changed 36,354 allowed pixels for
  `teal-librarian` and 28,160 for `copper-courier`; both remained localized.
- **Confirmed:** No external request, page error, or console error occurred.

## Visual gate

Full-resolution frames and paired strips were inspected for `clean-teal`,
`dark-iris-navy`, and `glasses-round` at neutral, blink `0.5`, blink `1.0`, and
both winks.

- **Confirmed:** 3/3 full-close frames read as closed eyelids rather than dark
  cavities or open irises.
- **Confirmed:** The v2 dark-iris color block was absent.
- **Confirmed:** The round glasses, nose bridge, hair borders, and opposite open
  eye in wink frames remained visible.
- **Confirmed:** No obvious solid rectangular patch, triangle seam, duplicate
  iris, or face-wide movement was observed in this fixed review set.
- **Open:** Three images are not enough to claim broad natural-blink quality.
  The authored curve is deliberately simple and can still differ from an
  illustrator's actual closed-eye design.

The ignored full-close frame hashes are:

| Case | SHA-256 |
| --- | --- |
| clean-teal | `790fb96db1bd16c921637b9fad92dd0541ece863bec251abe55e92d750662696` |
| dark-iris-navy | `91af82dd182c31d2d8746cd8e5544a489d452ef98d618209e4693ddca12e2181` |
| glasses-round | `956ce5037928b23c74e9a4750c92341875319f9d669c188eb13bbe26c98683d5` |

## Generalisation boundary

- **Confirmed:** The tracked public validation matrix remained 12/12 expected
  outcomes: 7 full and 5 limited.
- **Confirmed:** The existing local hold-out remained 2/5 expected outcomes
  (1 full, 2 limited, 2 reject). The three known mismatches were not tuned away.
- **Decision:** This is a successful bounded endpoint experiment, not a broad
  support claim. Keep the corrected mode opt-in until more independent images
  pass the same visual gate and a compiler quality policy explicitly decides
  whether missing/poor corrective evidence should disable blink.

## Verification

- Node `24.18.0` through nodenv; npm `11.16.0`
- TypeScript: 46/46 passed
- Python: 34/34 passed
- production build: passed
- Playwright Chromium: 7/7 passed
- public validation: 12/12 expected outcomes
- local independent hold-out: 2/5 expected outcomes, known result preserved
