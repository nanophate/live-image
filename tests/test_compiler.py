from __future__ import annotations

import unittest

import cv2
import numpy as np

from compiler.compile_character import assess_quality, detect_pupil, normalise_box


class CompilerGeometryTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

