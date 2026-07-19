# Related-work assessment

Snapshot: 2026-07-19

## Result

**Decision:** The MVP will not run a learned video/image generator each frame.
It will compile semantic controls once, then use deterministic local image warps
and procedural state blending in the runtime. The main reusable ideas are:

1. compiler/asset/player separation from Meta Animated Drawings;
2. semantic expression parameters from Talking Head Anime and AnimeCeleb;
3. local affine/TPS deformation and blending masks from FOMM/TPS literature;
4. eye/lip retargeting and boundary stitching concepts from LivePortrait;
5. contour-aware mesh generation from SPRITETOMESH;
6. declarative motion assets from LiveSVG and MG-Gen.

## Technology notes

### Talking Head Anime 3

- **Confirmed:** The demo drives expression, head/body rotation, and breathing
  from a single illustration, but requires a capable NVIDIA GPU. Code is MIT;
  the published model files are CC BY 4.0.
- **Useful:** A compact, named parameter surface for eyes, mouth, head and breath.
- **Decision:** Reference its control taxonomy, not its neural per-frame runtime.

### Talking Head Anime 4

- **Confirmed:** The work distils a character-specific poser for real-time use,
  but its preparation relies on manually made facial-organ masks and per-character
  training. Published demo assets/models include CC BY-NC 4.0 material.
- **Decision:** Do not place it on the commercial path. Its compile-once idea is
  useful, but its manual masks conflict with the project's primary path.

### First Order Motion Model

- **Confirmed:** FOMM uses learned keypoints, local affine transformations,
  dense motion and occlusion handling to animate an object category from driving
  video. The repository code is MIT.
- **Inference:** Its learned points are not stable semantic `eyeLeft`/`mouthOpen`
  controls, so the whole model is a poor runtime API foundation here.
- **Useful:** Local transforms, confidence/occlusion masks, and blend fields.

### Thin-Plate Spline Motion Model

- **Confirmed:** The CVPR 2022 model uses multiple TPS transforms for more
  expressive image motion from a driving video.
- **Decision:** Implement small, bounded TPS or piecewise-affine warps ourselves
  from compiler-produced semantic points. Do not depend on its generator or
  checkpoints for the MVP.

### LivePortrait

- **Confirmed:** LivePortrait provides portrait animation with explicit eye and
  lip retargeting/stitching controls. The project code is MIT, but its own license
  warns that bundled InsightFace models are non-commercial and must be replaced
  for commercial use.
- **Decision:** Use only algorithmic ideas and comparison outputs. Do not import
  InsightFace models or make LivePortrait a runtime dependency.

### AnimeCeleb

- **Confirmed:** The work supplies pose/expression labels for anime head motion.
- **Open:** The repository did not expose a clear reusable license at review time,
  and dataset availability/provenance needs a separate audit.
- **Decision:** Borrow the concept of compact semantic states only; do not copy
  dataset, code, or weights.

### SPRITETOMESH

- **Confirmed:** The paper describes generating animation-ready 2D meshes from
  raster sprites using silhouettes and internal image boundaries.
- **Open:** An official implementation and reusable dataset license were not
  confirmed in this review.
- **Decision:** Independently implement the needed contour sampling and local
  mesh construction later; the first eye/mouth proof can use bounded patches.

### Meta Animated Drawings

- **Confirmed:** The archived repository separates character detection/rigging
  from a renderer, and uses ARAP deformation. The code and detector artifacts in
  the repository are MIT; the papers also document licensed research datasets.
- **Decision:** This is the strongest architectural precedent for Compiler →
  portable character description → separate Runtime, though its full-body child
  drawings do not provide anime eyelid/iris semantics.

### See-through

- **Confirmed:** See-through decomposes a single illustration into layers using
  multiple large model dependencies; code is Apache-2.0.
- **Open:** End-to-end commercial clearance depends on every model and training
  source, not only the repository license.
- **Decision:** Keep as an optional compile-time experiment after the landmark-
  driven MVP. It must never be required to produce a minimal `.limg`.

### MG-Gen

- **Confirmed:** MG-Gen produces declarative motion-graphics programs and uses a
  remote multimodal model in its workflow. Its repository is AGPL-3.0.
- **Decision:** The declarative asset principle is relevant; generated JavaScript,
  remote-model dependence, and AGPL code are not part of the MVP.

### LiveSVG

- **Confirmed:** LiveSVG combines group-level transformations with local path
  deformation for SVG motion.
- **Open:** An official reusable implementation license was not confirmed.
- **Decision:** Reference the layered transformation idea, but the input here is
  raster and must remain renderable without vectorisation.

