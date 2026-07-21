# Cloudflare private staging rollout

Date: 2026-07-21

Status: Access-protected workers.dev staging URL enabled; one approved private
Compiler cold/warm check completed and the hosted Compiler returned to disabled

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
- A workers.dev URL is public when enabled unless Cloudflare Access requires
  authentication; Cloudflare documents the authorized-email flow and origin
  JWT validation as the corresponding controls:
  <https://developers.cloudflare.com/workers/configuration/routing/workers-dev/>.
- Cloudflare recommends keeping the compatibility date current, storing secrets
  outside source, and configuring routes deliberately:
  <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>.
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
- **Confirmed:** after rollout settled, application state became `ready` and
  `wrangler containers info` reported health `active: 0`, `assigned: 0`, and
  `healthy: 1`. The one healthy slot is therefore unassigned pre-warmed capacity,
  not a request-started Compiler process. No inference request was made.
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
  `npm audit --omit=dev` reports zero known vulnerabilities in the production
  dependency graph after adding jose 6.2.3.
- **Confirmed:** `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` were stored with
  interactive Wrangler secrets after the Access application existed. Their
  values are not committed as variables or passed on a command line.

## Access application and secret evidence

- **Confirmed:** Zero Trust Free already existed with team domain
  `logosact.cloudflareaccess.com`, one-time PIN as its only identity provider,
  and no prior Living Image application. The unrelated existing GitHub SaaS
  application was left unchanged.
- **Confirmed:** the self-hosted application `Living Image Private Staging`
  protects the single full-host destination
  `living-image.logosact-account.workers.dev`.
- **Confirmed:** its only attached policy is `Allow nanophate staging tester`,
  action Allow, with one exact approved email rule and a 30-minute policy
  session. There is no Everyone, email-domain, Bypass, Service Auth, browser
  rendering, or Cloudflare One Client rule.
- **Confirmed:** the dashboard generated a unique application AUD and documents
  that value as the origin-side JWT audience. The exact AUD was copied directly
  into the interactive `ACCESS_POLICY_AUD` secret prompt and is intentionally
  omitted from Git. The confirmed team domain was stored the same way in
  `ACCESS_TEAM_DOMAIN`.
- **Confirmed:** `wrangler secret list` returns both names as `secret_text` and
  does not reveal either value. Secret changes registered Worker versions
  `d3821395-5537-4852-b2d9-a82ef48a16a6` and
  `bd54f46c-7fb6-4030-bccf-7fdfadaec477`.
- **Confirmed:** after both changes, the Worker dashboard still reported `No
  URLs enabled`, Domains 0, Workers 0, Routes none, Invocations 0, Errors 0,
  CPU Time 0 ms, and workers.dev Disabled. `HOSTED_COMPILER_ENABLED` remains
  false in version-controlled configuration.

## Access-protected endpoint activation evidence

- **Decision:** after explicit owner approval, enable only the exact workers.dev
  staging hostname. Keep Preview URLs disabled, do not add a custom domain, do
  not enable the Compiler, and do not roll out a new Container image.
- **Confirmed:** the only version-controlled routing change was
  `workers_dev: false` to `workers_dev: true`; `preview_urls: false` and
  `HOSTED_COMPILER_ENABLED: "false"` were unchanged.
- **Confirmed:** `nodenv exec npm run check:cloudflare` passed the TypeScript
  checks, production Viewer build, Worker build, and Wrangler dry-run. The
  dry-run reported the Compiler binding but retained
  `HOSTED_COMPILER_ENABLED ("false")`.
- **Confirmed:** Wrangler 4.112.0 deployed with `--containers-rollout=none` and
  `--keep-vars`, registering Worker version
  `af3a7c73-3ca8-4a78-80d2-9522cc0bb410` at the single intended hostname
  `living-image.logosact-account.workers.dev`. The deployment did not build or
  update a Container.
- **Confirmed:** an independent unauthenticated probe at 2026-07-21 12:52 JST
  received HTTP 302 for both `/viewer.html` and `/api/config`. Both responses
  were served by Cloudflare with private/no-store cache controls,
  `WWW-Authenticate: Cloudflare-Access`, and a redirect to the configured
  `logosact.cloudflareaccess.com` login path. The signed redirect state was not
  copied into this repository. Static and API routes were therefore intercepted
  before either response body was exposed anonymously.
- **Confirmed:** the normal anonymous responses disclosed no Preview URL. The
  version-controlled `preview_urls: false` setting remains in force.
- **Confirmed:** the real Access browser flow displayed `Log in to Living Image
  Private Staging`, accepted only the policy email used for this test, sent a
  one-time code, and reached the six-digit verification form. The code expires
  after 10 minutes and is not accessible to the project or recorded here.
- **Confirmed:** after the owner completed the OTP form, the same URL rendered
  the authenticated `Living Image Player` instead of the Access login page. It
  offered local `Open .limg` playback and displayed `Hosted compilation is
  disabled for this deployment. Existing .limg files still play entirely in
  the browser.`
- **Confirmed:** `src/ui/viewer.ts` only displays that hosted-disabled message
  after `/api/config` returns a valid hosted configuration with `enabled:
  false`; its fetch-failure path displays a different viewer-only message.
  Together with the authenticated live UI, this confirms the protected config
  request succeeded and the deployed flag remained false without starting a
  compile.
- **Confirmed:** Cloudflare Access authentication logs displayed two Allowed
  Self-Hosted events for `Living Image Private Staging` and the single exact
  policy email. The dashboard rendered timestamps `Jul 21, 2026 09:55:07 PM`
  and `Jul 21, 2026 09:55:36 PM` without an explicit timezone label, and zero
  Blocked events in the selected 12-hour window. This confirms the approved
  identity reached the intended application through Access; it does not replace
  a separate unauthorized-identity test.
- **Confirmed:** after endpoint activation, Container application
  `living-image-compilercontainer` remained `ready` with health `active: 0`,
  `assigned: 0`, and `healthy: 1`; its private-network image digest remained
  `sha256:ffdc13f8245b482481b554db7e2791a762dff02f6d97004335bf7a34016fc222`.
  No Compiler or inference request was made.

## Controlled private Compiler check

- **Decision:** after explicit owner approval, temporarily enable the hosted
  Compiler for one already-reviewed, ignored CC0 hold-out image only. Do not
  change the Access policy, route, Container image, instance limit, or
  five-minute `sleepAfter` value. Deploy both enable and disable changes with
  `--containers-rollout=none` and `--keep-vars`.
- **Confirmed:** the source was ignored local file
  `fixtures/holdout/source/stevenburrow-sample1.png`, a 1000×1000 RGBA PNG of
  148,980 bytes with SHA-256
  `d0897aaa12540b372c087c96f3012e129ddbbcbad29328a1cc996aef5c0f2831`.
  The author, source archive, CC0 1.0 legal code, and unchanged-pixel note are
  recorded in `fixtures/holdout/ATTRIBUTION.md`; the image itself remains
  Gitignored and was not added to the repository.
- **Confirmed:** immediately before the remote check, the offline local
  Compiler produced a 287,093-byte `.limg` with SHA-256
  `b3462a65df3a7271aef35dcf72876db96ce58010c0cfd7bb4fc09369582bf884`,
  quality `full`, score `0.87729306546264`, no disabled capabilities, and
  Compiler version 0.8.0.
- **Confirmed:** the temporary enabling deployment registered Worker version
  `9376b159-2bd0-4040-9d6b-e801dabb9b05`. It retained the existing private
  Container image digest
  `sha256:ffdc13f8245b482481b554db7e2791a762dff02f6d97004335bf7a34016fc222`
  and did not roll out a new image.
- **Confirmed:** through the Access-authenticated Viewer, the first end-to-end
  PNG upload completed in approximately 29.146 seconds and a repeat of the
  exact same source completed in approximately 4.641 seconds while the
  Container was warm. Both loaded as `Compiled · ready to review`, reported
  1000×1000, detector `hysts/anime-face-detector 0.1.0`, quality `full`, score
  `0.877`, no disabled capabilities, and enabled blink, talk, gaze, breath,
  showcase, recording, and `.limg` download controls.
- **Inference:** the shorter second duration is consistent with a warm
  Container and cached model process. These end-to-end browser timings include
  upload, Worker/Container processing, response, and Viewer loading; they are
  not isolated inference benchmarks.
- **Open:** the authenticated browser loaded the returned blob and exposed its
  `.limg` download control, but the in-app browser did not expose the downloaded
  blob as a local file. The exact remote artifact SHA-256 was therefore not
  captured, and byte equality with the local artifact is not claimed here.
- **Decision:** no second content/reject image was uploaded because approval was
  limited to one image. The existing local and container reject-path evidence
  remains valid, but a real Cloudflare content reject test requires a separately
  reviewed and approved image.
- **Confirmed:** the disable dry-run again reported
  `HOSTED_COMPILER_ENABLED ("false")`, and Worker version
  `53575916-b4c3-4925-9e79-7095ceb6143c` restored the hosted-disabled state.
  The authenticated Viewer then displayed `Hosted Viewer` and `Hosted
  compilation is disabled for this deployment.` The checked-in configuration
  also remained false.
- **Confirmed:** after rollback and the configured idle period, `wrangler
  containers instances` reported the named `primary` instance as `stopped`.
  Application health reported `active: 0`, `assigned: 1`, and `healthy: 0`.
  The retained assignment therefore names the stopped Durable Object instance;
  it is not an active Compiler process. No manual Container deletion was used.
- **Confirmed:** Cloudflare documents that Container charges begin when an
  instance receives a request and stop when it sleeps, while unused prewarmed
  images are not billed. Standard-2 provides 1 vCPU, 6 GiB memory, and 12 GB
  disk. The project intentionally retains the five-minute idle timeout:
  <https://developers.cloudflare.com/containers/pricing/> and
  <https://developers.cloudflare.com/containers/platform-details/architecture/>.
- **Confirmed:** post-rollback regression checks passed 55/55 TypeScript tests,
  53/53 Python tests, the production Viewer build, Worker build, and Cloudflare
  dry-run. The first sandboxed Python run could not bind localhost for five
  hosted-server tests; rerunning the unchanged suite with loopback permission
  passed all five and the full 53-test suite.

## Remaining rollout gates

- Test a separate unauthorized identity and confirm it cannot receive an
  application session. Anonymous denial, approved OTP access, the hosted-disabled
  Viewer/config state, and the corresponding Access audit events are confirmed.
- Verify the live origin rejects forged, missing, expired, wrong-issuer, and
  wrong-AUD assertions wherever edge Access does not intercept first.
- **Decision update:** after the owner reviewed the successful private test,
  keep `HOSTED_COMPILER_ENABLED=true` in normal operation behind Access.
  Separate Compiler and Viewer pages and the time-boxed review-mode design are
  recorded in `research/cloudflare-routes-and-review-mode.md`.
- Content rejection, concurrency, exact remote artifact hash, and
  longer-running resource/cost observations remain separate gates before any
  broader alpha.
- Rollback order is Compiler false, route removal, then Container stop; retain
  the default-deny Access application until the endpoint is gone.
