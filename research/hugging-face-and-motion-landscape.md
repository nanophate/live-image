# Hugging Face and single-image motion landscape

Review date: 2026-07-20

## Question and scope

This review asks whether an existing application, model, or Hugging Face Space
already provides the intended Living Image pipeline:

```text
single anime image
-> automatic analysis or compilation
-> reusable per-character asset
-> lightweight, deterministic, local runtime
-> semantic blink / gaze / mouth / breath controls
```

The review distinguishes an official project from a community wrapper or model
mirror. A browser UI hosted on Hugging Face is not evidence that inference runs
in the browser: most reviewed Spaces send inputs to Python on a remote CPU/GPU.
Code, pretrained weights, training data, sample media, and transitive models are
also reviewed as separate provenance surfaces.

## Result

- **Confirmed:** Hugging Face contains many convincing "one image becomes a
  video" demos, but the reviewed systems normally run a neural renderer for
  every output frame and return a video. They do not compile a portable asset
  for a separate deterministic runtime.
- **Confirmed:** Talking Head Anime 4 (THA4) is the closest architectural
  precedent. It distils a character-specific model smaller than 2 MB for
  real-time use, but requires a manually prepared eye/mouth mask, configuration,
  and roughly 30 hours of training in the author's RTX A6000 example. Its
  published browser-conversion code is not available.
- **Confirmed:** Meta Animated Drawings is the closest explicit-asset precedent:
  analysis produces masks, textures, joints, and configuration that a separate
  renderer can consume.
- **Decision:** Do not replace the current Compiler -> `.limg` -> Runtime design
  with a generic portrait-video model. Use selected neural systems only as
  comparison oracles and sources of algorithmic ideas unless a later,
  separately approved compiler backend passes the full license/provenance audit.
- **Decision:** The next main-path experiment should compile deterministic
  semantic meshes and weight fields. This is more directly useful than
  integrating a large pretrained video generator.

No reviewed code, model, data, or sample asset was adopted in this checkpoint.
Therefore these candidates are not shipped dependencies and are intentionally
not added to `license-matrix.md` or `THIRD_PARTY_NOTICES.md`.

## Hugging Face applications worth examining

### LivePortrait

Official resources: [Hugging Face model](https://huggingface.co/KlingTeam/LivePortrait),
[Hugging Face Space](https://huggingface.co/spaces/KlingTeam/LivePortrait),
[repository](https://github.com/KlingAIResearch/LivePortrait), and
[paper](https://arxiv.org/abs/2407.03168).

- **Confirmed:** It accepts a source portrait plus a driving video, source
  image, or reusable motion template and produces animated frames/video. It has
  explicit eye/lip retargeting, regional control, and boundary stitching.
- **Confirmed:** Its main neural stack includes an appearance extractor, motion
  extractor, warping module, SPADE generator, landmark model, and retargeting
  modules. The official model card reports roughly 500 MB for the main listed
  portrait-animation weights, before all auxiliary files.
- **Confirmed:** It performs neural warping and decoding per frame. The official
  documentation reports fast RTX 4090 timings, while warning that Apple Silicon
  may be about 20 times slower than that path.
- **Inference:** Anime-domain reliability is not established by the official
  human/cat/dog scope. Success on a few community examples would not establish
  a support domain.
- **License boundary:** The project code is MIT, but the project's own
  [LICENSE](https://github.com/KlingAIResearch/LivePortrait/blob/main/LICENSE)
  says the bundled InsightFace models are for non-commercial research and must
  be removed/replaced for commercial use. The paper reports about 69 million
  training frames, but the reviewed public material does not establish a
  commercially cleared provenance chain for those frames.
- **Decision:** Use its stitching, regional retargeting, motion-template, and
  interaction ideas. Do not ship its weights or make it the `.limg` runtime.

[FacePoke](https://github.com/jbilcke-hf/FacePoke) is a useful LivePortrait-based
mouse-control UX reference, but it is an archived community application and
inherits the same model-license boundary. Its paused
[Space](https://huggingface.co/spaces/jbilcke-hf/FacePoke_CLONE-THIS-REPO-TO-USE-IT)
is not a production dependency candidate.

### Talking Head Anime 3 and 4

Official resources: [THA3 repository](https://github.com/pkhungurn/talking-head-anime-3-demo),
[THA4 project](https://pkhungurn.github.io/talking-head-anime-4/), and
[THA4 repository](https://github.com/pkhungurn/talking-head-anime-4-demo).
A third-party [THA3 Space](https://huggingface.co/spaces/cymic/Talking_Head_Anime_3)
exists, but it is a wrapper rather than the licensing authority.

- **Confirmed:** THA3 maps a 512 x 512 RGBA anime upper-body image and a
  45-dimensional semantic pose to a rendered frame. Its expression, head/body,
  and breathing control taxonomy is unusually close to the desired API.
- **Confirmed:** THA4 makes the per-character compilation trade-off explicit:
  a slow teacher is distilled once into a character-specific student smaller
  than 2 MB, which the project reports can render at least 30 FPS on consumer
  gaming GPUs.
- **Confirmed:** The released THA4 workflow still requires a manually authored
  black-and-white eye/mouth mask and a training configuration. The repository
  gives about 30 hours on an RTX A6000 as an example. The student is PyTorch;
  the conversion used by the web demos is not published.
- **License boundary:** THA3 code is MIT and its official README identifies its
  released model files as CC BY 4.0. THA4 code is MIT, while THA4 models and
  repository sample images are CC BY-NC 4.0. The paper's training-source
  description does not provide a verified commercial provenance chain for all
  collected character assets.
- **Decision:** THA4 validates the compile-once/per-character-payload concept,
  while its manual preparation, cost, and non-commercial weights identify the
  exact problems Living Image should avoid. Borrow the control taxonomy and
  concept, not the weights or renderer.

### FOMM and TPSMM

Official resources: [FOMM repository](https://github.com/AliaksandrSiarohin/first-order-model),
[FOMM paper](https://proceedings.neurips.cc/paper_files/paper/2019/hash/31c0b36aef265d9221af80872ceb62f9-Abstract.html),
[TPSMM repository](https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model),
and [TPSMM paper](https://openaccess.thecvf.com/content/CVPR2022/html/Zhao_Thin-Plate_Spline_Motion_Model_for_Image_Animation_CVPR_2022_paper.html).
The [TPSMM Space](https://huggingface.co/spaces/CVPR/Image-Animation-using-Thin-Plate-Spline-Motion-Model)
is useful for demonstration: its application code runs the Python model on the
server and notes that CPU generation can take minutes.

- **Confirmed:** FOMM learns category-specific, non-semantic keypoints, local
  affine Jacobians, dense motion, and occlusion handling. A generator reconstructs
  each output frame from feature maps.
- **Confirmed:** TPSMM makes the learned feature flow more flexible with multiple
  thin-plate-spline transforms and multi-resolution occlusion masks.
- **Inference:** Because learned control points are not guaranteed to mean
  `eyeLeft`, `mouthOpen`, or another stable API control, neither system supplies
  the semantic asset representation needed here.
- **License boundary:** Both repositories carry MIT code licenses. Separate,
  explicit licenses and commercial provenance for every distributed checkpoint
  and its source videos were not established in this review.
- **Open:** TPSMM's README says its main code is based on FOMM and MRAA. The
  upstream [Snap MRAA repository](https://github.com/snap-research/articulated-animation/blob/main/LICENSE.md)
  does not grant the ordinary reuse rights that a permissive open-source license
  would. The TPSMM top-level MIT label alone does not establish that every
  inherited portion was validly relicensed.
- **Decision:** Do not copy TPSMM implementation code. Independently implement
  only the published, general mathematics needed for bounded piecewise-affine/TPS
  deformation and visibility blending. Do not adopt the pretrained generators
  or checkpoints.

### AniPortrait

Official resources: [repository](https://github.com/Zejun-Yang/AniPortrait) and
[paper](https://arxiv.org/abs/2403.17694). Several Hugging Face Spaces use the
name, but reviewed instances were paused, broken, or community repackages.

- **Confirmed:** "Ani" refers to animation, not anime. The project generates a
  photorealistic portrait video from audio or driving pose and depends on a
  diffusion pipeline and multiple base models.
- **Confirmed:** Repository code is Apache-2.0. An independent license statement
  for the complete official weight bundle was not found.
- **Confirmed:** The training instructions refer to VFHQ and CelebV-HQ. Both
  [VFHQ](https://liangbinxie.github.io/projects/vfhq/) and
  [CelebV-HQ](https://github.com/CelebV-HQ/CelebV-HQ#agreement) restrict their
  data and derived data to non-commercial research.
- **Decision:** Treat it as a video-generation contrast case, not an anime
  character runtime or commercial-path candidate.

## More useful precedents outside the HF app pattern

### Explicit compiler outputs

- **Confirmed:** [Meta Animated Drawings](https://github.com/facebookresearch/AnimatedDrawings)
  separates detection/annotation from rendering and stores explicit masks,
  texture, skeleton/configuration, and retargetable motion. This strongly
  supports the Compiler -> asset -> Runtime split. Its full-body skeletal rig
  does not solve anime pupil, eyelid, mouth, or hair occlusion by itself.
- **Confirmed:** [SPRITETOMESH](https://arxiv.org/abs/2602.21153) describes a
  useful division of labour: learn segmentation, then construct contours,
  internal edges, and Delaunay meshes deterministically. The paper reports that
  directly learning vertex placement was ambiguous and ineffective.
- **Open:** An official reusable SPRITETOMESH implementation/license was not
  confirmed. Only the general approach may be independently implemented.

### Static hidden layers and teacher fitting

- **Confirmed:** [See-through](https://github.com/shitagaki-lab/see-through)
  compiles a single illustration into semantic, ordered, inpainted layers and a
  PSD. This is relevant because missing pixels are generated once and saved,
  rather than regenerated every frame. The official
  [Space](https://huggingface.co/spaces/24yearsold/see-through-demo) is suitable
  for a later research spike, not the minimal compiler path.
- **Open:** See-through's Apache-2.0 code license alone does not clear all model
  weights, training data, base models, or generated outputs for commercial use.
- **Confirmed:** [LiveSVG](https://research.google/pubs/livesvg-zero-shot-svg-animation-via-video-generation/)
  uses generated video as a target, then fits explicit editable SVG deformation.
  The transferable concept is to discard the teacher video and retain only
  explicit runtime parameters. Its SVG input and heavy compile path are not a
  direct implementation fit.

## Recommended architecture after this review

### Main path

Compile the following explicit, source-bound data into `.limg`:

1. semantic regions and draw order;
2. deterministic triangle meshes around the face, eyes, mouth, and later hair;
3. per-control weight fields for blink, gaze, mouth, breath, and small head/body
   motion;
4. protected line-art, visibility, and occlusion masks;
5. explicit backing textures or corrective sprites for small hidden areas;
6. confidence, support-domain descriptors, and unsupported-operation flags.

The Runtime should continue to use mesh deformation, alpha compositing, state
blending, and springs only. Small missing regions may be filled once at compile
time and stored. Large unsupported turns or low-confidence decompositions should
be constrained or rejected, not hidden by a per-frame generator.

### Optional research path

A neural model may later act as a compile-time teacher or comparison oracle:

```text
teacher frames / flow
-> fit explicit semantic weights, curves, or corrective textures
-> validate reconstruction and motion bounds
-> discard teacher output
-> store only audited `.limg` data
```

This does not make the teacher's code, weights, data, or outputs automatically
safe to redistribute. Any such backend needs a fresh license and provenance
review before adoption.

## Pre-registered next experiment

**Decision:** Run a semantic mesh/weight-field probe before integrating another
neural application.

1. Freeze three currently supported images and three difficult/rejected images.
2. Construct deterministic contours and triangulation from existing automatic
   landmarks, masks, and image edges.
3. Generate blink, gaze, and mouth weights from semantic mask/landmark distance,
   without image-specific constants in the Runtime.
4. Render the same state curves using the current bounded-patch method and the
   mesh method.
5. Compare neutral reconstruction seams, eye/line preservation, displacement
   leakage, face-jelly deformation, reverse-to-neutral exactness, deterministic
   frame hashes, browser FPS, and `.limg` payload size.
6. Preserve failures and do not tune the method against the difficult set until
   the first-run report is recorded.

If the explicit mesh cannot beat the current local warp without introducing
jelly motion or seams, retain the bounded method and use triangulation first for
larger head/breath motion. If it does beat it, promote compiler-authored weight
fields into the next `.limg` schema revision.

## Practical visual comparison

For a quick qualitative check, use only images that are safe to upload to a
third-party service:

1. Try the official [LivePortrait Space](https://huggingface.co/spaces/KlingTeam/LivePortrait)
   for retargeting and stitching quality.
2. Try the [TPSMM Space](https://huggingface.co/spaces/CVPR/Image-Animation-using-Thin-Plate-Spline-Motion-Model)
   to see driving-video motion transfer and its runtime/cropping trade-offs.
3. Try the official-linked [See-through Space](https://huggingface.co/spaces/24yearsold/see-through-demo)
   to inspect a reusable PSD/layer output rather than only a final video.

When comparing them, inspect not only the prettiest frame but also pupil and
highlight survival, full blink closure, mouth identity, hair/background tearing,
neutral recovery, latency, payload size, and whether the output is a reusable
asset or merely an MP4.

The license badge on a Space or model repository applies only as far as that
repository's actual rights and metadata extend. It does not automatically
relicense weights downloaded at startup, upstream datasets, sample media, or a
forked project's dependencies. Non-official mirrors are discovery aids only;
license claims must be confirmed at the upstream rights holder's source.

## Open questions

- **Open:** Can LivePortrait reliably detect and retarget the project's allowed
  anime support domain without manual cropping or detector substitution?
- **Open:** Can a See-through-style layer compiler preserve exact source line art
  and produce commercially auditable hidden pixels on the licensed fixtures?
- **Open:** Does deterministic semantic triangulation improve larger motion
  enough to justify format complexity over current bounded patches?
- **Open:** If teacher fitting is useful, can it be performed with a completely
  commercial-clean detector, model, training provenance, and output policy?
