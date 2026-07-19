# Living Image — AGENTS.md

## Goal
Build a foundation that converts a single anime-style character image into a controllable 2.5D character from code, without PSD layer separation or manual rigging.

Enable users to take any favorite single image and use it as a “character that feels alive” inside web or apps. To achieve this, design and implement the following three components:

1. **Compiler** — Analyzes the image and generates the structure, control information, and behavior settings required for movement
2. **`.limg` Format** — A portable format that stores the image + structure + behavior in a single file
3. **Runtime** — Loads a `.limg` file and performs real-time rendering by accepting states and inputs through a common API

Target experience:
```text
Select a favorite image
→ Automatically converted into a character file
→ Loadable into web or apps
→ Controllable for states and reactions via a common API
→ Appears alive through blinking, gaze, mouth, breathing, etc.
```

## Core idea
> **Instead of generating animations, compile the image into a “movable character asset.”**

This is not about generating and playing videos or GIFs. Analysis is performed only once at compile time; at runtime a lightweight runtime drives it deterministically and locally.

## Principles
- Do not use LLMs (e.g. GPT-5.6) every frame. Restrict them to semantic analysis, breakdown review, and personality → behavior conversion at compile time
- Even if the LLM fails, always keep a path that can complete the `.limg` using only dedicated detectors + deterministic processing
- Runtime must be local, low-cost, deterministic, and offline
- Large movements comparable to Live2D are unnecessary. Prioritize “naturally existing” through small movements (breathing, blinking, gaze, mouth, hair lag)
- **Never force the user to manually input landmarks or parts.** Automatic detection is the primary path; manual correction UI is only a safety net and must not appear in the main demo path
- Do not force broken outputs for unsupported images. When confidence drops, explicitly reject or guide the user to correction
- Different images must work with the same API. Do not embed image-specific magic numbers into the runtime (record every required value and treat it as a parameter that the compiler should generate)

## Non-goals
- Live2D compatibility / full-body walking / independent arm & leg movement / face rotation beyond 30° / profile generation
- Support for every art style / fully automatic commercial-quality results
- Large-scale new ML training / timeline editor / PSD output

## First thing to prove
First verify that the following can be achieved using actual automatic detection results:

1. Automatically detect face, eyes, and mouth from anime images
2. Create blinking using only the detection results
3. Create mouth opening/closing and small gaze movement
4. Confirm that the same processing works across multiple images

Do not first build the system with perfectly hand-crafted landmarks.  
Implement under the assumption of the detector’s real-world offsets and limitations.

## Known hard problems
Pay special attention to:

- Pupils or highlights getting crushed during blinking
- Eyes or mouth looking like a completely different drawing pasted on
- The entire face distorting like jelly
- Possibility that 28-point landmarks alone lack sufficient pupil/eyelid information
- Eyes hidden by bangs or accessories
- Need to move naturally without fully separating hair, face, and body
- Parts that do not exist in the single image cannot be moved significantly
- Fitting only one image tends to produce image-specific implementations
- Just creating a file format has no value; it must be playable in a separate Viewer

## What to build
Start with the minimum viable set:

- Automatic detection script
- Viewer to inspect detection results
- Automatic blinking
- Mouth opening/closing
- Gaze
- Small movements such as breathing
- Verification across multiple images
- Portable character file
- Separate Viewer that can load that file
- Simple API to switch states from code

Investigate and appropriately decide folder structure, language, libraries, file format, and implementation approach.

## Related technologies and keywords
Investigate the following as needed.

### Existing formats and runtimes
- Live2D Cubism
- VTube Studio API
- VRM
- VMC Protocol
- Inochi2D / INP
- Rive
- Spine
- glTF / GLB

### Runtime
- WebGL2
- WebGPU
- Canvas
- procedural animation
- spring physics
- state blending
- local warp
- vector / SDF rendering
- ONNX Runtime

## Constraints
- Do not make manual landmarks the primary path
- Do not call LLM or image generation every frame
- Do not mix non-commercial models into commercial paths
- Separately verify licenses for code, models, data, and sample images
- Use only self-made or properly licensed sample images
- Record failure results without hiding them

## Research and licensing discipline
- Put all project research in `research/`; do not leave important findings only in chat, temporary notes, or commit messages
- Add new research documents to `research/README.md` so the evidence trail stays discoverable
- Prefer primary sources such as official repositories, papers, model cards, license texts, and vendor documentation; record the review date and direct links
- Clearly label statements as **Confirmed**, **Decision**, **Inference**, or **Open**. Do not present an inference or an unresolved license question as confirmed
- Record implementation decisions, adoption/rejection reasons, reproduced results, failures, and follow-up actions in the relevant `research/` document
- Review code, pretrained weights, training/evaluation data, sample media, generated artifacts, and transitive dependencies as separate licensing/provenance surfaces
- Record exact dependency/model versions and checksums when they affect reproducibility or redistribution
- Do not call a path commercially safe merely because its repository code has a permissive license; verify the model weights, data provenance, assets, and redistribution terms as well
- Keep non-commercial, research-only, unclear-provenance, or incompatible artifacts out of the commercial path unless the project owner explicitly approves a documented exception
- Do not describe this project as “open source” unless the selected project license satisfies the Open Source Definition. Use “source-available” when commercial, purpose, or ethical-use restrictions apply
- Treat selection or modification of the project license, commercial-use policy, contributor licensing, or acceptable-use restrictions as a major policy decision and ask the project owner before changing them
- Preserve third-party notices and keep `THIRD_PARTY_NOTICES.md` and `research/license-matrix.md` current when dependencies or assets change

## Definition of success
At minimum the following pipeline must work:

```text
PNG
→ Automatic analysis
→ Natural small movements
→ Saved as a character file
→ Loaded in a separate Viewer
→ Multiple characters controlled by the same code API
```

It must work without the user placing landmarks or editing code for each image.

## How to work
- First investigate related technologies and decide on the minimal implementation approach
- Do not stop at planning; actually run and verify
- Briefly record important decisions and reasons for failure
- When there are unclear points or major policy decisions, ask the user instead of deciding unilaterally
- Proceed with detailed implementation decisions on your own
- Do not aim for perfect generality from the start; it is acceptable to narrow the conditions of supported images
