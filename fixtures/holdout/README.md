# External licensed hold-out A

This five-image set is independent of the generated calibration fixtures. The
inputs come from five OpenGameArt contributors under CC0 or CC BY 3.0, but the
PNG files are local test data and are deliberately ignored by Git. Exact
sources, authorship evidence, licenses, integrity hashes, and required
attribution are recorded in [`ATTRIBUTION.md`](ATTRIBUTION.md); local setup is
described in [`source/README.md`](source/README.md).

The manifest expectations were frozen from visual inspection on 2026-07-20,
before running the detector on any of these files:

| Case | Frozen expectation | Visual reason |
| --- | --- | --- |
| stevenburrow sample 1 | full | near-frontal, both eyes open, visible mouth |
| mcproject manga girl | full | large frontal face; strong iris highlights are the challenge |
| Kitsuge casual avatar 00 | limited | one eye is closed; blink and gaze should be gated |
| Jupiter's Daughter maid | reject | full-body layout makes the face too small |
| zonked painted portrait | reject | deliberately outside the anime-style support envelope |

Do not change these outcomes after observing confidence values. If this set is
used to tune the compiler or runtime, it becomes a regression set and a new
unseen hold-out must be selected.

After detector checkpoints have been cached, run once through the production
compiler path:

```bash
npm run check:holdout:local
npm run validate:holdout:offline
```

The check command proves that all five local inputs exist and match their frozen
SHA-256 values. Source PNGs, generated `.limg` files, and overlays are ignored.
The first raw result must be preserved before any implementation response to a
mismatch.

## First result

The untouched first run matched **3 of 5** frozen expectations. The one-eye-
closed case was rejected rather than capability-limited, and the semi-realistic
painted case passed as `limited` with gaze disabled. No thresholds were changed
in response. See the checked [`report.json`](report.json), the preserved raw
copy, and the analysis in
[`../../research/experiments/2026-07-20-holdout-motion-validation.md`](../../research/experiments/2026-07-20-holdout-motion-validation.md).

After compilation, start the local Viewer and open `compare.html` with these
generated `.limg` files (by file selection or repeated `?asset=` parameters) to
render fixed blink, gaze, and mouth states side by side.
