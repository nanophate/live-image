from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from compiler.validate_suite import (
    CompilerResult,
    ValidationManifestError,
    _run_compiler,
    load_manifest,
    validate_suite,
)


class ValidationSuiteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sources = self.root / "images"
        self.sources.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _source(self, name: str) -> None:
        (self.sources / name).write_bytes(b"not decoded by the fake compiler")

    def _manifest(self, cases: list[dict[str, str]]) -> Path:
        path = self.root / "suite.json"
        path.write_text(json.dumps({"version": 1, "cases": cases}), encoding="utf-8")
        return path

    def test_runs_all_outcomes_and_writes_deterministic_relative_report(self) -> None:
        for name in ("full.png", "limited.png", "reject.png", "broken.png"):
            self._source(name)
        manifest = self._manifest(
            [
                {"id": "normal", "category": "baseline", "source": "images/full.png", "expected": "full"},
                {"id": "glasses", "category": "occlusion", "source": "images/limited.png", "expected": "limited"},
                {"id": "no_face", "category": "unsupported", "source": "images/reject.png", "expected": "reject"},
                {"id": "corrupt", "category": "unsupported", "source": "images/broken.png", "expected": "error"},
            ]
        )
        calls: list[str] = []

        def fake_runner(
            source: Path,
            artifact_dir: Path,
            overlay_dir: Path,
            offline: bool,
            flip_test: bool,
        ) -> CompilerResult:
            calls.append(source.name)
            if source.stem == "broken":
                raise RuntimeError("synthetic compiler failure")
            if source.stem == "reject":
                artifact_dir.joinpath("reject.diagnostic.json").write_text(
                    json.dumps({"status": "reject", "rejectionReasons": ["no face"]}),
                    encoding="utf-8",
                )
                return CompilerResult(2)
            status = source.stem
            disabled = ["gaze"] if status == "limited" else []
            artifact_dir.joinpath(f"{source.stem}.limg").write_text(
                json.dumps(
                    {
                        "compiler": {
                            "name": "fake-compiler",
                            "version": "0.4.0",
                            "detectorVersion": "test",
                        },
                        "analysis": {
                            "features": {
                                "eyes": [
                                    {
                                        "side": "left",
                                        "rig": {
                                            "deformation": {
                                                "method": "fixed-boundary-piecewise-affine-v1",
                                                "protectedLineArtMask": {
                                                    "method": "canny-active-aperture-v1",
                                                    "coverage": 0.25,
                                                },
                                                "iris": {
                                                    "method": "ellipse-cage-telea-v1",
                                                    "segmentationConfidence": 0.85,
                                                    "texture": {
                                                        "method": "source-rgba-ellipse-v1",
                                                        "coverage": 0.07,
                                                    },
                                                    "baseEye": {"method": "telea-inpaint-v1"},
                                                },
                                                "semanticMesh": {
                                                    "method": "semantic-weighted-triangle-mesh-v1",
                                                    "vertices": [{}, {}, {}],
                                                    "triangles": [[0, 1, 2]],
                                                    "minimumAreaRatio": 0.35,
                                                },
                                                "closedEye": {
                                                    "method": "affine-skin-fill-curve-v3",
                                                    "coverage": 0.2,
                                                    "retainedSamplePixels": 128,
                                                    "medianFitResidual": 2.5,
                                                    "upperSamplesIncluded": False,
                                                },
                                            }
                                        },
                                    }
                                ],
                                "mouth": {
                                    "lineConfidence": 0.8,
                                    "rig": {
                                        "deformation": {
                                            "method": "bounded-lip-bands-v1",
                                            "lineContrast": 48.0,
                                        }
                                    },
                                },
                            }
                        },
                        "quality": {
                            "status": status,
                            "score": 0.75,
                            "disabledCapabilities": disabled,
                            "metrics": {"faceScore": 0.9},
                        }
                    }
                ),
                encoding="utf-8",
            )
            overlay_dir.joinpath(f"{source.stem}.png").write_bytes(b"overlay")
            return CompilerResult(0)

        output_dir = self.root / "report"
        first = validate_suite(manifest, output_dir, runner=fake_runner, offline=True)
        first_text = (output_dir / "report.json").read_text(encoding="utf-8")
        second = validate_suite(manifest, output_dir, runner=fake_runner, offline=True)
        second_text = (output_dir / "report.json").read_text(encoding="utf-8")

        self.assertEqual(first, second)
        self.assertEqual(first_text, second_text)
        self.assertEqual(calls, ["full.png", "limited.png", "reject.png", "broken.png"] * 2)
        self.assertEqual(first["summary"]["matched"], 4)
        self.assertEqual(first["summary"]["outcomes"], {outcome: 1 for outcome in ("full", "limited", "reject", "error")})
        self.assertEqual(first["summary"]["categories"]["unsupported"]["total"], 2)
        self.assertEqual(first["generatedAt"], "reproducible-validation-does-not-store-wall-clock")
        self.assertEqual(first["summary"]["full"], 1)
        self.assertEqual(first["cases"][0]["result"], "full")
        self.assertEqual(first["cases"][0]["artifacts"]["limg"], "artifacts/normal/full.limg")
        self.assertEqual(first["cases"][0]["artifacts"]["overlay"], "overlays/normal/full.png")
        self.assertEqual(first["cases"][0]["quality"]["metrics"], {"faceScore": 0.9})
        self.assertEqual(first["cases"][0]["compiler"]["version"], "0.4.0")
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["protectedLineCoverage"],
            0.25,
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["irisMethod"],
            "ellipse-cage-telea-v1",
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["irisCoverage"],
            0.07,
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["baseEyeMethod"],
            "telea-inpaint-v1",
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["semanticMeshMethod"],
            "semantic-weighted-triangle-mesh-v1",
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["semanticMeshVertices"],
            3,
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["semanticMeshMinimumAreaRatio"],
            0.35,
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["closedEyeMethod"],
            "affine-skin-fill-curve-v3",
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["closedEyeRetainedSamplePixels"],
            128,
        )
        self.assertEqual(
            first["cases"][0]["deformation"]["eyes"][0]["closedEyeUpperSamplesIncluded"],
            False,
        )
        self.assertEqual(first["cases"][0]["deformation"]["mouth"]["lineConfidence"], 0.8)
        self.assertRegex(first["cases"][0]["sourceSha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(first["cases"][0]["artifactSha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            first["cases"][1]["capabilities"],
            {"enabled": ["blink", "mouth"], "disabled": ["gaze"]},
        )
        self.assertEqual(first["cases"][2]["artifacts"]["diagnostic"], "artifacts/no_face/reject.diagnostic.json")
        self.assertIn("synthetic compiler failure", first["cases"][3]["message"])
        self.assertNotIn(str(self.root), first_text)

    def test_rejects_duplicate_and_unsafe_case_paths_before_running(self) -> None:
        self._source("portrait.png")
        duplicate = self._manifest(
            [
                {"id": "same", "category": "a", "source": "images/portrait.png", "expected": "full"},
                {"id": "same", "category": "b", "source": "images/portrait.png", "expected": "limited"},
            ]
        )
        with self.assertRaisesRegex(ValidationManifestError, "duplicate case id"):
            load_manifest(duplicate)

        unsafe_id = self._manifest(
            [{"id": "../escape", "category": "a", "source": "images/portrait.png", "expected": "full"}]
        )
        with self.assertRaisesRegex(ValidationManifestError, "must match"):
            load_manifest(unsafe_id)

        outside = self.root.parent / "outside-validation-source.png"
        outside.write_bytes(b"outside")
        try:
            unsafe = self._manifest(
                [{"id": "escape", "category": "a", "source": "../outside-validation-source.png", "expected": "full"}]
            )
            with self.assertRaisesRegex(ValidationManifestError, "relative path"):
                load_manifest(unsafe)
        finally:
            outside.unlink()

    def test_verifies_optional_source_sha256(self) -> None:
        self._source("portrait.png")
        source = self.sources / "portrait.png"
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        valid = self._manifest(
            [
                {
                    "id": "verified",
                    "category": "integrity",
                    "source": "images/portrait.png",
                    "sourceSha256": digest,
                    "expected": "full",
                }
            ]
        )

        case = load_manifest(valid)[0]
        self.assertEqual(case.source_sha256, digest)

        invalid = self._manifest(
            [
                {
                    "id": "modified",
                    "category": "integrity",
                    "source": "images/portrait.png",
                    "sourceSha256": "0" * 64,
                    "expected": "full",
                }
            ]
        )
        with self.assertRaisesRegex(ValidationManifestError, "SHA-256 mismatch"):
            load_manifest(invalid)

    def test_matches_optional_capability_expectations_exactly(self) -> None:
        self._source("limited.png")
        manifest = self._manifest(
            [
                {
                    "id": "capabilities",
                    "category": "contract",
                    "source": "images/limited.png",
                    "expected": "limited",
                    "expectedEnabledCapabilities": ["blink", "mouth"],
                    "expectedDisabledCapabilities": ["gaze"],
                }
            ]
        )

        def fake_runner(
            source: Path,
            artifact_dir: Path,
            _overlay_dir: Path,
            _offline: bool,
            _flip_test: bool,
        ) -> CompilerResult:
            artifact_dir.joinpath(f"{source.stem}.limg").write_text(
                json.dumps(
                    {
                        "quality": {
                            "status": "limited",
                            "disabledCapabilities": ["gaze"],
                        }
                    }
                ),
                encoding="utf-8",
            )
            return CompilerResult(0)

        report = validate_suite(manifest, self.root / "report", runner=fake_runner)

        self.assertTrue(report["cases"][0]["matched"])
        self.assertEqual(
            report["cases"][0]["expectedCapabilities"],
            {"enabled": ["blink", "mouth"], "disabled": ["gaze"]},
        )

    def test_status_match_is_capability_mismatch_when_contract_is_wrong(self) -> None:
        self._source("limited.png")
        manifest = self._manifest(
            [
                {
                    "id": "wrong-capability",
                    "category": "contract",
                    "source": "images/limited.png",
                    "expected": "limited",
                    "expectedDisabledCapabilities": ["blink"],
                }
            ]
        )

        def fake_runner(
            source: Path,
            artifact_dir: Path,
            _overlay_dir: Path,
            _offline: bool,
            _flip_test: bool,
        ) -> CompilerResult:
            artifact_dir.joinpath(f"{source.stem}.limg").write_text(
                json.dumps(
                    {
                        "quality": {
                            "status": "limited",
                            "disabledCapabilities": ["gaze"],
                        }
                    }
                ),
                encoding="utf-8",
            )
            return CompilerResult(0)

        report = validate_suite(manifest, self.root / "report", runner=fake_runner)

        self.assertFalse(report["cases"][0]["matched"])
        self.assertEqual(report["summary"]["mismatched"], 1)

    def test_unknown_actual_capability_is_an_artifact_error(self) -> None:
        self._source("full.png")
        manifest = self._manifest(
            [
                {
                    "id": "typo",
                    "category": "contract",
                    "source": "images/full.png",
                    "expected": "full",
                    "expectedEnabledCapabilities": ["blink", "gaze", "mouth"],
                    "expectedDisabledCapabilities": [],
                }
            ]
        )

        def fake_runner(
            source: Path,
            artifact_dir: Path,
            _overlay_dir: Path,
            _offline: bool,
            _flip_test: bool,
        ) -> CompilerResult:
            artifact_dir.joinpath(f"{source.stem}.limg").write_text(
                json.dumps(
                    {
                        "quality": {
                            "status": "full",
                            "disabledCapabilities": ["mout"],
                        }
                    }
                ),
                encoding="utf-8",
            )
            return CompilerResult(0)

        report = validate_suite(manifest, self.root / "report", runner=fake_runner)

        self.assertEqual(report["cases"][0]["result"], "error")
        self.assertFalse(report["cases"][0]["matched"])
        self.assertIn("unknown disabledCapabilities", report["cases"][0]["message"])

    def test_rejects_unknown_or_overlapping_capability_expectations(self) -> None:
        self._source("portrait.png")
        unknown = self._manifest(
            [
                {
                    "id": "unknown",
                    "category": "contract",
                    "source": "images/portrait.png",
                    "expected": "full",
                    "expectedEnabledCapabilities": ["hair"],
                }
            ]
        )
        with self.assertRaisesRegex(ValidationManifestError, "unknown capabilities"):
            load_manifest(unknown)

        overlap = self._manifest(
            [
                {
                    "id": "overlap",
                    "category": "contract",
                    "source": "images/portrait.png",
                    "expected": "limited",
                    "expectedEnabledCapabilities": ["blink"],
                    "expectedDisabledCapabilities": ["blink"],
                }
            ]
        )
        with self.assertRaisesRegex(ValidationManifestError, "both enabled and disabled"):
            load_manifest(overlap)

    def test_default_runner_invokes_existing_compiler_with_passthrough_flags(self) -> None:
        source = self.root / "portrait.png"
        source.write_bytes(b"image")
        with mock.patch("compiler.validate_suite.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, "ok", "")
            result = _run_compiler(
                source,
                self.root / "artifacts", self.root / "overlays", True, True
            )

        command = run.call_args.args[0]
        self.assertEqual(command[1:3], ["-m", "compiler.compile_character"])
        self.assertIn("--offline", command)
        self.assertIn("--flip-test", command)
        self.assertEqual(result, CompilerResult(0, "ok", ""))

    def test_refuses_symlinked_case_output_before_cleanup_or_runner(self) -> None:
        self._source("portrait.png")
        manifest = self._manifest(
            [{"id": "escape", "category": "security", "source": "images/portrait.png", "expected": "full"}]
        )
        output_dir = self.root / "report"
        artifacts = output_dir / "artifacts"
        artifacts.mkdir(parents=True)
        outside = self.root / "outside"
        outside.mkdir()
        sentinel = outside / "portrait.limg"
        sentinel.write_text("must survive", encoding="utf-8")
        artifacts.joinpath("escape").symlink_to(outside, target_is_directory=True)
        runner = mock.Mock(side_effect=AssertionError("runner must not be called"))

        report = validate_suite(manifest, output_dir, runner=runner)

        self.assertEqual(report["cases"][0]["result"], "error")
        self.assertIn("symlink", report["cases"][0]["message"])
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")
        runner.assert_not_called()

    def test_child_failure_report_does_not_copy_machine_paths(self) -> None:
        self._source("broken.png")
        manifest = self._manifest(
            [{"id": "broken", "category": "error", "source": "images/broken.png", "expected": "error"}]
        )

        def failed_runner(*_args: object) -> CompilerResult:
            return CompilerResult(1, stderr="Traceback at /private/cache/model.py\nRuntimeError: failed")

        report = validate_suite(manifest, self.root / "report", runner=failed_runner)

        self.assertEqual(report["cases"][0]["message"], "compiler exited with status 1")
        self.assertNotIn("/private/cache", json.dumps(report))

    def test_tracked_validation_contract_pins_sources_and_capabilities(self) -> None:
        repository_root = Path(__file__).resolve().parents[1]
        manifest_path = repository_root / "fixtures" / "validation" / "manifest.json"
        report_path = repository_root / "fixtures" / "validation" / "report.json"

        cases = load_manifest(manifest_path)
        report = json.loads(report_path.read_text(encoding="utf-8"))
        reported_by_id = {item["id"]: item for item in report["cases"]}

        self.assertEqual(set(reported_by_id), {case.id for case in cases})
        for case in cases:
            with self.subTest(case=case.id):
                self.assertIsNotNone(case.source_sha256)
                self.assertIsNotNone(case.expected_enabled_capabilities)
                self.assertIsNotNone(case.expected_disabled_capabilities)

                reported = reported_by_id[case.id]
                self.assertEqual(reported["sourceSha256"], case.source_sha256)
                self.assertEqual(reported["expected"], case.expected)
                self.assertEqual(
                    reported["expectedCapabilities"],
                    {
                        "enabled": list(case.expected_enabled_capabilities or ()),
                        "disabled": list(case.expected_disabled_capabilities or ()),
                    },
                )
                self.assertEqual(reported["capabilities"], reported["expectedCapabilities"])
                self.assertTrue(reported["matched"])


if __name__ == "__main__":
    unittest.main()
