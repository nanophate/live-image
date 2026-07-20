# Report-only support-domain descriptor probe

Date: **2026-07-20**

## Outcome

**Confirmed.** A deterministic, report-only probe now measures the local image
and geometry evidence around the face, eyes, and mouth selected by the actual
automatic compiler. It does not alter `quality.status`, disable a capability,
or add a runtime dependency.

**Confirmed locally.** The probe measured 12/12 cases from the existing public
quality-gate calibration suite without errors. This is only a descriptor-
feasibility replay: that suite has no unsupported-domain hard negatives and
does not satisfy the separate support-domain calibration protocol.

**Procedure failure.** The probe was also run over 5/5 external hold-out A cases
before the pre-registered hold-out B report was immutable. Although A's compiler
outcomes were already known, its values under these new descriptors were not.
That replay leaks evaluation evidence into future metric selection and is
therefore **contaminated exploratory evidence**, not hold-out validation or a
valid regression replay. The raw reports are preserved rather than hidden:

- [`2026-07-20-support-domain-probe-validation.json`](2026-07-20-support-domain-probe-validation.json)
- [`2026-07-20-support-domain-probe-holdout-a.json`](2026-07-20-support-domain-probe-holdout-a.json)

The reports explicitly label their evidence status, bind each source to its
artifact by SHA-256, dimensions, and Compiler 0.4.0 version, record OpenCV
4.10.0 and NumPy 1.26.4 plus the fixed processing contract, and contain no
wall-clock or absolute machine path.

**Confirmed locally.** Two consecutive regenerations were byte-identical. The
checked raw-report SHA-256 values are:

- quality-calibration feasibility: `739e37ed0c682cbe0848f83d061dd3cceefdb886bd3075bd16e705fc7c99996c`;
- contaminated A replay: `17517d5712967297b0bddf057b6ff6481328c77be91461ee6a619d01148ae21f`.

## Measurements

**Decision.** Resize the automatically detected face crop to 256×256, then use
fixed OpenCV operations already available in the compiler environment:

- Gaussian 5×5, sigma 1.0, then Canny 80/160 for feature-edge evidence;
- landmark-to-edge distance within 3 pixels for eye/mouth support;
- 3-pixel bands inside/outside compiler feature regions for boundary density;
- bilateral filter `d=7`, colour sigma 24, space sigma 5, then absolute
  grayscale difference divided by 255;
- 8-connected Canny component count/size after removing components below 3 pixels;
- fixed morphological close plus iris-core/outside-eyelid membership for an
  explicitly weak connected-edge-graph metric;
- source-pixel eye size, iris radii, safe gaze distance, and existing compiler
  geometry/confidence values.

The compiler's legacy `irisSegmentationConfidence` field is reported as
`compilerIrisGeometricEligibilityScore`, because its current implementation is
pupil confidence multiplied by retained ellipse scale rather than semantic
segmentation confidence.

**Decision.** Composite transparent source pixels on white before measuring.
This prevents arbitrary hidden RGB values under alpha zero from becoming false
texture evidence.

## Observations

**Confirmed.** On the existing 12-image quality-gate calibration suite,
whole-face bilateral absolute residual
mean ranged from `0.00660` to `0.01188`, and strong-edge components per 10k face
pixels ranged from `1.678` to `10.529`.

**Contaminated observation — do not select from it.** The painted A input
produced residual mean
`0.01563` and `17.548` strong-edge components per 10k pixels. Both are outside
the public calibration ranges. Its left/right eye landmark edge-support
fractions were `0.50` and `0.167`, while the accepted clean external portrait
measured `1.0` and `1.0`.

**Open.** These values suggest a calibration hypothesis, but they cannot be used
to select a descriptor subset, threshold, stopping criterion, or production
rule. Hold-out A's new descriptor values were opened out of protocol and there
is only one painted example. Any future rule must be chosen from the separate
support-domain calibration set without consulting this contaminated report.

**Confirmed.** Effective local resolution contains information hidden by the
current whole-image minimum dimension. The 192×192 calibration case has detected
eye heights of approximately `9.17` and `9.64` source pixels, versus roughly
`45` pixels or more for the normal-resolution public portraits.

**Inference from public calibration and algorithm geometry only.** A future
capability gate should measure the local eye/iris samples required by the Telea
stencil and rigid texture, not only the source image's shortest side. This
hypothesis does not use or depend on any local-resolution value from the
contaminated A replay.

## Reproduced limitation: crossing-line count is not a gate

**Confirmed.** A synthetic vertical stroke through the iris increases the
largest connected crossing component, so the probe responds to the intended
fault. However, most clean full-capability images also report one crossing
component because Canny eyelid/iris edges can become connected after the fixed
close operation. Transparent glasses likewise report crossing evidence while
remaining visually supported.

**Decision.** Keep `irisConnectedEdgeGraph` as raw experimental evidence only.
Do not disable iris layers from its current count or size. A production rule
needs stronger topology/orientation evidence and a calibration set containing
both true occlusions and benign connected line art.

**Confirmed.** Some public cases with a valid mouth control have zero mouth
landmark edge-support under this exact sampler. A single minimum edge-support
threshold would therefore create known false degradation. Descriptor groups
must be evaluated jointly and per control.

## Claim boundary and next action

**Decision.** No production threshold was selected, and Compiler 0.4 output is
unchanged. Mark the A report `contaminated-exploratory-replay`; exclude its
values from all metric/threshold decisions. The normal npm command path exposes
only the existing quality-calibration feasibility probe. The contaminated A
command is named explicitly so it cannot be mistaken for routine validation.

**Decision.** Next create the separately licensed domain-calibration set already
specified in [`../support-domain-gate.md`](../support-domain-gate.md), containing
supported and intentionally unsupported examples. Freeze the smallest useful
descriptor rule and its commit/hash using only that set, then run an unseen
hold-out B exactly once. Only after B is immutable may A be replayed under the
frozen rule and called a regression check.

**Open.** Strong-highlight iris extraction still needs a better pixel-support
measurement or segmentation method. The current descriptor probe explains
support risk but does not recover the missing iris/base-eye pair.

## Licensing and dependency impact

**Confirmed.** No dependency, model, weight, or sample image was added. The
probe uses pinned NumPy/OpenCV dependencies already recorded in
[`../license-matrix.md`](../license-matrix.md). Hold-out source images remain
local and ignored; the checked raw report contains numeric descriptors and
hashes only.
