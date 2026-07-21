# Cloudflare private staging rollout

Date: 2026-07-21

Status: disabled corrected deployment complete; no route, Access application,
addressable Container instance, or hosted Compiler has been enabled

## Purpose

Validate the Cloudflare account and image boundary without creating an
anonymous compiler endpoint, then close the Access-token verification gap
before attaching any external route.

## Primary sources reviewed

- Cloudflare requires an origin Worker behind Access to validate the JWT added
  in `Cf-Access-Jwt-Assertion`, including signature, issuer, and application AUD:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>.
- Header presence alone is insufficient because the token signature must be
  confirmed:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/>.
- Protecting a Worker directly by name is the safest and most straightforward
  Access application form:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/>.
- Custom Domains require an active Cloudflare zone and can be added by
  `routes[].custom_domain` only after the hostname is selected:
  <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>.
- Container deployment pre-schedules capacity and pre-fetches images, while
  unused pre-warmed images are not billed:
  <https://developers.cloudflare.com/containers/platform-details/architecture/>.
- Container charges start only when a request is sent to an instance or the
  instance is manually started:
  <https://developers.cloudflare.com/containers/pricing/>.

## Account and first deployment evidence

- **Confirmed:** Wrangler 4.112.0 authenticated to the `LogosAct` account with
  Workers and Containers write permission.
- **Confirmed:** `wrangler containers list` initially returned the explicit
  Workers Paid requirement. After the owner upgraded, it succeeded with no
  existing Containers.
- **Confirmed:** the deployment built 17 Worker assets, uploaded 14 new assets,
  and registered Worker version
  `34fa58fc-58d0-4a9e-8250-c87852c9339c`.
- **Confirmed:** the linux/amd64 image was pushed to the account-private
  registry at digest
  `sha256:194d0943eb310e2b107333db261971d2acaae1ad8ffba80330b21a05ec464acb`.
- **Confirmed:** Cloudflare created standard-2 application
  `living-image-compilercontainer` with max instances 1 and current instances
  0. Wrangler reported `No targets deployed for living-image`.
- **Confirmed:** `workers_dev` was false, there was no configured route,
  `HOSTED_COMPILER_ENABLED` was false, and the Container never started. The
  deployment therefore created no reachable application endpoint or inference
  runtime.

## Corrected disabled deployment evidence

- **Confirmed:** after the Access JWT correction, a second deployment registered
  Worker version `729bc395-5e84-4681-8e77-ee06924981f4` and the account-private
  Container image digest
  `sha256:ffdc13f8245b482481b554db7e2791a762dff02f6d97004335bf7a34016fc222`.
  Wrangler again reported `No targets deployed for living-image`.
- **Confirmed:** this deployment retained `workers_dev: false`, no route, and
  `HOSTED_COMPILER_ENABLED: false`. It did not create a public URL or a code path
  that can call the Compiler.
- **Confirmed:** immediately after the image rollout, `wrangler containers list`
  reported the application as `provisioning` with one live slot, while
  `wrangler containers instances ... --json` returned an empty array. Cloudflare
  documents that deployment pre-schedules capacity and pre-fetches images, but
  billing starts only when a request is sent to a Container or it is manually
  started; unused pre-warmed images are not billed. This is not evidence of an
  addressable or inference-running instance.
- **Confirmed:** the complete Chromium product suite passed with 14 tests and 2
  documented local-only skips after the correction, in addition to the unit,
  Python, build, dry-run, and startup checks below.

## Security finding and correction

- **Confirmed:** the deployed gateway required only the presence of
  `Cf-Access-Jwt-Assertion`. A client-provided string could satisfy that local
  check if another route or configuration exposed the Worker outside the
  intended Access gate.
- **Decision:** do not add a route or enable compilation with that gateway.
- **Confirmed:** the corrected implementation pins jose 6.2.3 (MIT, npm
  integrity
  `sha512-YYVDInQKFJfR/xa3ojUTl8c2KoTwiL1R5Wg9YCydwH0x0B9grbzlg5HC7mMjCtUJjbQ/YnGEZIhI5tCgfTb4Hw==`).
- **Confirmed:** it restricts the JWKS issuer to an HTTPS
  `*.cloudflareaccess.com` origin without a non-default port, caches that
  account JWKS across warm requests, and verifies RS256 signature, exact
  issuer, application AUD, and expiry. It returns generic fail-closed responses
  for missing configuration, missing token, and invalid token.
- **Confirmed:** unit tests reproduce acceptance of a real locally signed token
  and rejection of malformed and wrong-key signatures, a non-RS256 algorithm,
  wrong audience, wrong issuer, expired token, missing configuration, a
  non-Access JWKS origin, and a non-default team-domain port.
- **Confirmed:** 55 TypeScript tests and 53 Python tests pass. The Viewer and
  Worker builds pass, Wrangler dry-run reports a 103.54 KiB / 24.37 KiB gzip
  Worker upload with the Compiler still disabled, and the alpha
  `wrangler check startup` analysis completes successfully. The full Chromium
  product suite also passes 14 tests with 2 documented local-only skips.
- **Decision:** `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` will be stored with
  interactive Wrangler secrets only after the Access application exists. They
  are not committed as variables or passed on a command line.

## Remaining rollout gates

- Create an Access self-hosted application that protects the entire
  `living-image` Worker before adding any public endpoint.
- Add a narrow Allow policy for explicitly approved tester identity; do not use
  Everyone, all valid emails, or a Bypass policy.
- Test anonymous and unauthorized denial, the approved browser session, and
  Access audit logs while the Compiler remains disabled.
- Select one dedicated staging hostname or explicitly protected Workers route.
- Store the Access team domain and application AUD, deploy the corrected Worker,
  and verify forged/missing/expired assertions remain rejected.
- Only then change `HOSTED_COMPILER_ENABLED` to true and run one ignored local
  test image through cold/warm, reject, concurrency, memory, cost, artifact hash,
  privacy, and shutdown checks.
- Rollback order is Compiler false, route removal, then Container stop; retain
  the default-deny Access application until the endpoint is gone.
