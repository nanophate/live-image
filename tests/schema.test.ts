import assert from "node:assert/strict";
import test from "node:test";

import { parseLivingImage, validateManifest } from "../src/schema.js";
import { fixtureManifest } from "./fixture.js";

test("validates a version-one portable manifest", () => {
  const manifest = fixtureManifest();
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(parseLivingImage(JSON.stringify(manifest)).id, "fixture");
});

test("rejects missing embedded images and unknown versions", () => {
  const manifest = fixtureManifest() as unknown as Record<string, unknown>;
  manifest.version = 2;
  assert.throws(() => validateManifest(manifest), /unsupported/);
});
