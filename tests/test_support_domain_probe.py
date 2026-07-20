from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import cv2
import numpy as np

from compiler import __version__ as compiler_version
from compiler.probe_support_domain import (
    EVIDENCE_STATUSES,
    SupportProbeError,
    _case_artifact_path,
    _load_bgr,
    _validate_artifact_binding,
    compute_support_descriptors,
    probe_manifest,
)
from compiler.validate_suite import ValidationCase


class SupportDomainProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _artifact(self, source_sha: str = "0" * 64) -> dict[str, object]:
        eye_landmarks = [
            {"x": 0.22, "y": 0.41},
            {"x": 0.29, "y": 0.36},
            {"x": 0.42, "y": 0.40},
            {"x": 0.40, "y": 0.47},
            {"x": 0.31, "y": 0.48},
            {"x": 0.23, "y": 0.46},
        ]
        return {
            "format": "living-image",
            "version": 1,
            "id": "clean",
            "compiler": {"version": compiler_version},
            "image": {"width": 256, "height": 256, "sha256": source_sha},
            "provenance": {"sourceSha256": source_sha},
            "analysis": {
                "face": {
                    "bbox": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
                },
                "features": {
                    "eyes": [
                        {
                            "side": "left",
                            "landmarks": eye_landmarks,
                            "region": {
                                "x": 0.18,
                                "y": 0.32,
                                "width": 0.28,
                                "height": 0.20,
                            },
                            "rig": {
                                "maxGazeX": 0.01,
                                "maxGazeY": 0.005,
                                "deformation": {
                                    "iris": {
                                        "centre": {"x": 0.33, "y": 0.42},
                                        "radiusX": 0.04,
                                        "radiusY": 0.05,
                                        "segmentationConfidence": 0.9,
                                    }
                                },
                            },
                        }
                    ],
                    "mouth": {
                        "landmarks": [
                            {"x": 0.40, "y": 0.68},
                            {"x": 0.50, "y": 0.69},
                            {"x": 0.60, "y": 0.68},
                            {"x": 0.50, "y": 0.70},
                        ],
                        "region": {
                            "x": 0.37,
                            "y": 0.64,
                            "width": 0.26,
                            "height": 0.11,
                        },
                    },
                },
            },
            "quality": {
                "status": "full",
                "metrics": {
                    "faceScore": 0.95,
                    "meanLandmarkScore": 0.90,
                    "eyeConfidence": 0.88,
                },
            },
        }

    def _source(self, *, crossing_line: bool) -> np.ndarray:
        image = np.full((256, 256, 3), 245, dtype=np.uint8)
        eye = np.array(
            [[56, 105], [74, 92], [108, 102], [103, 120], [80, 123], [59, 117]],
            dtype=np.int32,
        )
        cv2.polylines(image, [eye], True, (25, 25, 25), 2, cv2.LINE_8)
        cv2.circle(image, (84, 108), 10, (65, 65, 65), 2, cv2.LINE_8)
        cv2.circle(image, (84, 108), 4, (20, 20, 20), -1, cv2.LINE_8)
        cv2.line(image, (102, 174), (154, 174), (30, 30, 30), 2, cv2.LINE_8)
        if crossing_line:
            cv2.line(image, (84, 56), (84, 148), (0, 0, 0), 2, cv2.LINE_8)
        return image

    def test_probe_is_deterministic_and_reports_connected_edge_graph(self) -> None:
        artifact = self._artifact()
        clean = compute_support_descriptors(self._source(crossing_line=False), artifact)
        repeated = compute_support_descriptors(self._source(crossing_line=False), artifact)
        crossed = compute_support_descriptors(self._source(crossing_line=True), artifact)

        self.assertEqual(clean, repeated)
        self.assertGreaterEqual(
            crossed["irisConnectedEdgeGraph"]["left"]["connectedComponentCount"],
            clean["irisConnectedEdgeGraph"]["left"]["connectedComponentCount"],
        )
        self.assertGreater(
            crossed["irisConnectedEdgeGraph"]["left"][
                "largestConnectedComponentPixels"
            ],
            clean["irisConnectedEdgeGraph"]["left"][
                "largestConnectedComponentPixels"
            ],
        )
        self.assertGreater(
            clean["featureLandmarkEdgeSupport"]["left"]["supportedFraction"], 0
        )
        self.assertIn("face", clean["bilateralAbsoluteResidual"])
        self.assertIn("componentCount", clean["strongEdgeComponents"])
        self.assertEqual(clean["strongEdgeComponents"]["componentCount"], 5)
        self.assertAlmostEqual(
            clean["strongEdgeComponents"]["componentsPer10kPixels"],
            0.762939453125,
        )
        self.assertEqual(
            clean["irisConnectedEdgeGraph"]["left"][
                "largestConnectedComponentPixels"
            ],
            784,
        )

    def test_transparent_pixels_are_composited_on_white(self) -> None:
        rgba = np.zeros((8, 8, 4), dtype=np.uint8)
        rgba[:, :, :3] = (5, 20, 200)
        path = self.root / "transparent.png"
        self.assertTrue(cv2.imwrite(str(path), rgba))

        loaded = _load_bgr(path)

        self.assertTrue(np.all(loaded == 255))

    def test_manifest_probe_records_portable_reproducible_evidence(self) -> None:
        source_dir = self.root / "source"
        artifact_dir = self.root / "artifacts" / "clean"
        source_dir.mkdir()
        artifact_dir.mkdir(parents=True)
        source_path = source_dir / "clean.png"
        self.assertTrue(cv2.imwrite(str(source_path), self._source(crossing_line=False)))
        source_sha = hashlib.sha256(source_path.read_bytes()).hexdigest()
        manifest_path = self.root / "manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "cases": [
                        {
                            "id": "clean",
                            "category": "synthetic",
                            "source": "source/clean.png",
                            "sourceSha256": source_sha,
                            "expected": "full",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        artifact_path = artifact_dir / "clean.limg"
        artifact_path.write_text(
            json.dumps(self._artifact(source_sha)), encoding="utf-8"
        )

        report = probe_manifest(manifest_path, self.root / "artifacts")
        repeated = probe_manifest(manifest_path, self.root / "artifacts")

        self.assertEqual(report, repeated)
        self.assertEqual(report["summary"], {"total": 1, "measured": 1, "errors": 0})
        self.assertEqual(report["cases"][0]["sourceSha256"], source_sha)
        self.assertEqual(
            report["sourceManifestSha256"],
            hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        )
        self.assertNotIn(str(self.root), json.dumps(report))
        self.assertEqual(
            report["generatedAt"], "reproducible-probe-does-not-store-wall-clock"
        )
        self.assertEqual(report["evidenceStatus"], EVIDENCE_STATUSES[0])
        self.assertEqual(report["probe"]["parameters"]["cannyAperture"], 3)
        self.assertTrue(report["probe"]["parameters"]["cannyL2Gradient"])
        self.assertEqual(
            report["probe"]["parameters"]["connectedComponentConnectivity"], 8
        )

    def test_manifest_probe_rejects_stale_artifact_binding_portably(self) -> None:
        source_dir = self.root / "source"
        artifact_dir = self.root / "artifacts" / "clean"
        source_dir.mkdir()
        artifact_dir.mkdir(parents=True)
        source_path = source_dir / "clean.png"
        self.assertTrue(cv2.imwrite(str(source_path), self._source(crossing_line=False)))
        source_sha = hashlib.sha256(source_path.read_bytes()).hexdigest()
        manifest_path = self.root / "manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "cases": [
                        {
                            "id": "clean",
                            "category": "synthetic",
                            "source": "source/clean.png",
                            "sourceSha256": source_sha,
                            "expected": "full",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        artifact_path = artifact_dir / "clean.limg"
        artifact_path.write_text(
            json.dumps(self._artifact("f" * 64)), encoding="utf-8"
        )

        report = probe_manifest(manifest_path, self.root / "artifacts")

        self.assertEqual(report["summary"], {"total": 1, "measured": 0, "errors": 1})
        self.assertIn("does not match source", report["cases"][0]["error"])
        self.assertNotIn(str(self.root), json.dumps(report))

        malformed: list[tuple[str, dict[str, object]]] = []
        for label, field, value in (
            ("nan-gaze", "maxGazeX", float("nan")),
            ("infinite-gaze", "maxGazeY", float("inf")),
        ):
            document = copy.deepcopy(self._artifact(source_sha))
            document["analysis"]["features"]["eyes"][0]["rig"][field] = value
            malformed.append((label, document))
        for label, field, value in (
            ("negative-radius", "radiusX", -0.1),
            ("zero-radius", "radiusY", 0.0),
            ("nan-radius", "radiusX", float("nan")),
            ("nan-eligibility", "segmentationConfidence", float("nan")),
        ):
            document = copy.deepcopy(self._artifact(source_sha))
            document["analysis"]["features"]["eyes"][0]["rig"]["deformation"][
                "iris"
            ][field] = value
            malformed.append((label, document))

        for label, document in malformed:
            with self.subTest(malformed=label):
                artifact_path.write_text(json.dumps(document), encoding="utf-8")
                malformed_report = probe_manifest(
                    manifest_path, self.root / "artifacts"
                )
                self.assertEqual(
                    malformed_report["summary"],
                    {"total": 1, "measured": 0, "errors": 1},
                )
                json.dumps(malformed_report, allow_nan=False)
                self.assertNotIn(str(self.root), json.dumps(malformed_report))

    def test_artifact_binding_rejects_version_dimensions_and_geometry_drift(self) -> None:
        source_sha = "a" * 64
        source_path = self.root / "clean.png"
        case = ValidationCase(
            "clean",
            "synthetic",
            "clean.png",
            source_path,
            source_sha,
            "full",
            None,
            None,
        )
        image = self._source(crossing_line=False)
        artifact = self._artifact(source_sha)
        _validate_artifact_binding(case, artifact, image)

        wrong_version = copy.deepcopy(artifact)
        wrong_version["compiler"]["version"] = "0.3.0"
        with self.assertRaisesRegex(SupportProbeError, "version does not match"):
            _validate_artifact_binding(case, wrong_version, image)

        wrong_dimensions = copy.deepcopy(artifact)
        wrong_dimensions["image"]["width"] = 255
        with self.assertRaisesRegex(SupportProbeError, "dimensions do not match"):
            _validate_artifact_binding(case, wrong_dimensions, image)

        invalid_face = copy.deepcopy(artifact)
        invalid_face["analysis"]["face"]["bbox"] = {
            "x": 0.9,
            "y": 0.0,
            "width": 0.2,
            "height": 1.0,
        }
        with self.assertRaisesRegex(SupportProbeError, "outside the source image"):
            compute_support_descriptors(image, invalid_face)

    def test_artifact_path_cannot_escape_through_symlink(self) -> None:
        source_path = self.root / "clean.png"
        case = ValidationCase(
            "clean",
            "synthetic",
            "clean.png",
            source_path,
            "a" * 64,
            "full",
            None,
            None,
        )
        artifacts = self.root / "artifacts"
        outside = self.root / "outside"
        artifacts.mkdir()
        outside.mkdir()
        (outside / "clean.limg").write_text("{}", encoding="utf-8")
        (artifacts / "clean").symlink_to(outside, target_is_directory=True)

        with self.assertRaisesRegex(SupportProbeError, "symlinked"):
            _case_artifact_path(case, artifacts)


if __name__ == "__main__":
    unittest.main()
