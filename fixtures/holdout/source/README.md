# Local-only hold-out inputs

The PNG files used by external hold-out A belong in this directory **locally**
but are intentionally excluded from Git. Do not force-add or redistribute them
with the repository.

Prepare the five filenames listed in `../manifest.json` from the primary-source
downloads and extraction notes in `../ATTRIBUTION.md`, then verify that all
local files exist and exactly match the frozen SHA-256 values:

```bash
npm run check:holdout:local
```

The full detector/runtime run remains:

```bash
npm run validate:holdout:offline
```

Generated `.limg` files, overlays, and rendered frames are also local-only.
