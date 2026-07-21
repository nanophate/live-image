# Reviewer guide

## What to try

Living Image supports near-frontal anime portraits with a large, unobstructed
face and visible eyes and mouth.

1. Open the direct [Compiler](https://living-image.logosact-account.workers.dev/compiler.html).
2. Select a rights-cleared PNG or JPEG.
3. Wait for `full`, `limited`, or a clear unsupported result.
4. For a successful result, choose `Open in Viewer`.
5. Try Blink, Talk, Look left/right, sliders, and the deterministic demo.
6. Download the `.limg`; reopen it from the standalone
   [Viewer](https://living-image.logosact-account.workers.dev/viewer.html).

The Viewer accepts `.limg` only. It does not upload the character to the
Compiler and performs no per-frame model inference.

## Known-good inputs

The submission should attach or directly link these project-owned files so the
review does not depend on an arbitrary image:

- Success input: `fixtures/source/teal-librarian.png`
- Reject-path input: `fixtures/source/unsupported-no-face.png`

Repository copies:

- Success PNG download: <https://raw.githubusercontent.com/nanophate/live-image/main/fixtures/source/teal-librarian.png>
- Reject PNG download: <https://raw.githubusercontent.com/nanophate/live-image/main/fixtures/source/unsupported-no-face.png>

Prefer attaching both files directly to the submission if the judging platform
supports attachments; that avoids relying on a GitHub download step.

## Expected behavior

- A supported result creates a downloadable `.limg` and enables only the
  capabilities recorded by the Compiler.
- A limited result remains playable, but unsafe controls are disabled.
- An unsupported result creates no file and displays the reasons prominently.
- Hosted compilation may take around 30 seconds on a cold Container start.
- Runtime playback happens locally and deterministically after the file opens.

## Scope

This prototype does not promise every illustration, full-body motion, large
head rotation, timeline editing, or Live2D compatibility. It prioritizes subtle
motion and safe refusal over forcing a visibly broken result.

## Access note for the submission owner

The current hostname is normally protected by Cloudflare Access. Do not give
reviewers this guide until one of these is true:

- their email identity is explicitly allowed through Access; or
- a supervised public review window is active; or
- a dedicated protected/public judging environment has been prepared.

The existing two-hour review mode is not suitable for an unknown asynchronous
judging time.
