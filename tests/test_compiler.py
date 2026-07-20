from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import cv2
import numpy as np

from compiler import __version__
from compiler.compile_character import assess_quality, compile_paths, detect_pupil, normalise_box


class CompilerGeometryTests(unittest.TestCase):
    def quality_with(
        self,
        *,
        pupil_confidence: float = 0.90,
        eye_confidence: float = 0.90,
        eye_symmetry: float = 0.90,
        image_width: int = 512,
        image_height: int = 512,
    ) -> dict[str, object]:
        keypoints = np.zeros((28, 3), dtype=np.float32)
        keypoints[:, 2] = 0.90
        larger_eye_width = 0.20
        eyes = [
            {
                "confidence": eye_confidence,
                "anchors": {"left": 0.10, "right": 0.10 + larger_eye_width},
                "pupil": {"confidence": pupil_confidence},
            },
            {
                "confidence": eye_confidence,
                "anchors": {
                    "left": 0.60,
                    "right": 0.60 + larger_eye_width * eye_symmetry,
                },
                "pupil": {"confidence": pupil_confidence},
            },
        ]
        face_box = (0, 0, image_width * 0.5, image_height * 0.5, 0.95)
        return assess_quality(
            face_box,
            keypoints,
            eyes,
            {"confidence": 0.90},
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

    def test_quality_v2_low_pupil_confidence_disables_only_gaze(self) -> None:
        quality = self.quality_with(pupil_confidence=0.599)

        self.assertEqual(quality["status"], "limited")
        self.assertEqual(quality["disabledCapabilities"], ["gaze"])
        self.assertIn(
            "gaze disabled because pupil confidence is below 0.60",
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

    def test_reject_diagnostic_uses_portable_input_name_and_compiler_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_dir = root / "nested"
            source_dir.mkdir()
            source = source_dir / "portrait.png"
            self.assertTrue(cv2.imwrite(str(source), np.zeros((32, 32, 3), dtype=np.uint8)))
            checkpoint = root / "model.bin"
            checkpoint.write_bytes(b"model")
            detector = mock.Mock(return_value=[])
            with (
                mock.patch("compiler.compile_character.create_detector", return_value=detector),
                mock.patch("compiler.compile_character.get_checkpoint_path", return_value=checkpoint),
            ):
                results = compile_paths([source], root / "output", None, False, False)

            diagnostic = json.loads(results[0][0].read_text(encoding="utf-8"))
            self.assertEqual(__version__, "0.2.0")
            self.assertEqual(diagnostic["input"], "portrait.png")
            self.assertEqual(diagnostic["compilerVersion"], __version__)
            self.assertNotIn(str(root), json.dumps(diagnostic))


if __name__ == "__main__":
    unittest.main()
