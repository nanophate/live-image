# End-to-end animation validation — 2026-07-19

## Scope

Verify the requested first vertical slice using actual automatic detection
results, not hand-authored landmarks:

```text
PNG → detection → .limg → separate browser Player → blink / gaze / mouth / breath
```

## Compiled assets

| Fixture | Quality | Total score | Eye | Pupil | Mouth | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| teal-librarian | full | 0.946868 | 0.912757 | 1.000000 | 0.866526 | all MVP controls enabled |
| copper-courier | full | 0.955101 | 0.901704 | 0.853508 | 0.977404 | all MVP controls enabled |
| unsupported-no-face | reject | n/a | n/a | n/a | n/a | diagnostic JSON, compiler exit 2 |

The successful outputs are respectively about 2.1 MB and 3.0 MB because `.limg`
v1 embeds the original lossless PNG as a data URL.

## Browser verification

Environment: nodenv Node.js 24.18.0, Vite 7.3.6, in-app Chromium browser,
local Vite server, no runtime network dependency.

Confirmed by interaction:

- both generated `.limg` fixtures load through sample selection;
- `copper-courier.limg` also loads through the actual local file chooser;
- the same normalised six-control surface is shown for both characters;
- full bilateral blink removes the visible pupils/highlights by compressing the
  original eye texture and preserves recognisable eyelash line style;
- independent left/right blink controls work through separate eye patches;
- small gaze motion is capped by the compiled eye dimensions and pupil confidence;
- mouth opening remains deliberately small and uses a dark colour sampled from
  the source mouth region instead of a foreign pasted drawing;
- breath applies a sub-one-percent seeded procedural scale/lift;
- automatic idle is deterministic for a stored seed;
- the Inspector shows the raw 28 points, eye polygons, pupil candidates, mouth
  region, confidence metrics, model digests and provenance;
- changing characters resets the runtime values and now also resets the visible
  sliders (a UI/state mismatch found during this test was fixed);
- no browser warnings or errors were emitted on Inspector or Player during the
  verification session.

## Automated verification

- Python: normalisation clamp, pixel-derived pupil candidate, reject gate.
- TypeScript: schema acceptance/rejection, seeded behavior determinism, blink
  boundary protection, local gaze grid behavior.
- TypeScript typecheck and three-page Vite production build.

## Honest quality notes

- Blink is convincing for these two clean open-eye fixtures, but an eye crossed
  by bangs or an unusually thick highlight still needs a protected-line/occlusion
  regression case.
- Gaze is intentionally subtle. The current local grid shears the eye interior;
  a segmented iris texture or denser semantic mesh should improve rigidity.
- Mouth open is acceptable only as micro-motion. It cannot reveal real teeth or
  tongue from a closed single image.
- Breathing currently uses a small global transform around a compiler-selected
  lower-face/torso pivot. Foreground segmentation will be needed to keep the
  backdrop perfectly fixed for more visible motion.
- The two success images are generated fixtures inside the advertised supported
  envelope. More diverse licensed images, occlusions, low resolutions and hard
  rejects are required before claiming generality.

## Next validation set

At least 12 licensed or self-made images: four clean successes, two dark irises,
two light/low-contrast eyes, one one-eye occlusion, one glasses case, one three-
quarter pose, and one low-resolution input. Record every reject and capability
reduction rather than filtering the set after inference.

