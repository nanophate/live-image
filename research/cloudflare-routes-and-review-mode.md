# Cloudflare Compiler/Viewer routes and review mode

Reviewed: 2026-07-21

Status: implemented locally; normal Access-protected deployment pending

## Question

How should the hosted product separate compilation from playback, keep the
Compiler normally available, and support a short unauthenticated judging
session without leaving an indefinite public compute endpoint?

## Primary sources

- Cloudflare recommends treating Wrangler configuration as source of truth,
  keeping compatibility dates current, storing secrets outside source, and
  configuring deployment environments deliberately:
  <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>.
- Wrangler variables are non-secret configuration available through the Worker
  environment; secrets remain separate:
  <https://developers.cloudflare.com/workers/configuration/environment-variables/>.
- Cloudflare Access for a workers.dev route is an edge control enabled or
  disabled separately from Worker deployment:
  <https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/>.
- Container `sleepAfter` shuts down an idle Container after approximately the
  configured duration:
  <https://developers.cloudflare.com/containers/container-class/> and
  <https://developers.cloudflare.com/containers/platform-details/architecture/>.
- Wrangler deploy supports `--var`, `--keep-vars`, and
  `--containers-rollout=none`; checked against Wrangler 4.112.0 and:
  <https://developers.cloudflare.com/workers/wrangler/commands/workers/>.

## Findings and decisions

- **Confirmed:** before this change, `/viewer.html` queried `/api/config`,
  expanded its picker to PNG/JPEG when enabled, and posted images to
  `/api/compile`. The Viewer and Compiler UI were therefore one page even
  though the API path was separate.
- **Decision:** `/compiler.html` now owns PNG/JPEG selection, automatic
  compilation, quality/reject review, runtime preview, and `.limg` download.
  `/viewer.html` accepts only `.limg`, never queries `/api/config`, and
  never calls `/api/compile`.
- **Decision:** both pages reuse the same deterministic player/control module
  with an explicit HTML page-mode marker. This avoids separate rendering
  implementations while keeping network capabilities separated.
- **Decision:** normal hosted configuration is
  `HOSTED_COMPILER_ENABLED=true` and `REQUIRE_ACCESS_JWT=true`. The
  Container is available on demand, not continuously running; it retains the
  five-minute idle sleep.
- **Decision:** only the exact string `REQUIRE_ACCESS_JWT=false` bypasses
  origin JWT verification. Missing, misspelled, or any other value requires
  Access authentication.
- **Decision:** unauthenticated review additionally requires
  `PUBLIC_REVIEW_NOT_BEFORE` and `PUBLIC_REVIEW_EXPIRES_AT`. Both must parse,
  the request time must be inside the interval, and the interval must be no
  longer than 24 hours. The provided command creates a two-hour window.
- **Decision:** public review requires an exact same-origin `Origin` header as
  a browser/CSRF check, not as caller authentication; non-browser clients can
  forge this header. It retains the 20 MiB upload bound, media validation, filename bound,
  fixed-length streaming, private Container network, one-instance maximum, and
  authentication/cookie header stripping.
- **Confirmed:** `nodenv exec npm run deploy:cloudflare:private` and
  `nodenv exec npm run deploy:cloudflare:review` both deploy without a
  Container image rollout. Review mode computes timestamps rather than storing
  a permanent public expiry in Git.
- **Confirmed:** Cloudflare Access protects the current hostname before a
  request reaches the Worker. Setting `REQUIRE_ACCESS_JWT=false` does not
  itself remove the login screen.
- **Decision:** transition to review in this order: deploy review origin mode,
  then disable the Access application. Return in this order: deploy private
  origin mode first, then re-enable Access. A failed or expired review window
  returns 503 even if edge Access is disabled.
- **Confirmed:** disabling the current full-host Access application exposes the
  landing page, Compiler, Viewer, and engineering routes for the review window,
  not only `/compiler.html` and `/api/compile`.
- **Open:** the current Access application covers the whole hostname. If the
  Viewer should remain permanently public while only Compiler UI/API are
  private, replace it with tested path-specific Access applications before
  removing the full-host application.
- **Open:** an unauthenticated Compiler still needs rate limiting or Turnstile,
  cost alerts, and a tested abuse budget before any public window broader than
  a short supervised judging session.

## Validation

- **Confirmed:** Vite emits distinct `compiler.html` and `viewer.html`
  assets.
- **Confirmed:** 57/57 TypeScript tests and 53/53 Python tests pass.
- **Confirmed:** the Chromium product suite passes 14 tests with 2 documented
  local-artifact skips. It proves Viewer mode makes zero config/compile
  requests, rejects PNG input locally, and Compiler mode handles hosted
  success/error/provider states.
- **Confirmed:** private and review deploy scripts both pass Wrangler dry-run
  with all four non-secret mode variables present and no Container rollout.
- **Confirmed:** Wrangler-generated binding types are checked into
  `worker-configuration.d.ts` and checked for drift in the Cloudflare
  validation command.
- **Confirmed:** the latest retrieved Workers types at review time were
  `5.20260721.1`. The project remains pinned to `5.20260719.1`; no API used
  by this change required an upgrade.
- **Confirmed:** this change adds no third-party runtime dependency, model,
  dataset, or sample asset. The deployment helper uses only Node.js built-ins,
  so `research/license-matrix.md` and `THIRD_PARTY_NOTICES.md` require no
  new license entry.
