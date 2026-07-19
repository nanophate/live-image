# Validation fixtures

This directory contains the public 12-image generalisation suite. Its expected
outcomes were written before running the detector over the new images; mismatches
must be recorded rather than changing the expectation to match the implementation.

## Composition

| Category | Count | Expected behavior |
| --- | ---: | --- |
| clean frontal | 4 | full blink, gaze, and mouth controls |
| dark iris | 2 | full controls; local pupil analysis must not collapse into eyelashes |
| light/low-contrast iris | 2 | keep blink and mouth, reduce or disable gaze when necessary |
| one-eye hair occlusion | 1 | capability-limited rather than confidently warping hidden content |
| transparent glasses | 1 | full controls when both eyes remain visible |
| three-quarter pose | 1 | capability-limited inside the approximately 30-degree product boundary |
| low resolution | 1 | capability-limited rather than treating limited pixels as high confidence |

`clean-teal.png` and `clean-copper.png` are copies of the two original fixtures
documented in [`../README.md`](../README.md). The other ten portraits were created
for this suite with OpenAI's built-in image-generation tool on 2026-07-19. They
depict original fictional young adult characters and intentionally do not imitate
an existing character, franchise, artist, or identifiable person.

Every generation prompt requested a square, single-character, head-and-shoulders
2D anime illustration on a plain background with no text, logo, watermark,
signature, hands, props, or additional faces. The per-case subject and challenge
specifications are preserved in [`prompts.json`](prompts.json).

`low-resolution-192.png` was generated at full size, then deterministically
downsampled to 192×192 with ImageMagick. Generated `.limg`, overlay, and diagnostic
artifacts are reproducible and ignored; `report.json` is the checked-in result.

Run the suite after the detector checkpoints have been cached:

```bash
npm run validate:fixtures:offline
```
