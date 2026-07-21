# Compiler → Viewer browser handoff

Reviewed: 2026-07-21

Status: implemented product-flow decision

## Problem

- **Confirmed:** before this change, a successful compile exposed a Blob-backed
  download link and played the result inside Compiler, but the separate Viewer
  could receive it only after the user downloaded and selected the same file.
- **Confirmed:** the top-level `Open Viewer` link did not transfer the compiled
  character, so it could reasonably be read as a completed action when it was
  only navigation.
- **Decision:** preserve manual `.limg` download/open as the durable fallback,
  but make direct local transfer the primary success action.

## Storage choice

- **Confirmed:** IndexedDB record values support serializable objects including
  `Blob` and `File` values. The specification also calls out persistence and
  sensitive-data risks that applications must handle. Source: [W3C Indexed
  Database API 3.0](https://www.w3.org/TR/IndexedDB/), reviewed 2026-07-21.
- **Decision:** use a same-origin IndexedDB object store for a one-time Blob
  handoff. This avoids turning a multi-megabyte `.limg` into a UTF-16
  `sessionStorage` string and avoids relying on a document-owned Blob URL across
  navigation.
- **Decision:** use a random UUID as the only URL value, place it in the fragment,
  validate its UUID shape in Viewer, and never place the character payload in
  the URL.
- **Confirmed:** the browser test observes exactly one `/api/compile` upload and
  a `/viewer.html` request without `handoff` data. Viewer performs no second
  image or character upload.

## Lifetime and validation

- **Decision:** each record contains `{ key, blob, filename, createdAt }` and
  expires after 15 minutes. Creating a handoff and opening either app removes
  expired records; an in-page timer also removes an interrupted transfer while
  Compiler remains open. A closed browser cannot run cleanup, so physical
  removal after an interrupted navigation occurs on the next app visit.
- **Decision:** Viewer treats IndexedDB as untrusted input. It reads Blob text,
  runs the normal `parseLivingImage()` schema validation, and then uses the
  normal transactional Runtime load path.
- **Decision:** Viewer atomically reads and deletes the record in one IndexedDB
  read-write transaction before parsing. Two tabs cannot consume the same key.
  Viewer removes the URL fragment after the one-time attempt, including
  malformed or failed loads. Successful Viewer state keeps its own in-memory
  Blob so the `.limg` remains downloadable.
- **Decision:** if IndexedDB is unavailable, blocked, full, missing, expired, or
  corrupt, the UI keeps the Compiler download and directs the user to download
  and open the `.limg` manually.
- **Open:** browser eviction and private-browsing storage policies vary. The
  handoff is convenience, never the sole durable copy or a persistence promise.

## Product behavior

- **Decision:** successful full or limited compilation shows a prominent
  `Your character is ready` card over the preview.
- **Decision:** actions are ordered `Open in Viewer`, `Download .limg`, then
  `Keep reviewing here`. The card explains that its temporary browser copy is
  removed after Viewer opens.
- **Decision:** navigation happens only after an explicit button click. Compile
  success never auto-navigates away from the result.
- **Confirmed:** the focused Chromium suite runs Compiler → one-time IndexedDB
  handoff → Viewer, verifies the loaded identity and runtime capability, checks
  that the URL fragment and database record are removed, and confirms that no
  second compile upload occurs. It also proves atomic single-consumer behavior
  across two simultaneous Viewer tabs, BFCache-style button restoration, and a
  download-preserving fallback when IndexedDB is unavailable. All 8 focused
  product checks pass; the complete Chromium run has 18 passes and 2 documented
  local-artifact skips.

## Licensing and provenance

- **Confirmed:** this implementation uses browser-standard APIs only and adds
  no package, copied code, model, weight, dataset, media asset, or transitive
  dependency.
- **Decision:** `research/license-matrix.md` and `THIRD_PARTY_NOTICES.md` need no
  new entry for this change.

## Deployment evidence

- **Confirmed:** private mode was deployed as Worker version
  `b4f9f1eb-5c46-4d68-9841-1552e25b0bf4` with hosted compilation enabled,
  origin Access JWT verification retained, and Container image rollout disabled.
