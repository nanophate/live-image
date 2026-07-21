from __future__ import annotations

from email.message import Message
from http import HTTPStatus
from io import BytesIO
import json
from pathlib import Path
import struct
from types import SimpleNamespace
import unittest

from compiler.compile_character import DetectorRuntime
from compiler.compiler_service import CompilerService
from compiler.container_api import ContainerHandler, interrupt_on_termination


def png_header(width: int = 100, height: int = 100) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I4sII", 13, b"IHDR", width, height)


class ContainerApiTests(unittest.TestCase):
    def setUp(self) -> None:
        runtime = DetectorRuntime(detector=object(), digests={"test": "hash"})

        def compile_fake(
            inputs: list[Path],
            output: Path,
            overlay: Path | None,
            offline: bool,
            flip_test: bool,
            detector_runtime: DetectorRuntime,
        ) -> list[tuple[Path, dict[str, object]]]:
            output.mkdir(parents=True)
            manifest = {"format": "living-image", "quality": {"status": "full"}}
            path = output / f"{inputs[0].stem}.limg"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            return [(path, manifest)]

        self.compiler = CompilerService(
            offline=True,
            flip_test=False,
            runtime_loader=lambda *_: runtime,
            compile_function=compile_fake,
        )

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        handler = ContainerHandler.__new__(ContainerHandler)
        handler.server = SimpleNamespace(compiler=self.compiler)
        handler.path = path
        handler.rfile = BytesIO(body or b"")
        handler.wfile = BytesIO()
        handler.headers = Message()
        for name, value in (headers or {}).items():
            handler.headers[name] = value
        response_status: list[int] = []
        response_headers: dict[str, str] = {}
        handler.send_response = lambda status: response_status.append(status)
        handler.send_header = lambda name, value: response_headers.__setitem__(name, value)
        handler.end_headers = lambda: None
        getattr(handler, f"do_{method}")()
        return response_status[0], response_headers, handler.wfile.getvalue()

    def test_health_is_fail_closed_until_model_is_loaded(self) -> None:
        status, headers, payload = self.request("GET", "/healthz")
        self.assertEqual(status, HTTPStatus.SERVICE_UNAVAILABLE)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(json.loads(payload)["ready"], False)
        self.assertNotIn("/", payload.decode("utf-8"))

        self.compiler.load()
        status, _, payload = self.request("GET", "/healthz")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(json.loads(payload)["ready"], True)

    def test_compile_route_returns_limg_and_request_id(self) -> None:
        payload = png_header()
        status, headers, body = self.request(
            "POST",
            "/api/compile",
            payload,
            {
                "Content-Type": "image/png",
                "Content-Length": str(len(payload)),
                "X-Living-Image-Filename": "portrait.png",
                "X-Request-Id": "test-request-1",
            },
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(headers["X-Request-Id"], "test-request-1")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(json.loads(body)["format"], "living-image")

    def test_surface_rejects_unknown_routes_and_invalid_media(self) -> None:
        status, _, _ = self.request("GET", "/viewer.html")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)
        status, _, payload = self.request(
            "POST",
            "/api/compile",
            b"gif",
            {"Content-Type": "image/gif", "Content-Length": "3"},
        )
        self.assertEqual(status, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        self.assertEqual(json.loads(payload)["status"], "error")

    def test_compile_rejects_a_body_shorter_than_content_length(self) -> None:
        payload = png_header()
        status, _, body = self.request(
            "POST",
            "/api/compile",
            payload,
            {"Content-Type": "image/png", "Content-Length": str(len(payload) + 1)},
        )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("declared length", json.loads(body)["message"])

    def test_sigterm_interrupt_unwinds_request_contexts(self) -> None:
        with self.assertRaises(KeyboardInterrupt):
            interrupt_on_termination(15, None)


if __name__ == "__main__":
    unittest.main()
