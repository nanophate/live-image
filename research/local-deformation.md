# Deterministic local deformation for eyes and mouth

Review date: **2026-07-20**

Scope: the next deformation layer after the current fixed-boundary Canvas 2D
grid. This note covers only deterministic, compiler-authored local motion. It
does not select a new detector or introduce a learned runtime component.

Status: **design target, not a claim that every item below is implemented.**
The first implemented subset is Compiler `0.3.0`'s six-row eye cage,
protected-line mask, and bounded mouth bands. Explicit triangle lists,
per-vertex mobility, rigid iris/highlight extraction, inpainting, and
signed-area guards remain open. The implemented subset and its failures are in
[`experiments/2026-07-20-local-deformation-validation.md`](experiments/2026-07-20-local-deformation-validation.md).

## Target recommendation

**Decision.** Retain a **compiler-authored piecewise-affine triangle mesh** for
each eye and the mouth. Add two compiler-produced protections rather than
replacing the warp with TPS or MLS:

1. a protected-line mask that restores unrelated line art after the local warp;
2. an automatically extracted iris/highlight texture that moves rigidly and is
   clipped by the deforming eye aperture.

The compiler must store vertices, triangle indices, fixed/movable weights,
masks, extracted textures, motion limits, and gate results in `.limg`. The
runtime only interpolates the stored vertices, rejects inverted triangles, and
draws clipped affine triangles. There are no image-specific constants in the
runtime and no per-frame image analysis.

**Inference.** This is the smallest change that directly addresses the current
failure modes. A smoother warp does not by itself know that a bang, glasses
edge, iris, or highlight should remain rigid, nor does it model the eyelid
occluding the iris. Explicit masks and draw order do.

## Primary evidence

**Confirmed.** Schaefer, McPhail, and Warren formulate MLS image deformation
from point or line-segment handles and provide affine, similarity, and rigid
variants. Their weights vary with the evaluation point, so the mapping is
evaluated across the image rather than confined to one triangle. See the
[author-hosted paper](https://people.engr.tamu.edu/schaefer/research/mls.pdf)
and [ACM record](https://doi.org/10.1145/1179352.1141920).

**Confirmed.** Bookstein's thin-plate spline is a bending-energy interpolant
over landmarks. The standard 2-D kernel is `r^2 log(r)` and requires a global
linear system plus an affine polynomial term. See the
[IEEE paper](https://doi.org/10.1109/34.24792) and current
[SciPy RBFInterpolator documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.RBFInterpolator.html).
SciPy uses all points unless a nearest-neighbour subset is explicitly selected.

**Confirmed.** Triangle-mesh deformation is an established way to constrain
distortion locally. Igarashi, Moscovich, and Hughes represent a shape with a
triangle mesh and solve for free vertices while minimizing per-triangle
distortion in their
[as-rigid-as-possible paper](https://cs.brown.edu/people/jhughes/papers/Igarashi-ASM-2005/main.htm).
Content-aware mesh research likewise treats salient image structure as a mesh
constraint rather than assuming geometric smoothness will preserve it; see the
[UW Graphics primary project page](https://graphics.cs.wisc.edu/Papers/2009/GLSZG09/)
and the [structure-line-preserving paper record](https://doi.org/10.1109/TMM.2012.2228475).

**Confirmed.** The Live2D editor manual uses the white-eye ArtMesh as a clipping
mask for the black eye, highlights, and eyeball, and says clipping masks are
commonly used for blinking. It also documents translucent mask rims as a real
artifact. This is design precedent for iris/aperture separation, not a proposal
to use Cubism code or data. See the
[official clipping-mask manual](https://docs.live2d.com/en/cubism-editor-manual/clipping-mask/).

**Confirmed baseline before Compiler 0.3.0.** The earlier
[`warp.ts`](../src/warp.ts) used fixed patch boundaries and affine textured
triangles. Its eye grid had one pupil column and collapsed both inner rows
during a blink, so pupil and highlight pixels were vertically compressed into
the closing seam. That baseline had no protected-line mask. The implemented
0.3.0 subset is described in the experiment record linked above.

## Method comparison

| Method | Locality and shape | Runtime/format cost | Fit for this MVP |
| --- | --- | --- | --- |
| Piecewise-affine triangles | Exact support per triangle; fixed boundary has no influence outside the patch; affine within each triangle; only C0 across edges | Small stored mesh; one affine draw per triangle; current runtime already implements it | **Adopt.** Explicit, bounded, testable, and sufficient for small motion |
| Thin-plate spline (TPS) | Smooth bending-energy interpolation, but the standard kernel has broad/global support; boundary pins reduce but do not remove broad coupling | Dense solve when controls change, then per-pixel or tessellated evaluation; extra conditioning and fold checks | **Reject for MVP.** Smoothness increases the risk of a jelly-like patch and does not solve semantic occlusion |
| Moving least squares (MLS) | Smooth handle-driven affine/similarity/rigid maps; influence decays with distance but canonical MLS is not triangle-bounded | Transform evaluation depends on all handles for each sample unless a map is precomputed; line handles add authoring/format complexity | **Reject for MVP.** More work than the bounded mesh and still needs masks/layers |
| ARAP mesh solve | Better local rigidity under large manipulation | Constraint solve and matrix data; rigidity resists the intentional squash needed for a blink | **Defer.** Reconsider only for larger head/hair motion |

**Inference.** Piecewise-affine C0 derivative changes can show as triangle seams
under large motion. With patches limited to small movements, denser triangles,
fixed padded boundaries, and compile-time inversion checks are a better trade
than introducing a global smooth warp now.

## Target compiler output

### 1. Feature mesh

**Decision.** Build each feature mesh at compile time and store it verbatim.
Start with a regular **7-column by 5-row** cage, then insert the detected eyelid
anchors or mouth controls and the four corners of the iris cage. Triangulate
once with a stable vertex order. The outer ring is fixed. A normal eye should
remain under roughly 80 triangles; exact topology is data, not runtime policy.

Store, per feature:

- source vertices and triangle indices;
- control role (`boundary`, `lidUpper`, `lidLower`, `iris`, `mouthUpper`, or
  `mouthLower`), plus a `[0,1]` mobility value;
- protected-line mask, active-stroke exclusion mask, and one-pixel feather;
- for eyes, base-eye patch, iris/highlight RGBA texture, iris cage, and source
  aperture polygon;
- maximum displacement and all close/open bias values;
- minimum signed-area ratio observed by the compiler's canonical-state test.

**Decision.** Sample each control at `0, .25, .5, .75, 1` and at gaze corners
during compilation. Every destination triangle must retain its source winding
and at least **2%** of its source signed area. Deterministically binary-search
the maximum displacement down if the test fails; disable that capability if no
useful range passes. The 2% value is an initial safety threshold to calibrate,
not a confirmed perceptual boundary.

### 2. Protected line art

**Decision.** Produce protection masks with the already-pinned OpenCV compiler,
not at runtime:

1. convert the padded feature crop to 8-bit luminance and blur with a `3x3`,
   `sigma=0.8` Gaussian;
2. estimate gradient magnitude and set Canny `high` to its non-zero 85th
   percentile and `low = 0.4 * high`, with `L2gradient=true`;
3. retain connected edge components that touch the padded ROI boundary and are
  at least `0.6 * eyeWidth` (or `0.6 * mouthWidth`) long as a force-protected
  set; these are likely occluding bangs, glasses, accessories, or face contours;
4. remove the active eyelid or lip corridor from other edge pixels, then union
   the force-protected set back into the mask;
5. dilate by `clamp(round(0.02 * featureWidth), 1, 3)` pixels, retain a hard
   core, and add a one-pixel outward alpha feather.

The active corridor starts at `max(2 px, 0.18 * eyeHeight)` around the detected
lid polylines and `max(2 px, 0.25 * mouthROIHeight)` around the mouth centreline.
Boundary-touching long components remain protected even when they cross an
active corridor.

**Confirmed.** OpenCV documents Canny as a localized edge detector, dilation as
expanding binary foreground, and `distanceTransform` as distance to the nearest
zero pixel. These are sufficient deterministic primitives for the mask and
feather: [Canny](https://docs.opencv.org/master/da/d5c/tutorial_canny_detector.html),
[morphology](https://docs.opencv.org/master/d9/d61/tutorial_py_morphological_ops.html),
and [distance transform](https://docs.opencv.org/master/d7/d1b/group__imgproc__misc.html).

**Decision.** Multiply non-control vertex displacement by its stored mobility,
where protected-core vertices are `0`, vertices beyond the feather are `1`, and
the feather interpolates between them. After drawing the warped patch, composite
the original protected-line pixels back at their original local positions. Do
not protect the intended eyelid/lip stroke: it must deform.

**Open.** A geometry-only active corridor can misclassify a bang that lies
entirely inside the eye and does not reach the ROI boundary.

**Decision.** If a strong edge crosses the aperture but cannot be classified as
target lid/iris line art, mark the eye occluded and disable blink/gaze rather
than animate through it.

### 3. Iris and highlight preservation

**Decision.** Extend the existing deterministic pupil estimate into an iris
ellipse/cage. The RGBA extraction mask covers the full ellipse, not only dark
pixels, so highlights inside it remain part of the same texture. Reject the
layer if its centre is outside the eye polygon, it intersects an eyelid by more
than 25% of its minor radius, or its segmentation confidence is below the
calibrated gaze threshold.

Create a base-eye patch by inpainting the iris mask from its boundary with
OpenCV Telea inpainting and
`radius = clamp(round(0.06 * eyeWidth), 2, 6)`. OpenCV specifies that `inpaint`
reconstructs a selected region from pixels near its boundary; see the
[official API](https://docs.opencv.org/master/d7/d8b/group__photo__inpaint.html).
The result is compiler-derived texture data, not a generated frame.

At runtime:

1. draw the inpainted base-eye patch through the eyelid mesh;
2. translate the iris cage without scale, shear, or rotation for gaze;
3. clip it to the current eyelid aperture polygon;
4. set
   `irisAlpha = smoothstep(closeFloor, closeFloor + 0.35 * irisDiameter, apertureHeight)`
   so no bright pixels survive as a line at full closure;
5. reduce gaze displacement by `(1 - blink)` and return it to zero as the lid
   closes.

The maximum gaze translation is compiler-capped to the smaller of
`0.10 * eyeWidth` and the measured aperture clearance minus one pixel. A full
blink moves the upper lid farther: start the close seam at
`topY + 0.70 * apertureHeight`, with a stored full-close floor of
`max(1 px, 0.035 * eyeHeight)`. Interpolate with smoothstep. These are initial
parameters to validate across the existing matrix, and belong in `.limg`.

**Inference.** Rigid translation preserves the pupil, iris pattern, and
highlight geometry in open-eye gaze. Aperture clipping models disappearance
behind the eyelid rather than crushing those pixels into the blink seam. The
compiler-created base patch prevents a second, stationary iris from remaining
under the translated layer.

**Open.** Inpainting is not evidence of hidden sclera; it is a deterministic
fill used only behind a small moving/occluded layer. Large irises, patterned
sclera, gradients, or unreliable masks can expose obvious invented texture.

**Decision.** Gate on extraction and inpaint boundary error, cap motion, and
disable gaze or blink when the patch is not credible.

### 4. Mouth motion

**Decision.** Replace whole-strip vertical scaling with the same local triangle
mesh. Keep the outer ring and mouth corners fixed. Move upper/lower centreline
controls by `-0.45 * gap` and `+0.55 * gap`; multiply displacement across x by
a tent weight that is one at the centre and zero at the corners. Draw the
compiler-sampled dark interior behind the two bands.

Set the initial maximum gap to
`min(0.12 * mouthWidth, 0.025 * faceHeight, 13 px)`. Disable mouth motion below
three useful output pixels or when canonical triangle checks fail. Protect all
strong line art except the active lip corridor. This deliberately does not
invent teeth or tongue texture.

## Target acceptance and failure policy

**Decision.** Add the following checks before calling the change successful:

- exact neutral and reopened output equality, retaining the existing endpoint
  test;
- no triangle winding change and the stored 2% minimum-area guard at all
  canonical samples;
- zero displacement outside each fixed boundary, and protected-core RGB error
  no greater than one 8-bit level before the global breath transform;
- iris/highlight cage width, height, and pairwise feature distances unchanged
  under gaze within `0.01 px` in geometry tests;
- visible iris/highlight area decreases monotonically over blink samples and is
  zero at full close;
- no more than a one-pixel seam on a high-contrast synthetic grid;
- visual transition review on every accepted validation and hold-out image,
  including eyes with large highlights and boundary-crossing hair/accessories.

**Decision.** Reject or disable the affected capability when the iris layer,
protected-line classification, inpaint boundary, or triangle safety test fails.
Do not silently fall back to a full-patch smooth warp.

## License and provenance implications

**Confirmed.** The pinned compiler already uses
`opencv-python-headless==4.10.0.84`. OpenCV 4.5.0 and later are Apache-2.0 under
the [official license statement](https://opencv.org/license/), so the proposed
Canny, morphology, distance-transform, and inpaint calls add no new dependency,
weights, or training data. Existing Apache notices still apply.

**Decision.** Implement the triangle interpolation, masks, and draw order in
project-authored code. The cited TPS, MLS, ARAP, and content-aware papers are
research evidence; their prose, figures, and any unlicensed reference code must
not be copied. A paper link is not a software license.

**Confirmed.** Live2D Cubism Core is governed by Live2D's
[proprietary software agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html),
and SDK publication can have separate terms described on the
[official SDK license page](https://www.live2d.com/en/sdk/license/).
Use the public clipping-mask manual only as conceptual evidence. Do not import
Cubism code, binaries, sample models, or ArtMesh data into this implementation.

**Inference.** Compiler-extracted masks, inpainted patches, and iris textures
are derivatives of the user's source image. They inherit that asset's
provenance and redistribution constraints when embedded in `.limg`; they are
not covered merely by the project's source-code license.

**Open.** No independent patent or freedom-to-operate review was performed for
the mathematical methods. Before commercial release, legal review should cover
the project-authored implementation and the use of OpenCV algorithms rather
than assuming that a paper's age or a library's code license resolves every
patent question.

## Open validation questions

**Confirmed implementation checkpoint.** The current mask-capable rigs now
have a real-browser protected-core gate: fully opaque mask pixels retain RGB
within one 8-bit level, clear-mask pixels must still change, and bypassing
the protected composite reproduces a failure. Exact formulas, two-rig results,
and the current iris/highlight claim boundary are in
[`experiments/2026-07-20-eye-preservation-metrics.md`](experiments/2026-07-20-eye-preservation-metrics.md).

- **Open.** Calibrate the edge percentiles, corridor widths, 2% area floor,
  iris overlap gate, inpaint radius, and motion caps on a newly frozen set; the
  numbers above are pre-registered starting values, not measured quality claims.
- **Open.** Determine whether boundary-connected components reliably separate
  bangs/accessories from eyelids across the supported anime domain.
- **Decision.** The current Canvas backing store is fixed to manifest pixels,
  so changing browser DPR does not change triangle rasterization. Measure
  ratios 1, 1.5, 2, and 3 after introducing an explicit DPR/render-scale mode;
  until then a DPR matrix would cover only CSS compositing.
- **Open.** Compare blink frames with and without the iris/base split. Adoption
  requires less highlight crushing without a worse pasted-patch or inpainting
  artifact rate.
