from __future__ import annotations

from http import HTTPStatus
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import struct
import tempfile
import threading
import unittest
from unittest import mock

from compiler.compile_character import DetectorRuntime
from compiler.compiler_service import CompilerService
from compiler.hosted_server import (
    HostedHandler,
    HostedServer,
    normalize_public_origin,
    public_origin_from_environment,
    request_matches_origin,
)


def png_header(width: int = 100, height: int = 100) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I4sII", 13, b"IHDR", width, height)


class HostedServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        temporary = Path(self.temporary.name)
        self.web_root = temporary / "dist"
        (self.web_root / "assets").mkdir(parents=True)
        (self.web_root / "index.html").write_text("<h1>Living Image</h1>", encoding="utf-8")
        (self.web_root / "viewer.html").write_text("<main>Viewer</main>", encoding="utf-8")
        (self.web_root / "assets" / "viewer-test.js").write_text("export {};", encoding="utf-8")
        self.outside = temporary / "outside.txt"
        self.outside.write_text("must not be served", encoding="utf-8")
        try:
            (self.web_root / "outside-link.txt").symlink_to(self.outside)
        except OSError:
            pass

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
        self.server = HostedServer(
            ("127.0.0.1", 0),
            HostedHandler,
            compiler=self.compiler,
            web_root=self.web_root,
            public_origin=None,
            compiler_enabled=False,
        )
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.server.public_origin = self.origin
        self.server.compiler_enabled = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temporary.cleanup()

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        response_headers = dict(response.getheaders())
        connection.close()
        return response.status, response_headers, payload

    def test_static_viewer_config_and_cache_contract_share_one_origin(self) -> None:
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(headers["Cache-Control"], "no-cache")
        self.assertIn(b"Living Image", body)

        status, headers, body = self.request("GET", "/viewer.html")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn(b"Viewer", body)

        status, headers, _ = self.request("GET", "/assets/viewer-test.js")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(headers["Cache-Control"], "public, max-age=31536000, immutable")

        status, headers, body = self.request("GET", "/api/config")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(
            json.loads(body),
            {
                "compiler": "hosted",
                "enabled": True,
                "samplesAvailable": False,
                "provider": "hugging-face",
            },
        )

    def test_compile_requires_exact_public_origin_and_returns_request_id(self) -> None:
        payload = png_header()
        headers = {
            "Content-Type": "image/png",
            "Origin": self.origin,
            "X-Living-Image-Filename": "portrait.png",
        }
        status, response_headers, body = self.request("POST", "/api/compile", payload, headers)
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(response_headers["Cache-Control"], "no-store")
        self.assertIn("X-Request-Id", response_headers)
        self.assertEqual(response_headers["Content-Disposition"], 'attachment; filename="portrait.limg"')
        self.assertEqual(json.loads(body)["format"], "living-image")

        for origin in (None, "null", "https://attacker.example"):
            with self.subTest(origin=origin):
                rejected_headers = {
                    "Content-Type": "image/png",
                    "X-Living-Image-Filename": "portrait.png",
                }
                if origin is not None:
                    rejected_headers["Origin"] = origin
                status, _, body = self.request("POST", "/api/compile", payload, rejected_headers)
                self.assertEqual(status, HTTPStatus.FORBIDDEN)
                self.assertEqual(json.loads(body)["message"], "Cross-origin compilation is disabled")

    def test_disabled_invalid_filename_media_and_methods_fail_closed(self) -> None:
        payload = png_header()
        headers = {"Content-Type": "image/png", "Origin": self.origin}

        self.server.compiler_enabled = False
        status, _, body = self.request("POST", "/api/compile", payload, headers)
        self.assertEqual(status, HTTPStatus.SERVICE_UNAVAILABLE)
        self.assertIn("not enabled", json.loads(body)["message"])
        self.server.compiler_enabled = True

        status, _, _ = self.request(
            "POST",
            "/api/compile",
            payload,
            {**headers, "X-Living-Image-Filename": "x" * 513},
        )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        status, _, _ = self.request(
            "POST",
            "/api/compile",
            b"gif",
            {"Content-Type": "image/gif", "Origin": self.origin},
        )
        self.assertEqual(status, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        status, _, _ = self.request("PUT", "/api/compile", b"")
        self.assertEqual(status, HTTPStatus.METHOD_NOT_ALLOWED)

        self.server.compile_lock.acquire()
        try:
            status, response_headers, body = self.request("POST", "/api/compile", payload, headers)
        finally:
            self.server.compile_lock.release()
        self.assertEqual(status, HTTPStatus.TOO_MANY_REQUESTS)
        self.assertEqual(response_headers["Retry-After"], "10")
        self.assertIn("busy", json.loads(body)["message"])

    def test_static_allow_root_rejects_traversal_dotfiles_symlinks_and_api_fallback(self) -> None:
        for path in (
            "/../outside.txt",
            "/%2e%2e/outside.txt",
            "/.secret",
            "/outside-link.txt",
            "/api/missing",
            "/Dockerfile",
        ):
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertEqual(status, HTTPStatus.NOT_FOUND)
                self.assertNotIn(b"must not be served", body)

    def test_origin_configuration_is_canonical_and_does_not_trust_forwarded_headers(self) -> None:
        self.assertEqual(normalize_public_origin("HTTPS://Example.COM:443/"), "https://example.com")
        self.assertTrue(request_matches_origin("https://example.com", "example.com", "https://example.com"))
        self.assertFalse(request_matches_origin("https://example.com", "attacker.example", "https://example.com"))
        for invalid in (
            "example.com",
            "https://user@example.com",
            "https://example.com/path",
            "https://example.com:invalid",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                normalize_public_origin(invalid)

        with mock.patch.dict(os.environ, {"SPACE_HOST": "owner-space.hf.space"}, clear=True):
            self.assertEqual(public_origin_from_environment(), "https://owner-space.hf.space")


if __name__ == "__main__":
    unittest.main()
