# Compiler 0.4 iris and base-eye validation

Review date: **2026-07-20**

## Question

Can automatic pupil and eyelid detections produce a portable rigid
iris/highlight layer and a deterministic iris-removed base eye, so gaze no
longer shears the highlight and full blink no longer crushes it into the lid
seam?

## Evidence and claim boundary

**Confirmed.** Compiler `0.4.0` extends the optional `.limg` v1 eye deformation
with a paired iris texture and base-eye texture. Older v1 manifests without the
pair remain valid and use the earlier full-image warp path.

**Decision.** The first implementation uses the existing automatic pupil point
and six eye landmarks to author a conservative ellipse. It copies source RGB
inside a compiler-authored ellipse alpha; it does not classify bright pixels,
so highlights inside the ellipse stay attached to the same texture. Source PNG
alpha is not preserved because the compiler currently decodes colour input with
OpenCV `IMREAD_COLOR`. This is deterministic geometric extraction, not a claim
of semantic iris segmentation across all art styles.

**Decision.** Fail closed for new Compiler output. Starting radii may be reduced
together to 75% of their initial size, but a pair is authored only when the
complete rasterized ellipse is inside both the crop and detected eye polygon
and contains at least 12 pixels. It is omitted when pupil confidence is below
`0.60`, the centre is outside the eye polygon, or no fully contained candidate
exists. If either eye lacks the pair, both blink and gaze are disabled instead
of silently using the highlight-crushing fallback.

## Compiler contract

The initial radii are deterministic starting values:

```text
radiusX = max(2 px, min(0.20 * eyeWidth, 0.72 * eyeHeight))
radiusY = max(2 px, 0.40 * eyeHeight)
```

The emitted centre/radii exactly match the integer geometry used for the PNG.
Gaze maxima start at `0.075 * eyeWidth/eyeHeight`, are scaled by pupil
confidence, and are reduced until the full ellipse stays inside the eye polygon
in both cardinal directions. Both axes are then jointly scaled until all four
diagonal endpoints are contained. A full asset requires at least 1 horizontal
pixels and 0.25 vertical pixels of maximum movement in each eye.

The compiler embeds two compact RGBA PNGs in the deformation region's exact
pixel dimensions:

- `source-rgba-ellipse-v1`: original colour with the ellipse/polygon alpha;
- `telea-inpaint-v1`: opaque crop with the iris area removed using OpenCV
  Telea inpainting and `radius = clamp(round(0.06 * eyeWidth), 2, 6)`.

OpenCV describes Telea inpainting as reconstruction from the neighbourhood of
the masked region in its
[official API documentation](https://docs.opencv.org/master/d7/d8b/group__photo__inpaint.html).
It is not evidence of the truly hidden sclera.

**Confirmed.** TypeScript validation requires a complete pair, strict embedded
PNG data URLs, the exact deformation-region dimensions, supported method IDs,
normalized coverage/confidence, a positive integer inpaint radius, and an iris
ellipse fully contained by the stored eye deformation region. The Runtime also
decodes both PNGs and checks their intrinsic dimensions transactionally before
replacing the currently playable character.

## Runtime contract

**Confirmed.** For a layered eye the Canvas Runtime now draws:

1. the compact inpainted base eye through the existing six-row blink-only mesh;
2. the original iris/highlight RGBA using rigid translation only;
3. the iris clipped to the current aperture polygon;
4. the compiler-authored protected line art last.

The base-eye mesh and aperture do not receive the legacy gaze warp; only the
rigid iris translates. Gaze displacement is multiplied by `(1 - blink)`. Iris alpha uses the
pre-registered smoothstep of aperture height above the full-close floor and is
forced to exactly zero at `blink == 1`. The cage radii never change.

## Reproduced results

### Two primary automatic rigs

**Confirmed.** Both tracked source images recompiled offline as Compiler
`0.4.0` `full` assets with a layer pair for all four automatically detected
eyes.

| Fixture | Iris confidence | Iris texture coverage | Compiler maximum gaze X | Full-blink alpha |
| --- | ---: | ---: | ---: | ---: |
| teal-librarian | 1.000 / 1.000 | 0.0650 / 0.0687 | ±2.46 / ±2.72 px | 0 / 0 |
| copper-courier | 0.874 / 0.776 | 0.0639 / 0.0610 | ±1.32 / ±1.29 px | 0 / 0 |

The real Chromium comparison covered **20 eye-state renders / 36 selected-eye
checks**. Browser-executed motion-plan evidence showed that every selected eye
retained invariant cage radii, translated in the requested gaze direction,
returned displacement to zero at full close, and had alpha zero for full blink
or wink. Separately, a transparent-iris control render directly proved that
every selected visible iris contributed pixels (981–2011 differing pixels per
eye in these states) and contributed zero at full blink/wink. Full-resolution
Canvas gates also kept protected-core RGB error at zero and changed pixels
outside compiler eye ROIs at zero. Open → reopened output remained pixel-exact.

**Confirmed visual review.** The local Compare Viewer rendered both Compiler
0.4 assets without console warnings/errors. At the comparison scale, neutral,
mid-blink, full-blink, wink, and four gaze directions showed no obvious crushed
highlight or rectangular pasted-patch boundary. This is a checkpoint, not a
substitute for frozen full-resolution visual review across the wider matrix.

### Automatic 12-image matrix

**Confirmed.** The offline matrix remained **12/12 expected outcomes**: seven
`full`, five `limited`, zero errors. All seven full cases (four clean, two dark
iris, and glasses) authored both iris/base-eye pairs. Both light/low-contrast
cases authored neither pair and disabled blink/gaze. The occluded-eye case
authored only the unobstructed eye and disabled blink/gaze globally. The
three-quarter and low-resolution cases retained their prior independent
capability limits.

### Independent local hold-out

**Confirmed failure.** The external hold-out changed from the frozen first
**3/5** result to **2/5 expected outcomes**. The clean frontal case remained
full with two pairs. The strong-highlight case could not fit fully contained
ellipses and became limited; this is retained as a safety-side regression
rather than relaxing the gate to move eyelid-shaped cutouts. The one-eye-closed
case remained a safe-side reject, and the painted portrait remained limited,
retaining the missing style-domain-gate mismatch.

## Test sensitivity and one reproduced procedure failure

**Confirmed.** TypeScript tests cover rigid radii, signed gaze translation,
monotonic alpha over blink samples, a gaze-invariant aperture, exact full-close
alpha zero, malformed schema fields, and transactional decode/dimension
failures. Python tests decode both generated PNGs, verify their
dimensions/alpha contracts and geometry, bound rigid translation inside the eye
polygon, and verify fail-closed capability decisions. The browser test compares
the actual render with a transparent-iris control render per selected eye.

## Review-driven corrections

**Confirmed reproduced design fault.** The first layered Runtime revision fed
gaze into the base-eye mesh/aperture and also translated the iris. A high-effort
review identified this double gaze/jelly path. The layered path now sends blink
only to the base/aperture; the old gaze mesh remains only for legacy v1 assets
without iris layers. Unit evidence requires the aperture to be identical across
gaze values.

**Confirmed reproduced gate fault.** The first extraction accepted 75% of an
ellipse after clipping it by the source eye polygon. Review showed that this
could translate an eyelid-shaped missing-alpha boundary. The compiler now uses
only a complete contained ellipse (with bounded radius reduction), emits its
exact raster geometry, and caps both gaze axes by full-ellipse containment.
This stricter rule caused the recorded strong-highlight hold-out regression.

**Confirmed procedure failure.** The first new Playwright assertion run read a
stale Vite `dist/` containing the older Compiler 0.3 rig snapshots and reported
zero iris evidence. Rebuilding production assets before `test:browser` loaded
the Compiler 0.4 snapshots and passed. This was not hidden because it changes
the required local validation order: run `npm run build` after regenerating
browser rig snapshots.

### Final reproducible commands

**Confirmed.** Using nodenv Node `24.18.0` and the pinned local Python
environment on 2026-07-20:

- `nodenv exec npm test`: TypeScript **36/36**, Python **26/26**;
- `nodenv exec npm run build`: pass;
- `nodenv exec npm run validate:fixtures:offline`: **12/12** expected outcomes;
- `nodenv exec npm run validate:holdout:offline`: report written with **2/5**
  expected outcomes, nonzero exit retained because three frozen expectations
  differ;
- `nodenv exec npm run test:browser`: Chromium **1/1** pass after the build.

## License and provenance

**Confirmed.** No dependency, model, weights, dataset, or sample image was
added. The implementation uses project-authored Python/TypeScript plus the
already-pinned `opencv-python-headless==4.10.0.84`; the license matrix therefore
needs no new row. The embedded iris and inpainted base textures are derivatives
of the input image and inherit that image's provenance and redistribution
conditions rather than becoming MIT assets.

## Open follow-ups

- **Open:** replace the initial geometric ellipse confidence with calibrated
  sclera-colour/component evidence and freeze thresholds on a new hold-out.
- **Open:** store a denser curved aperture instead of the present six-point
  polygon to reduce angular clipping on stylized eyelids.
- **Open:** measure inpaint boundary residual and stationary-iris duplication
  directly; the current Canvas gate proves locality/protection and the motion
  plan proves rigid geometry, but not perceptual inpaint correctness.
- **Open:** fault-inject omitted base-eye drawing and score inpaint boundary
  residual independently; direct iris-texture presence/absence is now gated.
