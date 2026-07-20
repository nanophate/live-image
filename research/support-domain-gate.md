# Compile-time support-domain gate

Snapshot: **2026-07-20**. This is an engineering and provenance review, not
legal advice. No candidate model or dependency discussed below has been added
to the shipped compiler.

## Outcome

**Decision.** The next gate should answer **“is the detected face safe for this
specific local-warp rig?”**, not attempt to decide whether an artwork is
subjectively “anime.” The first experiment should use deterministic image
measurements already available through pinned OpenCV 4.10.0, combined with the
existing detector and landmark measurements. It must not add another pretrained
model yet.

**Decision.** Hold-out A is now observed evidence. It may be replayed as a
regression check, but it must not provide thresholds, feature selection, or
stopping criteria for this gate. Thresholds must be frozen on a separate
calibration set before opening a new local-only hold-out B.

**Inference.** This is the smallest commercially cautious path because it adds
no code, weights, or training-data provenance surface. It also aligns the gate
with the actual failure cost: preventing pasted-looking eye or mouth patches,
line-art discontinuities, and unstable local deformation.

## Why the existing confidence is insufficient

**Confirmed locally.** Hold-out A's semi-realistic painted portrait received a
face score of `0.9978` and mean landmark score of `0.8815`; the current compiler
accepted it as `limited`. The failure is recorded without threshold changes in
[`experiments/2026-07-20-holdout-motion-validation.md`](experiments/2026-07-20-holdout-motion-validation.md).

**Confirmed.** The current landmark model is specifically described as an
anime facial-landmark model predicting 28 points, but its model card does not
claim that its scores are an in/out-of-domain classifier. The card releases the
weights under MIT while explicitly declining a warranty about training-data
provenance: [hysts anime-face-detector HRNetV2 model card](https://huggingface.co/hysts/anime-face-detector-hrnetv2).

**Confirmed.** Maximum model confidence is a useful OOD baseline but is not a
complete solution; the original baseline paper explicitly leaves room for
methods that outperform it: [Hendrycks and Gimpel, ICLR 2017](https://arxiv.org/abs/1610.02136).

**Inference.** Raising the face or landmark score thresholds in response to the
painted hold-out would both leak hold-out A into policy and likely reject useful
stylized faces without measuring the actual local-warp assumptions.

## Candidate approaches

| Candidate | Offline / deterministic compilation | Additional artifact | Provenance and fit | Decision |
| --- | --- | --- | --- | --- |
| Higher detector-score threshold | yes | none | already demonstrated insufficient by hold-out A | reject as the only domain gate |
| Fixed local image/geometry descriptors | yes | none beyond existing OpenCV | measures the exact eye/mouth patches that will be warped; needs independent calibration | **experiment first** |
| OpenAI CLIP zero-shot style labels | yes after caching | code + large checkpoint + prompt taxonomy | general zero-shot model, not a deformation-safety model; task-specific deployment testing required | do not adopt |
| WD ViT Tagger v3 anime tags | yes after caching; ONNX available | approximately 379 MB ONNX weights, tag vocabulary, runtime | trained on Danbooru images; tag prediction is not a safe-warp score | keep out of commercial path |
| Project-trained support classifier | yes after training | project-owned code and weights | could target the real task, but requires a sufficiently large, rights-cleared labeled corpus | revisit only if descriptors fail |

### CLIP review

**Confirmed — code.** The OpenAI CLIP repository is MIT licensed:
[CLIP license](https://github.com/openai/CLIP/blob/main/LICENSE).

**Open — weights.** The repository downloads checkpoints from separate URLs.
This review did not locate a checkpoint-specific license or redistribution
statement independent of the repository's code license. Do not infer weight
redistribution terms from the code license alone.

**Confirmed — training data and intended use.** The official model card says
CLIP was trained from publicly available image-caption data including internet
crawling and YFCC100M, that the dataset is not released, and that it was not
intended as the basis for a commercial or deployed model. It calls any deployed
use out of scope without thorough task-specific testing:
[OpenAI CLIP model card](https://github.com/openai/CLIP/blob/main/model-card.md).

**Decision.** CLIP is not the default or commercial-path gate. Even apart from
provenance, prompt-dependent “anime vs painting” similarity would not establish
that the compiler's eyelid, pupil, and mouth patches can be deformed safely.

### WD ViT Tagger v3 review

**Confirmed — weights/model repository.** The model repository declares
Apache-2.0, offers ONNX and safetensors weights, and lists an ONNX file of about
379 MB: [WD ViT Tagger v3 files](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/tree/main).

**Confirmed — training data.** The model card says the model was trained on
Danbooru images through image ID 7,220,105, with modulo-based train/validation
splits. It does not provide per-image copyright or redistribution evidence:
[WD ViT Tagger v3 model card](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/blob/main/README.md).

**Confirmed — runtime code.** The model card requires ONNX Runtime 1.17 or
newer for its ONNX path. ONNX Runtime's repository code is MIT:
[ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE).

**Open — data provenance.** An Apache-2.0 model-repository label does not prove
that every training image supplied rights suitable for a commercial compiler.
This review did not verify the millions of source-image rights individually.

**Decision.** Do not add WD Tagger weights, tag CSV, or ONNX Runtime for this
gate. The weight size and new provenance surface are disproportionate, and
Danbooru tags optimize a different task.

## Proposed descriptor gate v1

**Decision.** Compute all descriptors on the detected face and compiler-defined
eye/mouth regions after a fixed resize. Store the raw descriptor values and gate
version in `.limg` provenance so a rejection can be reproduced. Do not encode
fixture names or image-specific exceptions.

The pre-registered descriptor candidates are:

1. **Feature-edge support** — run a fixed Gaussian blur plus Canny on the face
   crop, then measure the fraction of eye and mouth landmark samples lying
   within a face-scale-normalized distance of an edge. This tests whether the
   warp anchors follow visible feature boundaries.
2. **Patch boundary continuity** — compare edge density in a narrow band just
   inside and just outside each proposed eye/mouth patch. An extreme jump is a
   risk signal for a pasted rectangular patch or a boundary that cuts through
   strong line art.
3. **Edge-preserving residual** — apply a fixed bilateral filter and measure a
   robust, luminance-normalized residual inside the face and feature patches.
   High residual is a candidate signal for painterly/high-frequency texture
   that the current simple warp may smear. It is not an “anime score.”
4. **Strong-edge compactness** — report connected-component count and median
   component length for strong Canny edges, normalized by face area. This is a
   candidate measure of coherent line features versus fragmented texture.
5. **Existing geometry vector** — retain face scale, mean landmark confidence,
   eye confidence, pupil confidence, eye symmetry, normalized eye aspect ratios,
   and mouth width. These remain necessary capability evidence but are not
   sufficient alone.

**Confirmed.** OpenCV documents Canny as a noise-filtered, gradient-based edge
detector with localization and minimal-response goals:
[OpenCV Canny tutorial](https://docs.opencv.org/4.x/da/d5c/tutorial_canny_detector.html).
It documents bilateral filtering as noise removal that keeps edges sharp:
[OpenCV bilateral filtering](https://docs.opencv.org/4.x/dd/d6a/tutorial_js_filtering.html).
OpenCV 4.10.0, already pinned in `requirements/compiler.txt`, is in the
Apache-2.0 line of OpenCV releases:
[OpenCV 4.10 change log](https://github.com/opencv/opencv/wiki/OpenCV-Change-Logs-v2.2%E2%80%90v4.10).

**Inference.** These descriptors plausibly expose local-warp risk, but no cited
source establishes that they separate all anime and non-anime images. They must
therefore begin as measured experimental features, not as confirmed production
thresholds.

### Gate behavior

**Decision.** Keep the existing `full` / `limited` / `reject` contract and add
reason codes rather than a new subjective style label:

- `reject`: the feature anchors lack enough visible-edge support, or the face
  lies outside the frozen calibration envelope on multiple independent local
  descriptors;
- `limited`: only the affected control is disabled when its local patch lacks
  evidence (eye descriptors gate blink/gaze; mouth descriptors gate mouth);
- `full`: all existing quality rules and the frozen local-descriptor rules pass.

**Decision.** Never turn a `reject` into `limited` because an image “looks
anime.” The new gate may only preserve or reduce capabilities. Log every metric,
threshold, disabled capability, and reason.

**Confirmed.** Rejecting uncertain inputs in exchange for lower accepted-case
risk is the standard selective-classification trade-off described by Geifman
and El-Yaniv: [Selective Classification for Deep Neural Networks, NIPS 2017](https://papers.neurips.cc/paper_files/paper/2017/hash/4a8423d5e91fda00bb7e46540e2b0cf1-Abstract.html).

## Minimal next experiment (no hold-out A tuning)

**Decision.** Run one descriptor-feasibility experiment before production code
changes:

1. Create `fixtures/domain-calibration/manifest.json` containing at least 12
   project-authored or rights-cleared images: six supported near-frontal
   line-art portraits and six intentionally unsupported cases spanning
   semi-realistic painting, photograph, textured/sketched face, profile,
   occlusion, and too-small face. This is a **calibration** set, not hold-out B.
2. Keep any externally sourced images in
   `fixtures/domain-calibration/source/`, ignored by Git. Track only source URLs,
   creator/license evidence, exact SHA-256, expected support/capabilities, and
   reproduction instructions. Self-authored repository fixtures may remain
   tracked under their existing provenance policy.
3. Implement a standalone research probe that emits the five descriptor groups
   above to `research/experiments/`; it must not alter compiler status. Use fixed
   resize, colour conversion, border mode, kernels, and seeds, and record the
   OpenCV/NumPy versions.
4. Before seeing hold-out B, select the smallest descriptor subset and freeze
   thresholds using calibration-set leave-one-out results. Prefer one-sided
   conservative rejection and report risk/coverage, unsupported acceptance,
   supported rejection, and per-control capability mistakes. Do not optimize a
   weighted “accuracy” that hides unsafe acceptance.
5. Freeze a new local-only hold-out B manifest and expectations before running
   the detector or descriptor probe. Include at least four supported and four
   unsupported inputs, with at least two anime-adjacent hard negatives. Run once
   and preserve the raw report whether it succeeds or fails.
6. Replay hold-out A only after the B report is immutable. Label that replay
   **regression**, never independent validation.

**Decision.** Go forward with a compiler gate only if the frozen rule catches
the unsupported B cases without disabling controls on supported B cases for
reasons unrelated to the local patch. With eight B images this is an engineering
go/no-go signal, not a statistically general claim.

**Open.** The exact descriptor subset and thresholds are intentionally unset.
Setting them now from the known painted portrait would violate the experiment.

**Open.** If deterministic descriptors cannot separate supported and unsafe
cases on calibration without excessive rejection, the next research branch is
a small project-trained binary **warp-support** classifier. Its training media,
labels, code, weights, checksums, and redistribution terms must all be reviewed
before it can enter the commercial path.

## Repository and licensing impact

**Confirmed.** This research adds no dependency, checkpoint, test image, or
runtime call. `research/license-matrix.md` therefore needs no shipped-artifact
row from this review.

**Decision.** External calibration and hold-out source images remain local and
gitignored, following the same policy as `fixtures/holdout/source/*.png`. Do not
copy them into research screenshots or generated render artifacts unless their
individual redistribution terms permit it and the required attribution is
preserved.
