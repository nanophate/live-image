# Shared-password review authentication

Reviewed: 2026-07-22

## Scope

This note records the judging-only authentication path that replaces an
email-address-specific Cloudflare Access OTP with one password supplied in
Devpost's private credentials field. It does not change the project license or
the compiler/model provenance.

## Evidence

- **Confirmed:** Cloudflare Access service tokens are credentials for automated
  requests and normally require request headers. They are not a simple password
  form for ordinary browser users. Source: [Cloudflare Access service
  tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
- **Confirmed:** secrets set through Wrangler are available to the Worker but
  are not stored in source configuration. Source: [Workers
  secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
- **Confirmed:** static assets must use Worker-first routing when authentication
  must run before asset delivery. Source: [Workers Static Assets
  binding](https://developers.cloudflare.com/workers/static-assets/binding/).
- **Confirmed:** Workers exposes Web Crypto HMAC signing and verification for a
  stateless signed session. Source: [Workers Web
  Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
- **Confirmed:** Workers Rate Limiting bindings provide per-key approximate
  counters. They reduce ordinary login guessing and compiler abuse but are not
  a globally exact quota. Source: [Rate Limiting
  bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Decisions

- **Decision:** retain three explicit modes: `access`, `shared-password`, and
  time-bounded `public-review`. An unknown mode returns a fail-closed 503.
- **Decision:** `shared-password` routes all HTML, JavaScript, CSS, fixtures, and
  API requests through the Worker. Only the Worker-authored login endpoint is
  available before authentication.
- **Decision:** `REVIEW_PASSWORD` and `REVIEW_SESSION_SECRET` are independent
  Cloudflare secrets. `REVIEW_AUTH_VERSION` invalidates existing sessions when
  incremented.
- **Decision:** the signed session contains only its hostname audience, issue and
  expiry times, auth version, and a random nonce. It expires after 12 hours and
  uses a `__Host-` cookie with `Secure`, `HttpOnly`, `Path=/`, and
  `SameSite=Strict`.
- **Decision:** login, logout, and compilation require an exact same-origin POST;
  login bodies and image uploads remain bounded before expensive work.
- **Inference:** two deployed exact-Origin variants both rejected the otherwise
  same-origin review form, so the Cloudflare Access browser flow did not preserve a
  usable `Origin` header for the review form POST. The gate accepts either an
  exact `Origin` match or, only when `Origin` is absent, the browser-controlled
  `Sec-Fetch-Site: same-origin` signal. A different Origin always fails even if
  Fetch Metadata claims same-origin; missing Origin plus missing/cross-site
  Fetch Metadata also fails.
- **Confirmed (2026-07-22):** after Access was bypassed, the real browser form
  still reached the Worker's cross-origin rejection. A reproduced request with
  the exact public Origin reached the password check, while `Origin: null` with
  same-origin Fetch Metadata reproduced that rejection.
- **Inference:** the login response's `Referrer-Policy: no-referrer` caused the
  browser to serialize an opaque Origin for the form POST; no request-header
  values or secrets were logged in production.
- **Decision:** login responses now use `Referrer-Policy: same-origin`, which
  reveals no referrer to other origins but permits normal same-origin form
  context. For browser compatibility, `Origin: null` is treated like a missing
  Origin only when the browser-controlled `Sec-Fetch-Site` value is exactly
  `same-origin`; null Origin with missing or cross-site Fetch Metadata remains
  rejected.
- **Decision:** login attempts are limited to five per minute and compilation to
  six per minute per edge key before Container startup.
- **Decision:** deploy password mode while Access still protects the hostname,
  then bypass (rather than delete) the Access application once the Worker gate
  is independently observable. Keeping the application and its previous allow
  policy makes rollback straightforward.

## Verification

- **Confirmed:** 60 TypeScript tests pass, including the actual review gate's
  page redirect, API denial, correct/wrong password, login rate limit, signed
  cookie, logout, missing configuration, session modification, wrong audience,
  auth-version invalidation, expiry, duplicate cookies, missing Origin,
  cross-origin POST, and unsafe return paths.
- **Confirmed:** browser and Worker TypeScript builds pass.
- **Confirmed:** `npm run check:cloudflare` recognizes both rate-limit bindings,
  Worker-first assets, generated environment types, and the Container in a dry
  run.
- **Confirmed (2026-07-22):** Cloudflare Access policy
  `Bypass Access for shared-password judging` applies to `Everyone`; the Access
  application was saved successfully. An anonymous request to
  `/compiler.html` now receives the Worker's `303` redirect to
  `/auth/login?next=%2Fcompiler.html`, rather than an Access OTP redirect.
- **Confirmed (2026-07-22):** an anonymous request to `/api/config` receives the
  Worker's `401` JSON response. This confirms that bypassing Access did not make
  the application or APIs public; the Worker shared-password session remains
  the active gate.
- **Confirmed (2026-07-22):** after deploying Worker version
  `9327d84c-667e-45f3-93db-440268ba74e5` and loading the revised login page, the
  project owner completed the shared-password browser login without the
  cross-origin rejection or an Access OTP prompt.

## Open operational actions

- **Confirmed:** both secrets were set interactively without committing or
  logging their values.
- **Confirmed:** password mode is deployed and the anonymous half of the live
  authentication matrix (page redirect and API denial) passes.
- **Confirmed:** Access OTP is disabled by an `Everyone` bypass policy; the
  Access application was retained for reversible rollback.
- **Confirmed:** a fresh browser login accepts the correct shared password and
  proceeds without an Access OTP prompt.
- **Open:** complete one final judging-path smoke test covering Compiler upload,
  generated `.limg`, Viewer load, and logout from the authenticated session.
- **Open:** put the review URL and password only in Devpost's private judges
  field, then rotate or delete the password after judging.
