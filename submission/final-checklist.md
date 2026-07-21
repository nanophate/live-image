# Final submission checklist

## Blocking decisions

- [ ] Competition name, form URL, deadline, and timezone recorded
- [ ] Video duration/format/size/subtitle rules confirmed
- [ ] Required form fields and character limits copied into this pack
- [ ] Required thumbnail/cover-image dimensions and screenshot count confirmed
- [ ] Synchronous vs asynchronous judging confirmed
- [ ] Judge access method approved
- [ ] Final Compiler/Viewer URLs tested from a signed-out browser
- [ ] Known-good success input included or linked
- [ ] Public Compiler exposure and abuse/cost risk explicitly accepted if required

## Build and evidence

- [ ] `main` is clean and pushed
- [ ] `nodenv exec npm test` passes
- [ ] `nodenv exec npm run build` passes
- [ ] `nodenv exec npm run test:browser` passes with only documented skips
- [ ] `nodenv exec npm run check:cloudflare` passes
- [ ] Live Compiler and Viewer version noted
- [ ] Repository commit SHA noted in submission
- [ ] Repository links resolve to the intended final `main` commit
- [ ] `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `research/license-matrix.md` reviewed

## Live judging

- [ ] Direct Compiler URL used
- [ ] Cloudflare Access or public-review state tested from a signed-out browser
- [ ] Success image compiles from the exact file supplied to judges
- [ ] Reject image produces no `.limg`
- [ ] `Open in Viewer` works and does not trigger a second upload
- [ ] Downloaded `.limg` reopens in standalone Viewer
- [ ] Cold-start expectation disclosed
- [ ] Operator knows the rollback order: private deploy first, Access re-enable second

## Video

- [ ] Uses only rights-cleared images
- [ ] Shows automatic compile progress and successful output
- [ ] Shows Viewer blink, gaze, mouth, and breath at readable speed
- [ ] Shows common Runtime API
- [ ] Shows explicit reject and `No character file created`
- [ ] Includes captions and intelligible narration
- [ ] Contains no secret, OTP, email, personal path, or dashboard data
- [ ] Claims are limited to the verified supported envelope
- [ ] Final frame contains project name, repository, and live URL
- [ ] Exported video, form copy, attached PNGs, and `.limg` fallback open on another device/profile

## After judging

- [ ] Public review origin returned to private mode
- [ ] Cloudflare Access re-enabled and verified
- [ ] Unexpected Container usage/cost checked
- [ ] Final submitted files and form copy archived locally
