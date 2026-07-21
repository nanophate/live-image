# Submission copy

## One line

Living Image compiles one anime portrait into a portable `.limg` character that
can blink, look, talk, and breathe through the same runtime API.

## Short description

Living Image turns a supported near-frontal anime portrait into a reusable,
code-controlled character asset—without PSD layers or manual landmarks. The
Compiler detects the face, eyes, pupils, and mouth once, applies a confidence
gate, and produces a self-contained `.limg`. A separate browser Viewer then
drives subtle blink, gaze, mouth, and breathing motion locally and
deterministically. Unsupported images are rejected with reasons instead of
being forced into a broken animation.

## Full description

Most character-animation tools start with manually separated layers or a
hand-built rig. Living Image explores a different workflow: compile a single
anime-style portrait once into a portable, controllable character asset.

The Compiler performs anime-specific face and landmark detection, derives eye,
iris, mouth, and local-deformation data, and applies an explicit quality gate.
Supported output is stored with the source texture, structure, capabilities,
and behavior parameters in one `.limg` file. Limited results disable only the
unsafe controls. Unsupported images produce no character file and explain why.

The separate Viewer performs no per-frame ML inference. It loads `.limg`
locally and uses a deterministic browser runtime with a common normalized API
for blink, gaze, mouth, breath, and named reactions. A character compiled in
the hosted Compiler can be opened in Viewer through a one-time browser-local
handoff without uploading the result again, and the portable file remains
downloadable.

This prototype deliberately targets near-frontal anime portraits and subtle
motion. It is not a replacement for a full Live2D rig, does not promise support
for every illustration, and does not invent large poses or hidden parts.

## Technical highlights

- Automatic anime face + 28-point landmark analysis; no manual landmarks in the demo path
- Compiler-authored local deformation, protected eye pixels, and rigid iris/highlight handling
- Portable `.limg` schema with per-character geometry and capability metadata
- Same normalized Runtime API across characters
- Explicit `full`, `limited`, and `reject` outcomes
- Separate Compiler and model-free, deterministic Viewer
- Cloudflare Worker gateway + on-demand private Container compiler
- Browser-local one-time Compiler → Viewer transfer and durable download fallback

## Honest scope statement

Verified scope: near-frontal anime portraits with a sufficiently large,
unobstructed face and visible eyes/mouth. Runtime playback is local, offline,
model-free, and deterministic after `.limg` creation. Hosted compilation sends
the selected source image to the configured Compiler service for processing.

## Links

Replace/confirm the live links only after the judging access method is decided
and both URLs have been tested from a signed-out browser. The current hostname
is normally protected by Cloudflare Access.

- Repository: <https://github.com/nanophate/live-image>
- Compiler: <https://living-image.logosact-account.workers.dev/compiler.html>
- Viewer: <https://living-image.logosact-account.workers.dev/viewer.html>
