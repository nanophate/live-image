# Detector baseline — 2026-07-19

## Question

Can an actual anime-specific detector find face, eyes and mouth landmarks on
more than one unrigged image without manual coordinates?

## Environment

- macOS 15.7.7, Intel x86_64
- Python 3.12
- `anime-face-detector==0.1.0`
- `torch==2.2.2`, CPU
- `numpy==1.26.4`
- `opencv-python-headless==4.10.0.84`
- detector: YOLOv3; landmarks: HRNetV2; flip test disabled for the quick baseline

## Inputs

- `fixtures/source/copper-courier.png`
- `fixtures/source/teal-librarian.png`

Both were generated specifically for this repository. See `fixtures/README.md`.

## Raw baseline result

| Fixture | Faces | Face score | Mean 28-point score | Expanded face bbox (pixels) |
| --- | ---: | ---: | ---: | --- |
| copper-courier | 1 | 0.998929 | 0.958048 | `[391.14, 343.36, 877.79, 887.52]` |
| teal-librarian | 1 | 0.999494 | 0.959862 | `[374.06, 294.02, 877.74, 814.43]` |

## Confirmed

- The actual model ran on CPU and returned one high-confidence face for both
  images; no coordinate was entered by hand.
- Eye landmark groups 11–16 and 17–22 align with the two drawn eyes in both
  outputs. Landmark 23 is the nose-area point; 24–27 describe the mouth/chin
  group and need face-scale-aware mouth-region derivation.
- The two outputs contain real detector offsets and asymmetry; they are not a
  template copied between images.

## Installation failure retained

The initial unconstrained 0.1.0 installation resolved NumPy 2.5.1 and OpenCV 5,
but the available PyTorch 2.2.2 x86_64 wheel emitted a NumPy 1.x ABI error.
Pinning NumPy 1.26.4 then conflicted with OpenCV 5. The working fix was to pin
OpenCV 4.10.0.84 as well. This is why `requirements/compiler.txt` contains all
three top-level pins instead of only the detector package.

## Next evidence

The compiler must save raw/derived points, overlay them, apply confidence gates,
and use those exact values to drive blink, gaze and mouth in the separate Viewer.
Passing this baseline alone does not establish animation quality.

That next evidence is now recorded in
[`2026-07-19-animation-validation.md`](2026-07-19-animation-validation.md).
