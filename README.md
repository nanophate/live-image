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
research/              findings, primary references, licenses, experiments
schemas/               .limg v1 JSON schema
tests/                 Python and TypeScript regression tests
inspect.html           detection-result viewer
viewer.html            independent .limg player
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

The generated `.limg` files are under `fixtures/compiled/`; overlays are under
`fixtures/overlays/`. Generated outputs are ignored because they are reproducible.

After the first online compile, verify fully offline compilation with:

```bash
npm run compile:fixtures:offline
```

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
```

The validated results and known limitations are in
[`research/experiments/2026-07-19-animation-validation.md`](research/experiments/2026-07-19-animation-validation.md).
The complete evidence index is [`research/README.md`](research/README.md).

## Current limitations

- Canvas 2D piecewise-affine patches, not a full WebGL2 semantic mesh yet.
- Mouth motion is deliberately small because a closed source image has no real
  teeth or oral cavity to reveal.
- Pupil location is deterministic local image analysis seeded by eye landmarks;
  it is not an iris-specific trained detector.
- No hair separation/lag, protected line-art field, TPS/ARAP, or head rotation yet.
- The detector/model cards say MIT, but do not warrant training-data provenance;
  commercial release still needs the review recorded in `research/license-matrix.md`.

The repository's own license has intentionally not been chosen. That is a
project-owner policy decision; third-party notices are recorded separately.

