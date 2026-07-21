# Container detector stage and thread profile

Date: 2026-07-21

Status: deterministic one-thread compiler default adopted and locally validated;
Cloudflare private staging remains unmeasured

## Question

The first constrained Docker benchmark was too slow despite low memory use.
Does model architecture require a different host, or is CPU quota interaction
with PyTorch's default thread pool the primary cause?

## Method

- Added `compiler.profile_compile`, an offline benchmark harness that keeps
  timing data outside `.limg` and temporary artifacts outside the repository.
- Split the pinned anime-face-detector 0.1.0 call into its private face-box
  hook and public landmark call only inside this benchmark harness. Production
  inference remains the upstream combined detector call.
- Timed decode, YOLOv3 face detection, HRNetV2 landmark detection, manifest and
  layer construction, and serialization/write with `perf_counter`.
- Used the frozen `teal-librarian.png` input, SHA-256
  `4480e53d53959ac7aa8665a91166ec3c5e839bb10bd53aaa96d708607b5798e6`.
- Compared Docker CPU quotas and explicit PyTorch intra-op thread counts. The
  final compiler also fixes inter-op threads to one by default. Both values can
  be overridden explicitly with `LIVING_IMAGE_TORCH_THREADS` and
  `LIVING_IMAGE_TORCH_INTEROP_THREADS` for a measured higher-CPU deployment.

## Stage evidence

### Unrestricted x86_64 host

With the former defaults (6 intra-op, 12 inter-op), the second iteration took
2.323132 seconds:

- decode: 0.045840 s
- YOLO face detection: 1.791571 s
- HRNet landmark detection: 0.259326 s
- manifest/layers: 0.209416 s
- serialization/write: 0.016925 s

**Confirmed:** face detection was approximately 77% of this warm compiler
iteration. `.limg` serialization was not a material bottleneck.

### 1 CPU / 6 GiB Container

| PyTorch threads | Model load | First total | Warm total | Warm YOLO | Warm HRNet |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12 intra / 12 inter-op | 18.497350 s | 82.138039 s | 63.715890 s | 38.081982 s | 24.491624 s |
| 1 intra / 12 inter-op | 7.016152 s | 9.465972 s | 9.541791 s | 7.719868 s | 0.959283 s |

- **Confirmed:** matching intra-op threads to the one-CPU quota reduced the
  profiled warm total by approximately 6.7 times without changing detector
  weights, preprocessing, thresholds, or the automatic reject path.
- **Inference:** cgroup CPU throttling plus a thread pool sized from the 12-CPU
  Docker VM caused most of the original standard-2-shaped latency.

### Quota comparison after thread control

| CPU quota | Intra-op threads | Model load | First profile | Warm profile |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 CPU | 1 | 11.508242 s | 14.772068 s | not repeated |
| 1 CPU | 1 | 7.016152 s | 9.465972 s | 9.541791 s |
| 2 CPU | 2 | 7.046396 s | 6.765966 s | 7.036333 s |

The 2-CPU result improves on the same profiler's 1-CPU result, but not enough
to justify choosing it before measuring the provider. The 0.5-CPU result is a
large improvement over the earlier 81.24-second warm end-to-end measurement,
but approximately 15 seconds remains a weak first impression.

## Final HTTP and artifact validation

The final image defaults to one intra-op and one inter-op thread. Image:

`sha256:5a19951850bc6b95c006061cc299a466385cc3f69eaba478a00b50bf6c56aede`

Size: 1,774,900,630 bytes.

At 1 CPU / 6 GiB, the real `/api/compile` path returned:

- **Confirmed:** first request including lazy runtime load: HTTP 200 in
  10.055379 seconds.
- **Confirmed:** second warm request: HTTP 200 in 4.951901 seconds.
- **Confirmed:** both responses were 2,498,823 bytes and had identical SHA-256
  `3d6dafc84b249958b8abf39edc8df4308e353b115a0690540f1988526c490aac`.
- **Confirmed:** the artifact remained `full`, with no disabled capabilities.
- **Confirmed:** loaded idle memory was 549.8 MiB; shutdown exited 0 without OOM.
- **Confirmed:** runtime logs contained no Hugging Face network warning; the
  final image remained offline.

The stage-profiler and HTTP timings were separate process runs and therefore
must not be subtracted from each other. Docker Desktop scheduling variance is
visible; provider SLOs require repeated authenticated staging measurements.

## Quality and reproducibility gate

Changing thread count changes floating-point detector values in the last few
digits, so speed alone was not used as an adoption criterion.

- **Confirmed:** the 12-image public matrix remains 12/12: 7 full and 5
  limited, with the same exact capability partitions.
- **Confirmed:** the external hold-out remains the deliberately preserved 2/5
  expected-outcome result: 1 full, 2 limited, and 2 reject.
- **Confirmed:** after making one intra-op and one inter-op thread the compiler
  default, two independent public-suite runs produced byte-identical report
  SHA-256
  `851dfd7e958dc763f6a8a8bdabdb6a63c54e92b3a3bdf0c2ca3b0349afc1d79d`.
- **Confirmed:** two independent hold-out runs produced byte-identical report
  SHA-256
  `4c00f18735a8c88c9a1f6fbeeb32e4bd81eb69b38fba35770004572b9090bc3e`.
- **Decision:** update the tracked reports to this reproducible default rather
  than retain artifacts generated by the former nondeterministic thread pool.

## Decision

- **Decision:** default all Compiler paths to one intra-op and one inter-op
  PyTorch thread. This makes local and hosted results consistent and prevents
  cgroup oversubscription. Overrides are an explicit benchmark/deployment knob,
  not an automatic guess from host CPU count.
- **Decision:** standard-2 is now a plausible first authenticated private-alpha
  target. A roughly five-second local warm response is sufficient to test the
  actual provider path, but it is not a public production SLO.
- **Decision:** retain standard-1 as a cost comparison, not the preferred demo
  instance. The approximately 15-second profiled request is too slow for a
  polished review path.
- **Decision:** defer ONNX/OpenVINO and detector replacement. The first blocker
  was thread-quota mismatch, and replacing inference backends would add quality,
  numerical, dependency, and license review surfaces.
- **Open:** measure at least five first/warm requests on authenticated
  Cloudflare standard-1 and standard-2, including Container provisioning,
  Worker transit, queueing, RSS, and cost. No deployment is authorized by this
  local decision.
