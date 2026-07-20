import assert from "node:assert/strict";
import test from "node:test";

import { isSafeValidationArtifactPath } from "../src/validation-report.js";

test("accepts only the validation runner artifact shapes for the same case", () => {
  assert.equal(isSafeValidationArtifactPath("limg", "artifacts/clean-teal/portrait.limg", "clean-teal"), true);
  assert.equal(isSafeValidationArtifactPath("diagnostic", "artifacts/clean-teal/portrait.diagnostic.json", "clean-teal"), true);
  assert.equal(isSafeValidationArtifactPath("overlay", "overlays/clean-teal/portrait.png", "clean-teal"), true);

  for (const path of [
    "https://example.com/tracker.png",
    "data:image/png;base64,AA==",
    "../tracker.png",
    "overlays/other-case/portrait.png",
    "overlays/clean-teal/%2e%2e.png",
    "overlays\\clean-teal\\portrait.png",
  ]) {
    assert.equal(isSafeValidationArtifactPath("overlay", path, "clean-teal"), false, path);
  }
  assert.equal(isSafeValidationArtifactPath("overlay", "artifacts/clean-teal/portrait.png", "clean-teal"), false);
  assert.equal(isSafeValidationArtifactPath("diagnostic", "artifacts/clean-teal/portrait.limg", "clean-teal"), false);
});
