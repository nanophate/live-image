# License and provenance matrix

Snapshot: 2026-07-19. This is an engineering record, not legal advice.

| Item | Code | Weights/data/assets | MVP use | Status |
| --- | --- | --- | --- | --- |
| anime-face-detector | MIT; vendored portions Apache-2.0 | Model cards state MIT, but training-data provenance is not warranted | compile-time detector | usable for research MVP; provenance review before commercial release |
| MediaPipe | Apache-2.0 | task/model terms must be checked per artifact | future comparison only | not included |
| THA3 | MIT | published models CC BY 4.0 | taxonomy/research only | no copied code/model |
| THA4 | MIT code | demo models/assets include CC BY-NC 4.0 | research only | excluded from commercial path |
| FOMM | MIT code | checkpoints/training data need separate review | algorithm reference | no copied code/model |
| TPS Motion Model | source repository terms and checkpoint terms must be rechecked at adoption | training/checkpoints separate | paper/math reference | no copied code/model |
| LivePortrait | MIT project | bundled InsightFace models are non-commercial research | research/comparison | excluded dependency |
| AnimeCeleb | no clear repository license confirmed | dataset provenance/availability unresolved | taxonomy reference | no artifacts used |
| Animated Drawings | MIT repository | dataset subsets have their own MIT or CC BY 4.0 terms | architecture reference | no copied artifact in MVP |
| See-through | Apache-2.0 repository | many transitive models/data require separate review | later optional experiment | not included |
| MG-Gen | AGPL-3.0 | remote model/API inputs separate | conceptual reference | no code used |
| LiveSVG | implementation license not confirmed | inputs/models separate | conceptual reference | no code used |
| repository fixtures | n/a | generated specifically for this project with OpenAI image generation | regression tests and demo | prompt/provenance recorded in `fixtures/README.md` |

## Release checklist

- Freeze exact detector and weight digests inside released `.limg` provenance.
- Preserve MIT/Apache notices for redistributed detector code or weights.
- Obtain a product/legal decision on training-data provenance before declaring a
  commercial-safe compiler path.
- Re-check all remote model cards at the release tag rather than relying on this
  dated snapshot.
- Do not import InsightFace weights or any `-NC` asset into a commercial bundle.
- Choose and add a license for this repository only with the owner's approval.

