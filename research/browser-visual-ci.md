# Headless browser CI for the Canvas 2D runtime

Review date: **2026-07-20**. This is an engineering and provenance review, not
legal advice. The option review was completed before implementation; the
adopted implementation and reproduced evidence are recorded below.

## Scope and current gap

- **Confirmed (local):** the web job in `.github/workflows/ci.yml` runs on
  `ubuntu-24.04` with Node from `.node-version` (`24.18.0`), then runs
  `npm ci`, the TypeScript/fake-DOM tests, and the Vite build. It never launches
  a browser.
- **Confirmed (local):** `tests/runtime-load.test.ts` replaces `Image`,
  `document`, canvas, and the 2D context with fakes. It verifies control flow,
  but cannot exercise browser image decoding, clipping, compositing,
  `drawImage`, interpolation, or `getImageData`.
- **Confirmed (local):** the real path in `src/runtime.ts` uses all of those
  browser facilities, including offscreen protection canvases and
  `destination-in`. A real-browser check therefore covers a materially
  different failure surface.

## Candidate comparison

| Candidate | Browser provisioning | Fit for this repository | Cost and reproducibility | License/provenance surface |
| --- | --- | --- | --- | --- |
| `@playwright/test` + Playwright Chromium | Explicit `playwright install`; can install only Chromium headless shell | Built-in assertions, artifacts, retries, browser fixtures, and `webServer` can own Vite preview | One added top-level dependency and one pinned browser family; cold browser download is the main cost | Playwright code is Apache-2.0; downloaded Chromium is a separate binary/license surface |
| Puppeteer | `puppeteer` install downloads Chrome for Testing and headless shell by default; `puppeteer-core` requires explicit browser management | Good low-level browser control, but this project must supply its own test runner, assertions, server lifecycle, diffs, and reports | Smaller direct automation library, but default browser provisioning is large; fewer integrated test features means more local glue | Puppeteer code is Apache-2.0; Chrome for Testing is a separate binary/terms surface |
| Playwright or Puppeteer against runner Chrome | GitHub-hosted `ubuntu-24.04` already contains Google Chrome | Smallest cold-start/network addition and useful as a smoke-test option | Browser version follows runner-image updates, so Canvas/screenshot output can change without a lockfile change | The repository does not redistribute the runner's Chrome, but execution is subject to Google's Chrome terms rather than Chromium alone |
| Direct Chrome CLI/CDP | Use runner Chrome and hand-roll CDP/session handling | Lowest package count, highest maintenance cost; no integrated assertions, readiness, traces, or report | Floating runner browser plus custom protocol code | Same Chrome terms issue; project-authored glue becomes a maintenance surface |

### Automation libraries and Node/Vite compatibility

- **Confirmed:** Playwright's current system requirements list Node 22.x, 24.x,
  or 26.x and Ubuntu 24.04, and its current package metadata declares
  `node >=18`. It is compatible with this repository's Node 24 line.
  ([Playwright installation/system requirements](https://playwright.dev/docs/intro),
  [npm package](https://www.npmjs.com/package/@playwright/test))
- **Confirmed:** current Puppeteer package metadata declares
  `node >=22.12.0`, so it is also compatible with Node 24.18.x.
  ([Puppeteer package metadata](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer/package.json),
  [npm package](https://www.npmjs.com/package/puppeteer))
- **Confirmed:** Vite 7 requires Node 20.19+ or 22.12+; Node 24.18 is inside the
  supported `22.12+`-style range. Playwright's `webServer` option can start a
  local server, wait for a URL, and provide a base URL to tests. This fits a
  `vite preview` process after the existing build without a second workflow
  service or third-party wait utility.
  ([Vite 7 announcement](https://vite.dev/blog/announcing-vite7),
  [Playwright web server](https://playwright.dev/docs/test-webserver))
- **Confirmed:** Playwright supports its own open-source Chromium builds and
  branded Chrome channels. Each Playwright release expects specific browser
  binaries. The CLI supports a single-browser install and `--only-shell` for
  headless-only CI.
  ([Playwright browser management](https://playwright.dev/docs/browsers))
- **Confirmed:** Puppeteer automatically downloads compatible Chrome for
  Testing (documented as about 282 MB on Linux) and a headless-shell binary.
  `puppeteer-core` does not download Chrome, but then requires an explicit
  executable path or installed channel.
  ([Puppeteer installation](https://pptr.dev/guides/installation))

### Dependency and execution-size observations

- **Confirmed (npm registry query, 2026-07-20):** `npm view` reported latest
  `@playwright/test` 1.61.1 as 28,544 unpacked bytes, `playwright` 1.61.1 as
  4,875,435 bytes, and `playwright-core` 1.61.1 as 12,701,224 bytes. The useful
  comparison is therefore roughly **17.6 MB of direct unpacked Playwright
  packages before transitive duplication and before the browser**, not the
  28 KB wrapper alone. Reproduce with:
  `npm view @playwright/test@1.61.1 version dist.unpackedSize license engines dependencies --json`
  and the equivalent queries for `playwright` and `playwright-core`.
- **Confirmed (npm registry query, 2026-07-20):** `puppeteer` 25.3.0 reported
  42,486 unpacked bytes and `puppeteer-core` 25.3.0 reported 5,709,170 bytes,
  before their additional dependencies and browser binaries. Reproduce with
  `npm view puppeteer@25.3.0 version dist.unpackedSize license engines dependencies --json`
  and the equivalent `puppeteer-core` query.
- **Confirmed:** Playwright documents installed browsers as taking a few hundred
  megabytes and gives an illustrative 281 MB Chromium cache entry. It also
  documents `--only-shell` specifically to avoid downloading full Chromium for
  headless-only CI, but does not promise a stable byte size for that artifact.
  ([Playwright browser binary management](https://playwright.dev/docs/browsers))
- **Inference:** for either library, browser transfer/extraction will dominate
  the package install and test-body time on a cold runner. Playwright's
  Chromium-only headless-shell path should be materially smaller than installing
  all three default engines; an exact size or time must not be quoted until it
  is measured against the version adopted in the lockfile.
- **Open:** cold/warm wall-clock cost for this repository. The implementation PR
  should record timings for `npm ci`, browser installation, Vite startup, and
  the browser test separately on `ubuntu-24.04`. Network throughput and runner
  image contents make a pre-implementation estimate unreliable.

## Decision: minimal first implementation

- **Decision:** adopt **`@playwright/test`, one Playwright-managed Chromium
  headless shell, and no other browser** for the first actual Canvas 2D CI gate.
  Pin the package through `package-lock.json`; install its matching browser with
  `npx playwright install --with-deps --only-shell chromium` in the existing web
  job. This prioritizes a package/browser pair tested together and avoids a
  runner-image Chrome update silently changing the rendering engine.
- **Decision:** keep it in the existing `web` job, after `npm ci` and build,
  rather than add a separate matrix/job initially. Let Playwright `webServer`
  start `vite preview --host 127.0.0.1` and wait on a fixed loopback URL. The
  existing ten-minute timeout should be re-evaluated only after the cold-run
  measurement.
- **Decision:** add a distinct script such as `test:browser` and a Playwright
  config/test directory so the existing Node tests remain fast and independent.
  In CI, use one worker, no retries initially, and retain a screenshot plus
  Playwright trace only on failure. A retry can conceal nondeterminism in a
  renderer gate.
- **Decision:** make the first gate exercise the public runtime against at least
  the two primary compiled fixtures with idle disabled and explicit state/step
  inputs. Read actual pixels through `CanvasRenderingContext2D.getImageData` and
  assert deterministic invariants already important to the project:
  source load and dimensions; neutral -> blink/gaze/mouth pixels change only in
  compiler-authored regions; disabled capabilities do not change their region;
  and neutral -> motion -> neutral recovers exactly.
- **Decision:** do not make a full-page screenshot golden the primary signal.
  Compare canvas pixels or derived masks/numeric counts, then attach PNGs on
  failure for diagnosis. Playwright explicitly warns that screenshot rendering
  varies with OS, browser version, settings, hardware, and headless mode.
  ([Playwright visual comparisons](https://playwright.dev/docs/test-snapshots))
- **Decision:** do not use the preinstalled `channel: "chrome"` as the blocking
  pixel gate. It remains a possible non-pixel smoke check later if current
  stable Chrome coverage becomes valuable.

**Confirmed implementation update.** This decision was implemented with
`@playwright/test==1.61.1`, Chromium headless shell revision 1228, two stripped
automatic-rig snapshots, full-resolution ROI metrics in the Compare Viewer,
and an existing-web-job CI step. The measured pass and deliberate failure are
recorded in
[`experiments/2026-07-20-browser-locality-validation.md`](experiments/2026-07-20-browser-locality-validation.md).

### Implemented workflow shape

The exact package version comes from the lockfile. The existing web job is
extended as follows rather than introducing a new workflow:

```yaml
- name: Install Chromium headless shell
  run: npx playwright install --with-deps --only-shell chromium
- name: Run browser Canvas tests
  run: npm run test:browser
- name: Upload browser diagnostics
  if: ${{ failure() }}
  uses: actions/upload-artifact@v4
  with:
    name: browser-test-results
    path: test-results/
    if-no-files-found: ignore
```

**Confirmed:** the official Playwright GitHub Actions example performs `npm ci`,
installs browsers with `--with-deps`, runs tests, and uploads a report artifact.
The proposed delta narrows that example to the one engine this project needs.
([Playwright CI guide](https://playwright.dev/docs/ci-intro))

## License and redistribution review

- **Confirmed:** Playwright source/package code is Apache-2.0 and includes a
  NOTICE file. Puppeteer source/package code is also Apache-2.0.
  ([Playwright LICENSE](https://github.com/microsoft/playwright/blob/main/LICENSE),
  [Playwright NOTICE](https://github.com/microsoft/playwright/blob/main/NOTICE),
  [Puppeteer LICENSE](https://github.com/puppeteer/puppeteer/blob/main/LICENSE))
- **Confirmed:** Chromium's top-level license permits source and binary
  redistribution subject to preserving copyright/license/disclaimer text for
  binary redistribution; Chromium also contains third-party components whose
  notices must be considered separately.
  ([Chromium LICENSE](https://chromium.googlesource.com/chromium/src/+/main/LICENSE),
  [Chromium third-party licenses](https://chromium.googlesource.com/chromium/src/+/main/third_party/))
- **Confirmed:** GitHub-hosted Ubuntu 24.04 runner images include Chrome,
  ChromeDriver, and Chromium, and those image contents are regularly updated.
  ([Ubuntu 24.04 runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md),
  [runner-images support policy](https://github.com/actions/runner-images))
- **Inference:** downloading a Playwright browser only into an ephemeral CI
  runner does not put that binary into the repository's npm artifact or Viewer
  distribution. It still creates a third-party execution/dependency surface,
  but it is distinct from redistributing the browser to project users.
- **Decision:** when Playwright is actually adopted, add its exact version and
  Apache-2.0/NOTICE obligation to `THIRD_PARTY_NOTICES.md` and the web build/test
  row of `research/license-matrix.md`. Record the selected Chromium revision and
  retain the browser distribution's bundled license/notices in any future Docker
  image, offline CI cache export, or redistributed test appliance.
- **Decision:** do not copy a runner Google Chrome binary, Chrome for Testing
  binary, or Playwright browser cache into a release artifact without a separate
  terms/notices review. Using a browser during CI and redistributing it are
  different actions.
- **Open:** Chrome for Testing's binary redistribution terms are not stated
  clearly enough in the reviewed automation documentation to classify it as an
  Apache-2.0 Chromium binary. The Apache-2.0 license on the Chrome-for-Testing
  *availability repository* covers that repository and should not be assumed to
  license the downloaded Chrome binary. This uncertainty is another reason not
  to choose Puppeteer's default downloaded Chrome path for the first gate.
  ([Chrome for Testing availability repository](https://github.com/GoogleChromeLabs/chrome-for-testing),
  [Google Chrome additional terms](https://www.google.com/chrome/terms/))

## Acceptance checks for the implementation PR

- Record locked Playwright version, browser revision, installed byte count, and
  cold CI timings in a dated experiment note.
- Prove the test fails after a deliberate, temporary renderer break and passes
  after reverting that break; do not commit the break.
- Ensure test output identifies the fixture, state, affected region, changed
  pixel count, and maximum channel delta rather than only saying that a
  screenshot differs.
- Confirm CI never fetches a model and the browser page makes no external
  requests; fixtures and `.limg` inputs must be repository-local.
- Verify `npm run test:ts`, `npm run build`, and the new browser suite on Node
  24.18.x locally, then in the existing `ubuntu-24.04` web job.
