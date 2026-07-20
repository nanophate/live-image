from __future__ import annotations

from http import HTTPStatus
import json
from pathlib import Path
import struct
import unittest

from compiler.compile_character import DetectorRuntime
from compiler.compiler_service import (
    CompilerService,
    MAX_UPLOAD_BYTES,
    UploadError,
    safe_upload_name,
    validate_image_payload,
    validate_upload,
)
from compiler.studio_server import is_local_host


def png_header(width: int = 100, height: int = 100) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I4sII", 13, b"IHDR", width, height)


class StudioServerTests(unittest.TestCase):
    def test_upload_validation_and_filename_normalisation(self) -> None:
        self.assertEqual(safe_upload_name("../My Character.png", "image/png"), "My-Character.png")
        self.assertEqual(safe_upload_name("..\\..\\顔.jpeg", "image/jpeg"), "portrait.jpg")
        self.assertEqual(validate_upload("12", "image/png"), 12)
        with self.assertRaises(UploadError) as missing:
            validate_upload(None, "image/png")
        self.assertEqual(missing.exception.status, HTTPStatus.LENGTH_REQUIRED)
        with self.assertRaises(UploadError) as large:
            validate_upload(str(MAX_UPLOAD_BYTES + 1), "image/png")
        self.assertEqual(large.exception.status, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        with self.assertRaises(UploadError) as media:
            validate_upload("12", "image/gif")
        self.assertEqual(media.exception.status, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)

    def test_payload_signature_dimensions_and_local_host_are_fail_closed(self) -> None:
        self.assertEqual(validate_image_payload(png_header(512, 256), "image/png"), (512, 256))
        jpeg = b"\xff\xd8\xff\xc0\x00\x07\x08\x01\x00\x02\x00"
        self.assertEqual(validate_image_payload(jpeg, "image/jpeg"), (512, 256))
        with self.assertRaises(UploadError) as mismatch:
            validate_image_payload(jpeg, "image/png")
        self.assertEqual(mismatch.exception.status, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        with self.assertRaises(UploadError) as oversized:
            validate_image_payload(png_header(8193, 1), "image/png")
        self.assertEqual(oversized.exception.status, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        self.assertTrue(is_local_host("127.0.0.1:8787"))
        self.assertTrue(is_local_host("localhost:8787"))
        self.assertFalse(is_local_host(None))
        self.assertFalse(is_local_host("living-image.example:8787"))
        self.assertFalse(is_local_host("127.0.0.1.example"))

    def test_compiler_service_reuses_runtime_and_returns_playable_manifest(self) -> None:
        loads: list[tuple[bool, bool]] = []
        runtime = DetectorRuntime(detector=object(), digests={"test": "hash"})

        def load(offline: bool, flip_test: bool) -> DetectorRuntime:
            loads.append((offline, flip_test))
            return runtime

        def compile_fake(
            inputs: list[Path],
            output: Path,
            overlay: Path | None,
            offline: bool,
            flip_test: bool,
            detector_runtime: DetectorRuntime,
        ) -> list[tuple[Path, dict[str, object]]]:
            self.assertIs(detector_runtime, runtime)
            self.assertIsNone(overlay)
            output.mkdir(parents=True)
            manifest = {"format": "living-image", "quality": {"status": "full"}}
            path = output / f"{inputs[0].stem}.limg"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            return [(path, manifest)]

        service = CompilerService(
            offline=True,
            flip_test=False,
            runtime_loader=load,
            compile_function=compile_fake,
        )
        first = service.compile(png_header(), "first.png", "image/png")
        second = service.compile(png_header(), "second.png", "image/png")
        self.assertEqual(loads, [(True, False)])
        self.assertEqual(first.status, HTTPStatus.OK)
        self.assertEqual(first.filename, "first.limg")
        self.assertEqual(second.filename, "second.limg")

    def test_reject_response_contains_reasons_without_machine_paths(self) -> None:
        runtime = DetectorRuntime(detector=object(), digests={})

        def compile_reject(
            inputs: list[Path],
            output: Path,
            overlay: Path | None,
            offline: bool,
            flip_test: bool,
            detector_runtime: DetectorRuntime,
        ) -> list[tuple[Path, dict[str, object]]]:
            output.mkdir(parents=True)
            diagnostic = {
                "status": "reject",
                "rejectionReasons": ["no near-frontal anime face detected"],
            }
            path = output / "portrait.diagnostic.json"
            path.write_text(json.dumps(diagnostic), encoding="utf-8")
            return [(path, diagnostic)]

        service = CompilerService(
            offline=True,
            flip_test=False,
            runtime_loader=lambda *_: runtime,
            compile_function=compile_reject,
        )
        response = service.compile(png_header(), "nested/portrait.png", "image/png")
        body = json.loads(response.body)
        self.assertEqual(response.status, HTTPStatus.UNPROCESSABLE_ENTITY)
        self.assertEqual(body["status"], "reject")
        self.assertEqual(body["rejectionReasons"], ["no near-frontal anime face detected"])
        self.assertNotIn("/tmp", response.body.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
