# Runtime and `.limg` MVP direction

Snapshot: 2026-07-19

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
are the next layer after the cross-image proof, not prerequisites for it.

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

