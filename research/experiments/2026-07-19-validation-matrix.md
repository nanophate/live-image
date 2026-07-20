# Twelve-image validation matrix and quality gate v2

Date: 2026-07-19

This experiment tests whether the automatic compiler reports uncertainty before
the runtime applies blink or gaze deformation to pixels that the detector did
not locate reliably. Expected outcomes were fixed in
[`../../fixtures/validation/manifest.json`](../../fixtures/validation/manifest.json)
before the first run over the ten new portraits.

## Inputs and method

- Four clean frontal portraits, two dark-iris portraits, two light/low-contrast
  iris portraits, one eye occlusion, one transparent-glasses portrait, one
  three-quarter portrait, and one 192×192 portrait.
- The two original project fixtures were reused. Ten original fictional young
  adult portraits were created with OpenAI's built-in image-generation tool;
  exact challenge prompts and shared exclusions are preserved in
  [`../../fixtures/validation/prompts.json`](../../fixtures/validation/prompts.json).
- The cached YOLOv3 + HRNetV2 detector was invoked once per case with
  `npm run validate:fixtures:offline`. One failing case does not abort the rest.
- Generated `.limg` and overlay files are reproducible and ignored. The compact
  expected-versus-actual report is checked in.

## First run: overconfident gate

**Confirmed:** all 12 images produced landmarks and a `.limg`, but the existing
quality policy classified every case as `full`. Only 7 of 12 frozen expectations
matched. The unmodified report is preserved as
[`2026-07-19-validation-before-quality-gate.json`](2026-07-19-validation-before-quality-gate.json).

| Case | Expected | First result | Signal the old gate ignored |
| --- | --- | --- | --- |
| light-iris-silver | limited | full | pupil confidence 0.487 |
| light-iris-peach | limited | full | pupil confidence 0.445 |
| occluded-left-eye | limited | full | eye confidence 0.544; symmetry 0.640 |
| three-quarter | limited | full | eye symmetry 0.536 |
| low-resolution-192 | limited | full | shortest side 192px |

**Inference:** the existence of 28 landmark points is not sufficient evidence
that blinking and gaze are safe. In the occluded case, the overlay places eye
geometry through the covering hair. Relative face size also made the 192px image
look deceptively strong even though it has too few source pixels for local warp.

## Quality policy v2

**Decision:** keep hard rejection for the existing unsupported envelope, then
disable only controls that depend on an uncertain signal:

| Signal | Limited threshold | Disabled capability |
| --- | ---: | --- |
| minimum pupil confidence | < 0.60 | gaze |
| minimum eye-region confidence | < 0.70 | blink and gaze |
| left/right eye-width symmetry | < 0.70 | blink |
| image shortest side | < 256px | blink and gaze |

The existing hard-reject thresholds remain unchanged: eye confidence or
symmetry below 0.48, face confidence below 0.70, mean landmark confidence below
0.62, or relative face scale below 0.22. The implementation contains no case ID
or category branches. Because this policy changes emitted capabilities, the
compiler identity was advanced from 0.1.0 to 0.2.0.

## Second run

**Confirmed:** the same offline command completed all 12 cases with 12/12 frozen
expectations matched: 7 `full`, 5 `limited`, 0 `reject`, and 0 `error`. The current
result is [`../../fixtures/validation/report.json`](../../fixtures/validation/report.json).

- Clean frontal, dark iris, and transparent glasses retain blink, gaze, and
  mouth controls.
- Light irises disable gaze while retaining blink and mouth.
- Eye occlusion disables blink and gaze while retaining mouth.
- The three-quarter case disables blink because the detected eye geometry is
  asymmetric.
- The 192px case disables blink and gaze based on absolute source resolution.

The validation runner rejects symlinked case-output directories before cleanup,
stores portable child-failure messages, and the report viewer accepts only the
runner's same-case relative artifact shapes. The production build includes the
compact sample report; generated `.limg` and overlay files remain reproducible
local artifacts.

## Limits and next validation

This is a calibration suite, not an independent accuracy estimate. Achieving
12/12 after selecting generic thresholds from these measurements proves the
gate is data-driven and reproducible; it does not prove generalisation to unseen
art. The next meaningful check is a hold-out set of properly licensed,
human-authored images whose expected outcomes are frozen before detector output
is inspected. Full cases should also receive rendered blink/gaze/mouth checks,
not only landmark and confidence inspection.
