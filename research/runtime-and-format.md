# Runtime and `.limg` MVP direction

Snapshot: 2026-07-19

## Toolchain

**Confirmed:** Node.js 24.18.0 is the latest LTS release in the official Node.js
release table on the snapshot date. The repository pins that exact version in
`.node-version` for nodenv and declares the same line in `package.json`.

## Format

**Decision:** Version 1 is a single UTF-8 JSON document with the `.limg`
extension and an embedded source-image data URL. This is intentionally boring:
it is portable, inspectable, independently loadable, and needs no ZIP library.
The schema is versioned so a later binary/ZIP container can preserve the same
logical manifest.

Required groups:

- format/version and compiler identity;
- embedded image, dimensions, MIME type and SHA-256;
- original bbox/landmarks and detector/model provenance;
- semantic eye, pupil and mouth regions with confidence;
- image-relative rig ranges (not runtime magic numbers);
- behaviour defaults, fixed random seed and deterministic timing parameters;
- quality status, warnings, and disabled capabilities;
- source/model/license provenance.

## Renderer

**Decision:** Start with browser Canvas 2D and piecewise-affine feature patches.
It is available offline, easy to inspect, and enough to answer the first question:
can real detection offsets drive blink, small gaze and mouth without manual input?

The runtime redraws bounded eye/mouth regions from the original texture through
a compiler-defined grid. Boundary vertices stay fixed; inner vertices move. This
protects the rest of the face from jelly-like deformation. Blink compresses the
original iris/highlight texture together with the eyelids instead of pasting a
new eye drawing. Gaze shifts only the inner eye grid with a compiler-capped range.
Mouth opening is deliberately small because the source image contains no hidden
teeth or oral texture.

WebGL2 mesh rendering, protected line-art weights, TPS/ARAP and semantic hair lag
were identified as the next layer after the cross-image proof, not prerequisites
for it.

**Confirmed update (2026-07-20):** Compiler `0.3.0` subsequently added an
optional compiler-authored six-row eye mesh, embedded protected-line alpha
mask, and bounded mouth bands while retaining `.limg` version 1 fallback. Low
mouth-line confidence disables mouth motion instead of forcing an unreliable
band. Player loads are transactional: a failed replacement image or mask keeps
the last playable character. See
[`experiments/2026-07-20-local-deformation-validation.md`](experiments/2026-07-20-local-deformation-validation.md).

**Decision:** The JSON Schema is the portable structural contract. Cross-field
constraints that JSON Schema cannot express directly—strict row ordering,
feature-region containment, matching declared mask dimensions, and ordered Canny
thresholds—are enforced by `validateManifest` before runtime allocation or
drawing. The player then verifies the decoded PNG's natural dimensions before
allocating its protection layer. Both validation layers reject unsupported
deformation method identifiers.

**Decision:** Version-1 source images are limited to 8192 pixels per side and
33,554,432 total pixels. The player verifies the decoded source image's natural
dimensions against the manifest before resizing its main Canvas. Eye and mouth
anchors/ranges must be finite, ordered, feature-local values, and an asset must
contain exactly one left and one right eye.

## Public state API

The same API applies to every character:

```ts
player.setState({
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  mouthOpen: 0,
  breath: 0,
});
```

Values are normalised. The runtime clamps them against capability and rig ranges
stored by the compiler. Automatic idle behaviour is seeded and deterministic;
explicit input can override it.
