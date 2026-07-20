# Full-resolution browser locality validation

Review date: **2026-07-20**

## Question

Does the real browser Canvas 2D path produce a visible blink, wink, gaze, and
mouth effect from automatic compiler output while keeping every changed pixel
inside the corresponding compiler-authored feature region?

## Environment and fixtures

- **Confirmed:** nodenv Node `24.18.0`, npm `11.16.0`;
- **Confirmed:** `@playwright/test==1.61.1` with its matching Chromium headless
  shell revision `1228` / Chromium `149.0.7827.55` and Playwright FFmpeg
  revision `1011`;
- **Confirmed:** Vite production build served by `vite preview` on loopback;
- **Confirmed:** one headless Chromium worker, device scale factor 1, no retry;
- **Confirmed:** the two primary source PNGs and their Compiler `0.3.0`
  automatically detected rigs. The tracked `fixtures/browser/*.rig.json`
  snapshots omit the image `dataUrl`; the test combines them with the existing
  tracked source PNGs in memory, so no duplicate image payload is committed.

The compiler/model identities and hashes remain embedded in each rig snapshot.
The browser test performs no model download and made no external page request.

## Acceptance contract

**Decision.** Compare every controlled state with a full-resolution canonical
neutral frame. The permitted regions are:

- blink and gaze: union of both `eye.region` values;
- wink: only the requested side's `eye.region`;
- mouth: `mouth.region`;
- all regions: one bitmap-pixel expansion for Canvas edge rasterization.

Every enabled controlled state must change at least one pixel in its permitted
region and zero pixels outside it. Neutral must change zero pixels. The existing
open → close → reopened sequence must still recover to zero full-frame pixel
difference. Console/page errors and non-loopback requests fail the test.

`breath` is intentionally not part of this local contract because the current
rig translates/scales the full image. A separate unit regression now requires
all controls, including breath, to remain neutral for a rejected asset.

## Result

**Confirmed.** After a first local run of `14.8 s`, repeated Playwright runs
passed in `9.8–10.7 s`. All **26 controlled fixture/state combinations** had a visible
in-region effect and exactly **0 changed pixels outside** their permitted
regions. Both neutral frames changed 0 pixels and both blink sequences reopened
with 0 full-frame differing pixels.

| Fixture | Blink/wink changed pixels | Gaze changed pixels | Mouth changed pixels | Outside pixels |
| --- | ---: | ---: | ---: | ---: |
| teal-librarian | 19,623–41,817 | 17,413–20,221 | 531–963 | 0 for every state |
| copper-courier | 15,207–32,544 | 13,926–15,693 | 849–1,510 | 0 for every state |

These are raw changed-pixel counts, not perceptual quality scores or thresholds.
The test logs every fixture/state count as `LOCALITY_EVIDENCE` for reproducible
failure diagnosis.

## Gate sensitivity check

**Confirmed failure.** A temporary, uncommitted fault drew one extra mouth
pixel at canvas coordinate `(0, 0)`, outside `mouth.region`. The browser suite
failed as required: the three mouth scenarios were marked
`comparison-cell-error`, and Playwright retained a screenshot and trace. The
fault was then removed with `apply_patch`; the final suite passed. This proves
the gate is not succeeding merely because the renderer or metric is a no-op.

## Dependency and license evidence

**Confirmed (local macOS x64 measurement).** The first browser install
downloaded a `98.7 MiB` Chromium headless-shell archive and a `1.3 MiB` FFmpeg
archive. Their extracted caches measured approximately `202 MiB` and `3.3 MiB`.
The direct Playwright npm directories measured approximately `17 MiB` combined.
These values are platform/version observations, not stable promises.

## GitHub Ubuntu 24.04 CI result

**Confirmed.** Draft PR #5 run
[`29724437177`](https://github.com/nanophate/live-image/actions/runs/29724437177)
passed both jobs. The Web job completed in `42 s`: `npm ci` took about `1 s`,
TypeScript tests `4 s`, the Vite build `2 s`, Chromium/dependency installation
`18 s`, and the browser-test step `8 s` (`1 passed (7.0s)` in Playwright's own
report). The separate Compiler job passed in `1 min 16 s`.

**Confirmed.** The cold Linux install downloaded a `114.2 MiB` Chromium
headless-shell archive and a `2.3 MiB` FFmpeg archive. The runner log confirms
the same Chromium `149.0.7827.55` / revision `1228` and FFmpeg revision `1011`
used by the local test. The workflow finished well inside its ten-minute job
timeout.

**Confirmed.** Playwright is Apache-2.0 with NOTICE; the downloaded headless
shell carries Chromium's BSD-style license and bundled third-party notices; the
downloaded FFmpeg cache carries `COPYING.LGPLv2.1`. They are CI/development
dependencies and are not copied into the Viewer build. Exact entries are in
[`../license-matrix.md`](../license-matrix.md) and
[`../../THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## Open limitations

- **Open:** measure the extracted browser-cache size and a deliberately warm
  cache run on Ubuntu before deciding whether CI caching is worth its own
  storage and provenance surface.
- **Open:** calibrate perceptual line/highlight preservation; a nonzero local
  change proves motion, not naturalness.
- **Open:** measure triangle seams at device scale factors 1.5, 2, and 3.
- **Open:** the 12-image matrix and local licensed hold-out remain status/
  capability gates plus manual Viewer evidence. Expanding browser pixel tests
  to them should be justified against CI time rather than tuned per image.
