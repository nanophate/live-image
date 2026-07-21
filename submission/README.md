# Living Image — judging pack

This folder is the submission control center. It keeps the public pitch,
reviewer instructions, video narration, recording steps, and release checks
aligned with what the current build actually proves.

## Current readiness

Ready:

- Compiler → `.limg` → separate Viewer works on the deployed Cloudflare build.
- Successful assets expose blink, gaze, mouth, breath, named reactions, a
  deterministic showcase, and local silent WebM recording where supported.
- Unsupported input is rejected with reasons and creates no character file.
- Compiler → Viewer handoff is browser-local, one-time, and does not upload the
  `.limg` a second time.
- `main` CI passes both Web and Compiler jobs.
- Project research, third-party notices, test evidence, and known limitations
  are checked into the repository.

Not yet submission-safe without an owner decision:

- The live hostname is protected by Cloudflare Access. The existing public
  review mode lasts two hours and is suitable only for a known, supervised
  judging window—not asynchronous review.
- The deployed UI does not bundle a known-good source image. Reviewers need an
  explicitly supplied, rights-cleared input or a separately supplied `.limg`.
- Anonymous Compiler access has no Turnstile/rate-limit/cost-alert gate. Do not
  leave it broadly public.

## Files in this pack

- [`form-copy.md`](form-copy.md) — one-line, short, and full submission text
- [`video-script-ja.md`](video-script-ja.md) — 85-second and 45-second Japanese narration
- [`recording-runbook.md`](recording-runbook.md) — exact capture order and operator checklist
- [`reviewer-guide.md`](reviewer-guide.md) — instructions to give judges
- [`final-checklist.md`](final-checklist.md) — go/no-go checklist before submission

## Information still needed from the project owner

Before finalizing the exact form and deployment, record:

1. Competition/submission URL and name
2. Deadline and timezone
3. Maximum video length, file format, size, and language/subtitle rules
4. Required form fields and character limits
5. Whether judging is synchronous or asynchronous
6. Whether judges can use Cloudflare Access email OTP
7. Whether a public live Compiler is mandatory, or video + repository + Viewer is sufficient
8. The exact rights-cleared success image to distribute with the submission

Do not disable Cloudflare Access until items 5–7 are known.
