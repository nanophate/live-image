# Living Image

Living Image compiles one near-frontal anime-style portrait into a portable,
controllable 2.5D character asset. The detector runs once; the browser runtime
is local, deterministic, model-free, and uses the same normalised state API for
every character.

This repository now proves the first vertical slice:

```text
PNG
  → anime-specific face + 28-point automatic detection
  → deterministic eye/pupil/mouth derivation + confidence gate
  → rigid iris/highlight texture + inpainted base eye when geometrically eligible
  → one self-contained .limg file
  → separate Inspector and Player
  → blink, gaze, mouth and breath through a common API
```

No landmark in the demo path is placed by hand. Unsupported input is rejected
or capability-limited rather than silently forced through.

## What is here

```text
compiler/              Python image compiler
src/                   TypeScript runtime, warp and UI
fixtures/source/       two original success fixtures + one no-face reject fixture
fixtures/holdout/      local-only hold-out manifest, provenance, and results
research/              findings, primary references, licenses, experiments
schemas/               .limg v1 JSON schema
tests/                 Python and TypeScript regression tests
inspect.html           detection-result viewer
viewer.html            independent .limg player
compare.html           deterministic multi-character motion comparison
```

## Setup

Node is deliberately pinned through nodenv:

```bash
nodenv install -s 24.18.0
npm ci

python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements/compiler.txt
```

Node 24.18.0 was the latest LTS release when selected on 2026-07-19. The Python
requirements include an Intel macOS compatibility pin for the PyTorch/NumPy ABI;
see [`research/detector-selection.md`](research/detector-selection.md).

The first compiler run downloads the MIT-labelled YOLOv3 and HRNetV2 weights
from their upstream Hugging Face model repositories. Later runs can require the
cache with `--offline`.

## Run the proof

```bash
npm run compile:fixtures
npm run dev
```

Open:

- [http://127.0.0.1:5173/inspect.html](http://127.0.0.1:5173/inspect.html) for detector evidence
- [http://127.0.0.1:5173/viewer.html](http://127.0.0.1:5173/viewer.html) for the separate player
- [http://127.0.0.1:5173/validate.html](http://127.0.0.1:5173/validate.html) for the multi-image validation report
- [http://127.0.0.1:5173/compare.html](http://127.0.0.1:5173/compare.html) for fixed blink, gaze, and mouth comparisons plus a sequential blink close/reopen strip

The generated `.limg` files are under `fixtures/compiled/`; overlays are under
`fixtures/overlays/`. Generated outputs are ignored because they are reproducible.

After the first online compile, verify fully offline compilation with:

```bash
npm run compile:fixtures:offline
```

Run the 12-image generalisation suite with the cached detector models:

```bash
npm run validate:fixtures:offline
```

The checked-in `fixtures/validation/report.json` preserves expected-versus-actual
outcomes. Large generated `.limg` and overlay artifacts stay ignored and can be
regenerated locally for the report viewer. The current calibrated result is 7
full and 5 capability-limited cases with no errors; the initial 7/12 mismatch
and its limitations are preserved in
[`research/experiments/2026-07-19-validation-matrix.md`](research/experiments/2026-07-19-validation-matrix.md).

Run the independent external hold-out without network access after the detector
models are cached:

```bash
npm run check:holdout:local
npm run validate:holdout:offline
```

The externally licensed PNG inputs are deliberately ignored by Git. Place them
under `fixtures/holdout/source/` using the documented names; the check command
verifies their presence and frozen SHA-256 values before compilation.

Its frozen first result was 3/5 expected outcomes. The stricter Compiler 0.4
full-ellipse containment gate now records 2/5: the prior strong-highlight full
case is capability-limited rather than moving an eyelid-clipped iris texture.
The mismatch is intentionally not tuned away; the one-eye-closed image remains
a safe-side reject, while a painted semi-realistic portrait exposes a missing
style-domain gate. The frozen baseline and motion review are in
[`research/experiments/2026-07-20-holdout-motion-validation.md`](research/experiments/2026-07-20-holdout-motion-validation.md),
and the stricter Compiler 0.4 result is in
[`research/experiments/2026-07-20-iris-base-eye-validation.md`](research/experiments/2026-07-20-iris-base-eye-validation.md).

## Compile another image

```bash
PYTHONPATH=. .venv/bin/python -m compiler.compile_character \
  path/to/portrait.png \
  --output-dir output \
  --overlay-dir output/overlays
```

The first supported envelope is intentionally narrow: one sufficiently large,
near-frontal anime head, both eyes and the mouth visible, without face-covering
hair or accessories. A rejected file produces `*.diagnostic.json` and exit code
2. A limited asset records disabled capabilities in its `.limg`.

## Runtime API

```ts
import { LivingImagePlayer } from "./src/runtime.js";
import { parseLivingImage } from "./src/schema.js";

const manifest = parseLivingImage(await file.text());
const player = new LivingImagePlayer(canvas);
await player.load(manifest);
player.start();

player.setState({
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0.35,
  gazeY: -0.1,
  mouthOpen: 0.25,
  breath: 0,
});
```

All values are normalised. Per-image motion ranges and feature coordinates live
in the compiled asset, not in runtime branches. Rejected or disabled controls
are gated by the player.

## Verify

```bash
npm test
npm run build
npx playwright install --only-shell chromium
npm run test:browser
```

The browser suite uses the Compiler 0.4.0 automatic rigs for both primary
fixtures, reads the real full-resolution Canvas, and requires every enabled
blink, wink, gaze, and mouth state to change pixels only inside its
compiler-authored feature region. Eye states additionally require every opaque
protected-mask core pixel to preserve RGB within one level while clear-mask
pixels still move. Browser-executed motion-plan evidence additionally requires
each selected Compiler 0.4 iris cage to retain its dimensions, translate in the
requested gaze direction, and reach zero alpha at full blink/wink. A second
render with transparent iris textures provides direct Canvas evidence: every
visible selected iris must contribute pixels, while full blink/wink must
contribute zero. The suite also requires exact open-state recovery and makes no
external page requests. After
regenerating `fixtures/browser` rigs, run `npm run build` before the
preview-backed browser test. Playwright's browser and FFmpeg downloads are
development/CI-only and are not bundled into the Viewer.

The animation and multi-image validation results are in
[`research/experiments/2026-07-19-animation-validation.md`](research/experiments/2026-07-19-animation-validation.md)
and [`research/experiments/2026-07-19-validation-matrix.md`](research/experiments/2026-07-19-validation-matrix.md).
The independent hold-out and common-state renderer are documented in
[`research/experiments/2026-07-20-holdout-motion-validation.md`](research/experiments/2026-07-20-holdout-motion-validation.md).
The real-browser locality gate is documented in
[`research/experiments/2026-07-20-browser-locality-validation.md`](research/experiments/2026-07-20-browser-locality-validation.md).
The protected-pixel gate and current DPR/iris claim boundary are documented in
[`research/experiments/2026-07-20-eye-preservation-metrics.md`](research/experiments/2026-07-20-eye-preservation-metrics.md).
The Compiler 0.4 iris/base-eye implementation and cross-image evidence are in
[`research/experiments/2026-07-20-iris-base-eye-validation.md`](research/experiments/2026-07-20-iris-base-eye-validation.md).
The complete evidence index is [`research/README.md`](research/README.md).

## Current limitations

- Compiler-authored Canvas 2D piecewise-affine feature meshes with protected
  eye-line masks and optional rigid iris/base-eye layers, not a full WebGL2
  semantic mesh yet.
- Mouth motion is deliberately small because a closed source image has no real
  teeth or oral cavity to reveal.
- Pupil/iris extraction is deterministic local image analysis seeded by eye
  landmarks; the fitted contained ellipse is not a semantic iris detector, and
  geometrically ineligible cases disable blink/gaze.
- The inpainted base eye is a small deterministic fill, not recovered hidden
  sclera. No hair separation/lag, TPS/ARAP, or head rotation exists yet.
- The detector/model cards say MIT, but do not warrant training-data provenance;
  a commercial compiler bundle still needs the review recorded in
  `research/license-matrix.md`.

## Responsible use

Use Living Image lawfully and responsibly. In particular, do not use character
images or likenesses without the necessary rights, or use animated characters
for impersonation, fraud, harassment, exploitation, or deception. This is a
community request and does not add restrictions to the MIT License.

## License

Project-authored source code is available under the [MIT License](LICENSE), with
the public project-level notice `The live-image Authors`; no personal legal name
or commercial contact is published. Third-party code, models, weights, data, and
sample assets retain their own terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
and [`research/license-matrix.md`](research/license-matrix.md).
