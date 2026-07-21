# Hosted compiler API local validation

Date: 2026-07-21

Status: local HTTP boundary validated with real detector results; Docker and
Cloudflare runtime remain unvalidated

## Protocol

- Use Python 3.12 from the project virtual environment.
- Force the reviewed model cache offline.
- Start compiler.container_api on localhost with eager model load.
- Request /healthz.
- POST the tracked, project-generated teal-librarian PNG to /api/compile with
  image/png, a portable filename, and a request ID.
- Save the response outside the repository and inspect the returned .limg.

Source binding:

- Path: fixtures/source/teal-librarian.png
- Bytes: 1,641,156
- SHA-256:
  4480e53d53959ac7aa8665a91166ec3c5e839bb10bd53aaa96d708607b5798e6

## Result

- **Confirmed:** eager model load completed and the API listened on localhost.
- **Confirmed:** /healthz returned HTTP 200 with ready=true and Compiler 0.8.0.
- **Confirmed:** /api/compile returned HTTP 200 in 4.339968 seconds.
- **Confirmed:** the response was 2,498,807 bytes.
- **Confirmed:** response SHA-256:
  3698e729cef8aff1af47d68bdebe35212ee93a898353e9c9650c8e257de76109
- **Confirmed:** the response parsed as a .limg with id teal-hosted,
  quality.status full, no disabled capabilities, and anime-face-detector 0.1.0.
- **Confirmed:** the generated .limg remained under /tmp and was not added to
  Git.
- **Confirmed:** the HTTP boundary regression suite now rejects a request body
  shorter than its declared Content-Length. The Worker boundary independently
  validates the length and forwards through FixedLengthStream with an explicit
  compiler-header allowlist.

## Interpretation

- **Confirmed:** the provider-neutral hosted HTTP entrypoint can perform the
  actual automatic detector path and return a playable character artifact.
- **Inference:** 4.34 seconds is a credible warm local CPU baseline, but it is
  not a Cloudflare standard-1 result. Container vCPU allocation, image startup,
  and platform routing may materially change it.
- **Open:** measure image build size, eager cold start, warm compile, peak RSS,
  two-request behavior, reject latency, and SIGTERM cleanup inside linux/amd64.
- **Open:** rerun the same source and request against authenticated Cloudflare
  standard-1 and standard-2 private deployments before choosing the instance.
