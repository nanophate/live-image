from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import cv2
import numpy as np

from compiler import __version__
from compiler.compile_character import (
    DetectorRuntime,
    EXPECTED_MODEL_SHA256,
    assess_quality,
    closed_eye_corrective_layer,
    compile_eye,
    compile_mouth,
    compile_paths,
    detect_pupil,
    ellipse_inside_polygon,
    load_detector_runtime,
    normalise_box,
    safe_diagonal_ellipse_shifts,
    safe_symmetric_ellipse_shift,
)


class CompilerGeometryTests(unittest.TestCase):
    def test_detector_runtime_defaults_to_reproducible_single_thread(self) -> None:
        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch("torch.set_num_threads") as set_threads,
            mock.patch("torch.get_num_interop_threads", return_value=12),
            mock.patch("torch.set_num_interop_threads") as set_interop_threads,
            mock.patch("compiler.compile_character.create_detector", return_value=object()),
            mock.patch(
                "compiler.compile_character.get_checkpoint_path",
                side_effect=lambda name: Path(name),
            ),
            mock.patch(
                "compiler.compile_character.sha256_file",
                side_effect=lambda path: EXPECTED_MODEL_SHA256[path.name],
            ),
        ):
            runtime = load_detector_runtime(False, False)
        set_threads.assert_called_once_with(1)
        set_interop_threads.assert_called_once_with(1)
        self.assertEqual(runtime.digests, EXPECTED_MODEL_SHA256)

    def test_detector_runtime_applies_explicit_container_thread_limit(self) -> None:
        with (
            mock.patch.dict(
                os.environ,
                {
                    "LIVING_IMAGE_TORCH_THREADS": "1",
                    "LIVING_IMAGE_TORCH_INTEROP_THREADS": "1",
                },
            ),
            mock.patch("torch.set_num_threads") as set_threads,
            mock.patch("torch.get_num_interop_threads", return_value=12),
            mock.patch("torch.set_num_interop_threads") as set_interop_threads,
            mock.patch("compiler.compile_character.create_detector", return_value=object()),
            mock.patch(
                "compiler.compile_character.get_checkpoint_path",
                side_effect=lambda name: Path(name),
            ),
            mock.patch(
                "compiler.compile_character.sha256_file",
                side_effect=lambda path: EXPECTED_MODEL_SHA256[path.name],
            ),
        ):
            runtime = load_detector_runtime(False, False)
        set_threads.assert_called_once_with(1)
        set_interop_threads.assert_called_once_with(1)
        self.assertEqual(runtime.digests, EXPECTED_MODEL_SHA256)

    def test_detector_runtime_rejects_invalid_thread_limit(self) -> None:
        for variable in ("LIVING_IMAGE_TORCH_THREADS", "LIVING_IMAGE_TORCH_INTEROP_THREADS"):
            for value in ("0", "not-an-integer"):
                with self.subTest(variable=variable, value=value), mock.patch.dict(
                    os.environ,
                    {
                        "LIVING_IMAGE_TORCH_THREADS": "1",
                        "LIVING_IMAGE_TORCH_INTEROP_THREADS": "1",
                        variable: value,
                    },
                ):
                    with self.assertRaisesRegex(RuntimeError, "positive integers"):
                        load_detector_runtime(False, False)

    def test_detector_runtime_rejects_unreviewed_weight_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary) / "model.safetensors"
            checkpoint.write_bytes(b"unreviewed-model")
            with (
                mock.patch("compiler.compile_character.create_detector", return_value=object()),
                mock.patch("compiler.compile_character.get_checkpoint_path", return_value=checkpoint),
            ):
                with self.assertRaisesRegex(RuntimeError, "detector weight digest mismatch"):
                    load_detector_runtime(False, False)

    def quality_with(
        self,
        *,
        pupil_confidence: float = 0.90,
        eye_confidence: float = 0.90,
        eye_symmetry: float = 0.90,
        mouth_line_confidence: float = 0.90,
        image_width: int = 512,
        image_height: int = 512,
        iris_layers_ready: bool | None = None,
        max_gaze_y: float = 0.01,
    ) -> dict[str, object]:
        keypoints = np.zeros((28, 3), dtype=np.float32)
        keypoints[:, 2] = 0.90
        larger_eye_width = 0.20
        layers_ready = pupil_confidence >= 0.60 if iris_layers_ready is None else iris_layers_ready
        eyes = [
            {
                "confidence": eye_confidence,
                "anchors": {"left": 0.10, "right": 0.10 + larger_eye_width},
                "pupil": {"confidence": pupil_confidence},
                "rig": {
                    "maxGazeX": 0.01,
                    "maxGazeY": max_gaze_y,
                    "deformation": {
                        "iris": {"segmentationConfidence": pupil_confidence}
                        if layers_ready
                        else None
                    },
                },
            },
            {
                "confidence": eye_confidence,
                "anchors": {
                    "left": 0.60,
                    "right": 0.60 + larger_eye_width * eye_symmetry,
                },
                "pupil": {"confidence": pupil_confidence},
                "rig": {
                    "maxGazeX": 0.01,
                    "maxGazeY": max_gaze_y,
                    "deformation": {
                        "iris": {"segmentationConfidence": pupil_confidence}
                        if layers_ready
                        else None
                    },
                },
            },
        ]
        face_box = (0, 0, image_width * 0.5, image_height * 0.5, 0.95)
        return assess_quality(
            face_box,
            keypoints,
            eyes,
            {"confidence": 0.90, "lineConfidence": mouth_line_confidence},
            image_width,
            image_height,
            1,
        )

    def test_normalise_box_clamps_to_image(self) -> None:
        self.assertEqual(
            normalise_box((-10, -5, 110, 55), 100, 50),
            {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        )

    def test_pupil_candidate_uses_image_pixels(self) -> None:
        image = np.full((80, 140, 3), 238, dtype=np.uint8)
        polygon = np.array([[20, 40], [55, 20], [120, 38], [108, 60], [65, 64], [28, 58]], dtype=np.float32)
        cv2.circle(image, (73, 43), 13, (90, 70, 35), -1)
        cv2.circle(image, (73, 43), 6, (20, 20, 20), -1)
        result = detect_pupil(image, polygon)
        point = result["point"]
        self.assertAlmostEqual(point[0], 73, delta=8)
        self.assertAlmostEqual(point[1], 43, delta=7)
        self.assertGreater(result["confidence"], 0.2)

    def test_safe_iris_shift_stays_inside_detected_eye_polygon(self) -> None:
        polygon = np.array(
            [[20, 40], [55, 20], [120, 38], [108, 60], [65, 64], [28, 58]],
            dtype=np.float32,
        )
        horizontal = safe_symmetric_ellipse_shift(polygon, 70, 42, 10, 8, 100, "x")
        vertical = safe_symmetric_ellipse_shift(polygon, 70, 42, 10, 8, 100, "y")
        self.assertGreater(horizontal, 0)
        self.assertLess(horizontal, 100)
        self.assertGreater(vertical, 0)
        self.assertLess(vertical, 100)
        for direction in (-1, 1):
            self.assertTrue(
                ellipse_inside_polygon(polygon, 70, 42, 10, 8, direction * horizontal, 0)
            )
            self.assertTrue(
                ellipse_inside_polygon(polygon, 70, 42, 10, 8, 0, direction * vertical)
            )

    def test_diagonal_iris_shift_jointly_scales_safe_axes(self) -> None:
        polygon = np.array(
            [[20, 40], [55, 20], [120, 38], [108, 60], [65, 64], [28, 58]],
            dtype=np.float32,
        )
        max_x = safe_symmetric_ellipse_shift(polygon, 70, 42, 10, 8, 100, "x")
        max_y = safe_symmetric_ellipse_shift(polygon, 70, 42, 10, 8, 100, "y")
        safe_x, safe_y = safe_diagonal_ellipse_shifts(
            polygon, 70, 42, 10, 8, max_x, max_y
        )
        self.assertLess(safe_x, max_x)
        self.assertLess(safe_y, max_y)
        for direction_x in (-1, 1):
            for direction_y in (-1, 1):
                self.assertTrue(
                    ellipse_inside_polygon(
                        polygon,
                        70,
                        42,
                        10,
                        8,
                        direction_x * safe_x,
                        direction_y * safe_y,
                    )
                )

    def test_quality_rejects_unstable_face(self) -> None:
        keypoints = np.zeros((28, 3), dtype=np.float32)
        keypoints[:, 2] = 0.2
        eye = {
            "confidence": 0.2,
            "anchors": {"left": 0.1, "right": 0.11},
            "pupil": {"confidence": 0.1},
        }
        mouth = {"confidence": 0.2}
        quality = assess_quality((0, 0, 40, 40, 0.4), keypoints, [eye, eye], mouth, 1000, 1000, 1)
        self.assertEqual(quality["status"], "reject")
        self.assertIn("blink", quality["disabledCapabilities"])
        self.assertTrue(quality["rejectionReasons"])

    def test_compiler_authors_eye_mesh_and_protected_line_mask(self) -> None:
        image = np.full((120, 180, 3), 230, dtype=np.uint8)
        cv2.line(image, (42, 20), (42, 85), (15, 15, 15), 3)
        keypoints = np.zeros((28, 3), dtype=np.float32)
        keypoints[:, 2] = 0.95
        keypoints[[11, 12, 13, 16, 15, 14], :2] = np.array(
            [[55, 58], [76, 42], [112, 56], [108, 80], [80, 84], [58, 79]],
            dtype=np.float32,
        )
        cv2.ellipse(image, (82, 59), (15, 17), 0, 0, 360, (70, 50, 30), -1)

        eye = compile_eye("left", image, keypoints, 180, 120, 120)
        deformation = eye["rig"]["deformation"]

        self.assertEqual(len(deformation["sourceRows"]), 6)
        self.assertEqual(len(deformation["closedRows"]), 6)
        self.assertTrue(all(a < b for a, b in zip(deformation["sourceRows"], deformation["sourceRows"][1:])))
        self.assertTrue(all(a < b for a, b in zip(deformation["closedRows"], deformation["closedRows"][1:])))
        mask = deformation["protectedLineArtMask"]
        self.assertTrue(mask["dataUrl"].startswith("data:image/png;base64,"))
        self.assertGreater(mask["coverage"], 0)
        self.assertEqual(mask["method"], "canny-active-aperture-v1")
        mask_bytes = base64.b64decode(mask["dataUrl"].split(",", 1)[1])
        decoded_mask = cv2.imdecode(np.frombuffer(mask_bytes, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        region = deformation["region"]
        local_pupil_x = int(round(eye["pupil"]["x"] * 180 - region["x"] * 180))
        local_pupil_y = int(round(eye["pupil"]["y"] * 120 - region["y"] * 120))
        self.assertEqual(int(decoded_mask[local_pupil_y, local_pupil_x, 3]), 0)

        semantic_mesh = deformation["semanticMesh"]
        self.assertEqual(semantic_mesh["method"], "semantic-weighted-triangle-mesh-v1")
        self.assertEqual(len(semantic_mesh["vertices"]), 42)
        self.assertEqual(len(semantic_mesh["triangles"]), 60)
        self.assertEqual(len(semantic_mesh["aperture"]), 10)
        self.assertGreaterEqual(semantic_mesh["minimumAreaRatio"], 0.02)
        blink_field = semantic_mesh["fields"][0]
        self.assertEqual(blink_field["control"], "blink")
        self.assertEqual(len(blink_field["weights"]), len(semantic_mesh["vertices"]))
        self.assertEqual(len(blink_field["maxDisplacements"]), len(semantic_mesh["vertices"]))
        self.assertTrue(all(0 <= weight <= 1 for weight in blink_field["weights"]))
        self.assertTrue(all(blink_field["weights"][index] == 0 for index in range(7)))
        self.assertTrue(all(blink_field["weights"][index] == 0 for index in range(35, 42)))

        iris = deformation["iris"]
        self.assertEqual(iris["method"], "ellipse-cage-telea-v1")
        self.assertEqual(iris["texture"]["method"], "source-rgba-ellipse-v1")
        self.assertEqual(iris["baseEye"]["method"], "telea-inpaint-v1")
        self.assertGreaterEqual(iris["segmentationConfidence"], 0.6)
        self.assertGreaterEqual(iris["inpaintRadius"], 2)
        expected_width = round(region["width"] * 180)
        expected_height = round(region["height"] * 120)
        for layer_name in ("texture", "baseEye"):
            layer = iris[layer_name]
            self.assertEqual(layer["width"], expected_width)
            self.assertEqual(layer["height"], expected_height)
            payload = base64.b64decode(layer["dataUrl"].split(",", 1)[1])
            decoded = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
            self.assertEqual(decoded.shape, (expected_height, expected_width, 4))
            if layer_name == "texture":
                self.assertGreater(np.count_nonzero(decoded[:, :, 3]), 0)
                self.assertLess(np.count_nonzero(decoded[:, :, 3]), decoded.shape[0] * decoded.shape[1])
            else:
                self.assertTrue(np.all(decoded[:, :, 3] == 255))
        self.assertGreaterEqual(iris["centre"]["x"] - iris["radiusX"], region["x"])
        self.assertLessEqual(
            iris["centre"]["x"] + iris["radiusX"],
            region["x"] + region["width"],
        )
        self.assertGreaterEqual(iris["centre"]["y"] - iris["radiusY"], region["y"])
        self.assertLessEqual(
            iris["centre"]["y"] + iris["radiusY"],
            region["y"] + region["height"],
        )

        closed_eye = deformation["closedEye"]
        self.assertEqual(closed_eye["method"], "affine-skin-fill-curve-v3")
        self.assertEqual(closed_eye["width"], expected_width)
        self.assertEqual(closed_eye["height"], expected_height)
        self.assertEqual(closed_eye["activationStart"], 0.55)
        self.assertGreaterEqual(closed_eye["retainedSamplePixels"], 48)
        self.assertGreaterEqual(closed_eye["medianFitResidual"], 0)
        self.assertIsInstance(closed_eye["upperSamplesIncluded"], bool)
        corrective_payload = base64.b64decode(closed_eye["dataUrl"].split(",", 1)[1])
        corrective = cv2.imdecode(np.frombuffer(corrective_payload, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        self.assertEqual(corrective.shape, (expected_height, expected_width, 4))
        self.assertGreater(np.count_nonzero(corrective[:, :, 3]), 0)
        self.assertTrue(np.all(corrective[[0, -1], :, 3] == 0))
        self.assertTrue(np.all(corrective[:, [0, -1], 3] == 0))
        self.assertGreater(int(corrective[local_pupil_y, local_pupil_x, 3]), 0)

    def test_closed_eye_corrective_is_deterministic_and_sparse(self) -> None:
        image = np.full((100, 160, 3), (220, 226, 235), dtype=np.uint8)
        polygon = np.array(
            [[42, 48], [72, 32], [118, 47], [108, 68], [76, 72], [48, 67]],
            dtype=np.float32,
        )
        cv2.fillPoly(image, [polygon.astype(np.int32)], (35, 45, 55))
        region = (30, 10, 130, 98)
        first = closed_eye_corrective_layer(image, polygon, region, 61.0)
        second = closed_eye_corrective_layer(image, polygon, region, 61.0)
        self.assertIsNotNone(first)
        self.assertEqual(first, second)
        assert first is not None
        payload = base64.b64decode(first["dataUrl"].split(",", 1)[1])
        layer = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        self.assertGreater(int(layer[42, 50, 3]), 0)
        self.assertGreater(float(layer[42, 50, :3].mean()), 120)
        self.assertLess(first["coverage"], 0.60)
        self.assertTrue(np.all(layer[[0, -1], :, 3] == 0))
        self.assertTrue(np.all(layer[:, [0, -1], 3] == 0))

    def test_compiler_authors_bounded_mouth_line_bands(self) -> None:
        image = np.full((140, 180, 3), 225, dtype=np.uint8)
        cv2.line(image, (68, 92), (113, 91), (35, 25, 30), 2)
        keypoints = np.zeros((28, 3), dtype=np.float32)
        keypoints[:, 2] = 0.95
        keypoints[[24, 25, 26, 27], :2] = np.array(
            [[68, 92], [90, 94], [113, 91], [90, 95]], dtype=np.float32
        )

        mouth = compile_mouth(image, keypoints, 180, 140, (30, 20, 150, 125, 0.95))
        deformation = mouth["rig"]["deformation"]

        self.assertEqual(deformation["method"], "bounded-lip-bands-v1")
        self.assertGreater(deformation["upperBand"]["height"], 0)
        self.assertGreater(deformation["lowerBand"]["height"], 0)
        self.assertGreater(deformation["cavity"]["radiusX"], 0)
        self.assertGreater(deformation["lineContrast"], 0)
        self.assertGreater(mouth["lineConfidence"], 0)

    def test_quality_v2_full_boundaries_are_inclusive(self) -> None:
        quality = self.quality_with(
            pupil_confidence=0.60,
            eye_confidence=0.70,
            eye_symmetry=0.70,
            image_width=256,
            image_height=256,
        )

        self.assertEqual(quality["status"], "full")
        self.assertEqual(quality["disabledCapabilities"], [])
        self.assertEqual(quality["warnings"], [])
        self.assertEqual(quality["metrics"]["minImageDimensionPixels"], 256)

    def test_quality_v3_low_pupil_confidence_disables_blink_and_gaze_without_layers(self) -> None:
        quality = self.quality_with(pupil_confidence=0.599)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["blink", "gaze"])
        self.assertIn(
            "gaze disabled because pupil confidence is below 0.60",
            quality["warnings"],
        )
        self.assertIn(
            "blink and gaze disabled because one or both iris/base-eye layers are unreliable",
            quality["warnings"],
        )

    def test_quality_v2_low_eye_confidence_disables_blink_and_gaze(self) -> None:
        quality = self.quality_with(eye_confidence=0.699)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["blink", "gaze"])
        self.assertIn(
            "blink and gaze disabled because eye confidence is below 0.70",
            quality["warnings"],
        )

    def test_missing_iris_layers_disable_blink_and_gaze(self) -> None:
        quality = self.quality_with(iris_layers_ready=False)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["blink", "gaze"])
        self.assertIn(
            "blink and gaze disabled because one or both iris/base-eye layers are unreliable",
            quality["warnings"],
        )

    def test_zero_vertical_iris_clearance_disables_gaze(self) -> None:
        quality = self.quality_with(max_gaze_y=0.0)
        self.assertIn("gaze", quality["disabledCapabilities"])
        self.assertNotIn("blink", quality["disabledCapabilities"])

    def test_quality_v2_eye_asymmetry_disables_only_blink(self) -> None:
        quality = self.quality_with(eye_symmetry=0.699)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["blink"])
        self.assertIn(
            "blink disabled because eye symmetry is below 0.70",
            quality["warnings"],
        )

    def test_quality_v2_low_resolution_disables_pixel_sensitive_eye_controls(self) -> None:
        quality = self.quality_with(image_width=640, image_height=255)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["blink", "gaze"])
        self.assertIn(
            "blink and gaze disabled because the image shortest side is below 256 pixels",
            quality["warnings"],
        )
        self.assertEqual(quality["metrics"]["minImageDimensionPixels"], 255)

    def test_low_mouth_line_confidence_disables_only_mouth(self) -> None:
        quality = self.quality_with(mouth_line_confidence=0.249)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["mouth"])
        self.assertIn(
            "mouth control disabled because its landmarks or source line are unreliable",
            quality["warnings"],
        )

    def test_reject_diagnostic_uses_portable_input_name_and_compiler_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_dir = root / "nested"
            source_dir.mkdir()
            source = source_dir / "portrait.png"
            self.assertTrue(cv2.imwrite(str(source), np.zeros((32, 32, 3), dtype=np.uint8)))
            detector = mock.Mock(return_value=[])
            runtime = DetectorRuntime(detector=detector, digests={"test": "hash"})
            results = compile_paths([source], root / "output", None, False, False, runtime)

            diagnostic = json.loads(results[0][0].read_text(encoding="utf-8"))
            self.assertEqual(__version__, "0.8.0")
            self.assertEqual(diagnostic["input"], "portrait.png")
            self.assertEqual(diagnostic["compilerVersion"], __version__)
            self.assertNotIn(str(root), json.dumps(diagnostic))

    def test_compile_paths_rechecks_runtime_image_dimension_limit_before_detection(self) -> None:
        detector = mock.Mock()
        runtime = DetectorRuntime(detector=detector, digests={})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with mock.patch(
                "compiler.compile_character.cv2.imread",
                return_value=np.zeros((1, 8193, 3), dtype=np.uint8),
            ):
                with self.assertRaisesRegex(ValueError, "portable runtime limit"):
                    compile_paths([root / "oversized.png"], root / "output", None, True, False, runtime)
        detector.assert_not_called()


if __name__ == "__main__":
    unittest.main()
