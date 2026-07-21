# Demo recording runbook

## Recommended output

- 1920×1080, 30 fps
- Final delivery: MP4/H.264 unless the judging rules specify otherwise
- Include burned-in captions; keep narration as the primary explanation
- Record with Chromium, browser zoom 90–100%, notifications hidden
- Do not show Cloudflare secrets, email OTP, dashboards, local paths, or personal images

The app's `Record WebM` button records only the silent character Canvas. Use an
external screen recorder/editor for the narrated submission video.

## Rights-cleared demo inputs

Use the project-owned fixtures unless the owner selects another documented
image:

- Success: `fixtures/source/teal-librarian.png`
- Clear reject: `fixtures/source/unsupported-no-face.png`

Do not use ignored hold-out images in the submission video unless their
individual attribution and derivative-use terms have been checked and shown.

## Before recording

1. Confirm the deployed Compiler is in the intended access mode.
2. Open the direct Compiler URL, not only the route landing page.
3. Download or place both demo inputs in an easy-to-select local folder.
4. Perform one private warm-up compile; hosted cold start has measured close to
   30 seconds, while a warm request is much shorter.
5. Refresh Compiler so the visible take begins from a clean state.
6. Close unrelated tabs and hide bookmarks/profile details if necessary.
7. Open the narration script on a second screen or print it.

## Recommended shot order

1. **0–10s:** show Compiler title and supported-input guidance.
2. **10–18s:** choose the success PNG; hold on the honest progress indicator.
3. **18–28s:** show `Your character is ready`, quality status, and download option.
4. **28–37s:** click `Open in Viewer`; show that the character arrives directly.
5. **37–57s:** show automatic idle, then Blink, Look left/right, Talk, and a small breath change.
6. **57–67s:** expand the Viewer's `Runtime API` details; keep code and moving character visible together.
7. **Optional 3s:** download `.limg`, then reopen it in Viewer to prove portability.
8. **67–77s:** return to Compiler and select the clear-reject PNG; show
   `No character file created`, reason, and retry action.
9. **77–85s:** end on Viewer or a simple PNG → `.limg` → Viewer title card.

## Capture quality checks

- Blink must be shown at normal speed; do not hide visual artifacts with fast cuts.
- Hold each manual gaze/mouth action for about one second so judges can see it.
- Keep the success result and reject reason readable for at least two seconds.
- If compile wait is edited, use a visible neutral time cut; do not imply an unmeasured instant result.
- Do not claim Cloudflare timing as a service-level guarantee.
- Verify captions use `Compiler`, `.limg`, `Viewer`, and `Runtime` consistently.

## Final export check

- Watch once with audio and once muted.
- Confirm no personal filename, email, OTP, token, or unrelated tab is visible.
- Confirm the final frame contains project name and repository URL.
- Keep the unedited screen capture until judging ends.
