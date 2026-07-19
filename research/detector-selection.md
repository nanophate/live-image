# Detector selection and confidence policy

Snapshot: 2026-07-19

## Primary detector

**Decision:** Use `anime-face-detector` 0.1.0 at compile time:

- YOLOv3 finds near-frontal anime faces.
- HRNetV2 returns 28 anime facial landmarks.
- Runtime use is not required; compiled `.limg` files carry the result.
- The current package uses plain PyTorch, without its former OpenMMLab runtime.
- Code is MIT; vendored OpenMMLab-derived code is Apache-2.0.
- The model cards mark detector and landmark weights MIT.

**Confirmed locally:** Python 3.12 is available on the development machine.
The first install required compatibility pins because the x86_64 PyTorch 2.2.2
wheel did not initialise NumPy 2, while OpenCV 5 required NumPy 2. The working
combination is recorded in `requirements/compiler.txt`.

## Why not MediaPipe first

MediaPipe is attractive for on-device operation and Apache-2.0 code, but the
standard face tasks target photographs rather than anime drawings. It is useful
as a comparison adapter later, not as evidence that anime landmarks work.
MediaPipe's current repository privacy notice also says Tasks input stays on the
device while usage/performance metrics may be sent to Google. That behaviour
needs a separate strict-offline product review.

## Deterministic post-processing

The 28 landmarks identify face contour, eyebrows, six points per eye, a nose
point, and mouth/chin points. They do not fully describe pupils or eyelid curves.
The compiler therefore derives:

- eye polygons and padded local deformation regions from points 11–16 and 17–22;
- a pupil centre candidate from local grayscale/colour contrast, constrained by
  the detected eye polygon and a centre prior;
- a mouth control region from landmark geometry and face scale;
- confidence from detector score, landmark score, geometry, contrast and
  left/right consistency.

These derived values are stored in `.limg`; the runtime contains no per-image
coordinates.

## Capability gate

| Status | Behaviour |
| --- | --- |
| `full` | blink, gaze, mouth and breath enabled |
| `limited` | uncertain controls are disabled or have a reduced range |
| `reject` | compiler emits a diagnostic but does not pretend the asset is safe to animate |

Initial reject/limit signals include no face, multiple similarly strong faces,
non-frontal or badly asymmetric geometry, too many weak landmarks, an eye or
mouth outside the face, eye occlusion/insufficient contrast, and a face that is
too small for stable local warps.

## Supported envelope for the first proof

One near-frontal anime-style head-and-shoulders character, both eyes visible and
open, mouth visible, no glasses or face-covering accessory, and enough resolution
that each eye spans at least roughly 24 pixels. Rejection is expected outside
this envelope; silent broken animation is not.

