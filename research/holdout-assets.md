# External licensed hold-out asset selection

Review date: **2026-07-20**. This is an engineering provenance record, not legal
advice.

## Confirmed

The following facts were checked on the creators' OpenGameArt asset pages before
downloading or running the detector:

| Work | Page evidence | Declared license |
| --- | --- | --- |
| [Anime Girl and Boy Portraits](https://opengameart.org/content/anime-girl-and-boy-portraits) | stevenburrow says the portraits were created from scratch; the archive contains editable GIMP source and samples | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) |
| [manga girl](https://opengameart.org/content/manga-girl) | mcproject identifies the work as a manga face made with GIMP | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) |
| [Casual Avatars](https://opengameart.org/content/casual-avatars) | Kitsuge Apps publishes the individual portrait PNGs and a copyright notice under its account | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) |
| [Character Portrait ~ Maid](https://opengameart.org/content/character-portrait-maid) | Jupiter's Daughter publishes the resource pack; its included terms require creator credit and match the page license | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/legalcode) |
| [Character Portrait](https://opengameart.org/content/character-portrait) | zonked publishes the painted character portrait as concept art | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) |

Exact download URLs, extraction/rename notes, file and archive hashes, and the
required Jupiter's Daughter attribution are in
[`../fixtures/holdout/ATTRIBUTION.md`](../fixtures/holdout/ATTRIBUTION.md).

## Decision

Use one file from each of five independent contributors as **hold-out A**. The
set spans clean flat-colour art, large highlighted irises, one closed eye, a
small full-body face, and a semi-realistic painted input. Freeze expected
quality and capabilities from visual inspection before the first detector run.

The files remain local-only test media under their own licenses; they are
ignored by Git and are not relicensed or distributed under the repository's MIT
License. Generated overlays, `.limg` files, and rendered images inherit the
applicable source-media obligations. In particular, any distributed derivative
of the maid portrait must retain creator credit, source, license link, and
change indication.

## Inference

The pages, descriptions, editable source files, dates, and contributor context
are consistent with human-created digital art. OpenGameArt's page for the
Kitsuge avatar does not describe its internal drawing or avatar-maker pipeline,
so the exact production process is not independently confirmed. This does not
affect the declared CC0 permission, but it should not be cited as proof of a
specific authorship process.

## Open

- The repository records publisher declarations; it does not independently
  audit chain of title for third-party uploads.
- These assets are appropriate for a public research/test fixture set, not a
  basis for claiming the detector models or a commercial compiler are fully
  provenance-cleared.
- If this hold-out informs threshold or warp changes, it becomes a regression
  set and must be replaced by unseen hold-out B for the next generalisation
  claim.
