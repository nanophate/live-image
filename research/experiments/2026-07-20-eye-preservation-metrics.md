# Protected eye-pixel preservation metrics

Review date: **2026-07-20**

## Question

Can the real browser prove that compiler-classified protected eye strokes are
not crushed by blink, wink, or gaze, without confusing a motion no-op with
successful preservation?

## Evidence boundary

**Confirmed.** Compiler `0.3.0` stores an RGBA protected-line mask, eye region,
pupil point/radius, aperture landmarks, and six warp rows. It does not yet
store an independent iris/highlight texture, an inpainted base eye, or the
post-clip iris alpha. The present rig can therefore prove preservation of the
pixels classified into the protected mask, but it cannot honestly prove rigid
iris/highlight geometry or eyelid occlusion.

**Decision.** Do not use a bright-pixel heuristic, SSIM, LPIPS, or another
learned perceptual score as a release claim. Highlight colour varies strongly
across anime images, and a learned score would add weights, training-data, and
license/provenance surfaces without providing the missing semantic layer.

## Implemented two-part contract

Let `N` be the full-resolution neutral RGBA frame and `F` a controlled frame.
The decoded compiler mask is drawn with the Runtime's stored destination region
and high-quality Canvas smoothing into a compact bitmap aligned to
full-resolution destination coordinates before classification. This avoids a
second, nearest-neighbour interpretation of a valid fractional region. One
destination pixel is excluded from the region boundary to avoid treating a
clip-edge sample as mask content.

**Decision: protected core.** Define `P` as destination pixels whose sampled
mask alpha is exactly `255`. For each pixel:

```text
d(p) = max(|F.R - N.R|, |F.G - N.G|, |F.B - N.B|)
coreMaxRgbDelta = max(d(p)) over P
coreErrorPixels = count(d(p) > 1) over P
```

Every enabled blink, wink, and gaze state requires a non-empty `P`,
`coreMaxRgbDelta <= 1`, and `coreErrorPixels == 0`. The one-level tolerance is
a global 8-bit raster tolerance, not an image-specific threshold.

**Decision: clear-mask movement.** Define `C` as destination pixels whose
sampled mask alpha is exactly `0`. Every enabled eye state requires a non-empty
`C` and at least one RGB change in `C` **for each selected eye independently**.
This complementary condition prevents an opaque whole-eye restoration or a
one-eye/no-op renderer from passing the protected core check. `C` is
deliberately not called an aperture: the current mask only classifies protected
versus unprotected pixels and does not carry a semantic eyelid-aperture layer.
The `> 0` movement check is only a no-op detector; it is not a perceptual
quality or motion-magnitude score.

The pure implementation is `measureProtectedMaskQuality` in
`src/motion-comparison.ts`; the Compare Viewer publishes every count as DOM
evidence, and the Playwright test asserts it against the two tracked automatic
rigs.

## Reproduced result

**Confirmed.** nodenv Node `24.18.0`, npm `11.16.0`, Playwright `1.61.1`, and
Chromium `149.0.7827.55` passed the final browser run. All **20 eye
fixture/state combinations / 36 selected-eye checks** retained every protected
core pixel within the one-level contract while still changing clear-mask
pixels. Core maximum RGB delta was actually `0` for every case.

| Fixture | Selected protected-core pixels | Core error pixels | Selected clear-mask pixels | Changed clear-mask pixels |
| --- | ---: | ---: | ---: | ---: |
| teal-librarian | 3,764–9,342 | 0 for every state | 19,877–42,813 | 15,244–38,551 |
| copper-courier | 4,500–9,042 | 0 for every state | 14,151–30,384 | 12,008–29,529 |

The range changes for a wink because only the requested eye participates. The
same run retained the earlier locality result of zero changed pixels outside
the compiler-authored eye regions.

## Gate sensitivity

**Confirmed failure.** A temporary, uncommitted condition bypassed the
protected-layer `drawImage` in `LivingImagePlayer.drawEye`. The earlier motion
remained inside the eye ROI, but the new gate failed immediately at
`teal-librarian/blink-mid`: **8,839 protected core pixels** exceeded the allowed
error instead of the expected zero. Playwright retained a screenshot and trace.
The condition was removed and the final browser run passed.

**Confirmed per-eye failure.** A second temporary, uncommitted fault returned
early only for the left eye during gaze. The right eye still moved, so a
bilateral aggregate could remain nonzero. The eye-level gate failed precisely
at `teal-librarian/gaze-left/left`, where changed clear-mask pixels were `0`.
The fault was removed before the final build.

This is the failure class that the locality-only gate could not distinguish:
the eye still moved and no pixels escaped the ROI, but protected strokes were
being deformed.

## Device-pixel-ratio finding

**Confirmed (code and platform model).** `LivingImagePlayer.load` assigns the
Canvas backing width and height directly from the manifest image dimensions,
and all rendering/`getImageData` coordinates use that bitmap. The Runtime does
not currently multiply the backing store by `window.devicePixelRatio`.

The HTML Standard defines Canvas width/height as the bitmap dimensions, while
`devicePixelRatio` describes the relationship between CSS pixels and device
pixels. A HiDPI Canvas must explicitly enlarge its in-memory dimensions and
scale the context; changing Playwright's device scale alone would test only the
CSS compositor, not this Runtime's triangle rasterization.
([WHATWG Canvas](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element),
[CSSOM View](https://drafts.csswg.org/cssom-view/#dom-window-devicepixelratio),
[MDN HiDPI Canvas example](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#correcting_resolution_in_a_canvas))

**Decision.** Do not add four DPR variants that necessarily read the same
backing pixels and then claim triangle-seam coverage. Add DPR 1/1.5/2/3
raster tests only when the public Runtime gains an explicit render-scale or
DPR-aware backing-store mode. A CSS screenshot test may be added separately if
final compositor sharpness becomes a product requirement.

## License and provenance

**Confirmed.** The metric is project-authored TypeScript and uses the existing
Canvas pixels and compiler masks. It adds no dependency, model, weights,
dataset, or sample image; `research/license-matrix.md` therefore needs no new
row. Screenshots and extracted eye textures remain derivatives of the input
image, so external hold-out captures must continue to stay local/ignored under
their recorded attribution terms.

## Open follow-ups

- **Open:** compiler-extracted iris/highlight RGBA texture, inpainted base eye,
  and aperture alpha. Once present, require rigid cage distances within
  `0.01 px`, inverse-registered texture preservation, monotonically decreasing
  visible alpha across blink samples, and zero iris alpha at full close.
- **Open:** add fixed inner-ROI border and triangle-Jacobian diagnostics for a
  pasted rectangular rim or a local jelly bulge that can remain inside the ROI.
- **Open:** calibrate any non-invariant inpaint/seam score once on a frozen
  accepted set, then evaluate it on a newly frozen hold-out without retuning.
