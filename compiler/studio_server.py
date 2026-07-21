#!/usr/bin/env python3
"""Serve the local product Studio and compile one uploaded image at a time."""

from __future__ import annotations

import argparse
from functools import partial
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
from pathlib import Path
import traceback
from typing import Any
from urllib.parse import urlparse

from compiler.compiler_service import (
    CompilerService,
    UploadError,
    read_upload_payload,
    validate_upload,
)


SAMPLE_FILES = {"teal-librarian.limg", "copper-courier.limg"}


def is_local_host(value: str | None) -> bool:
    host = (value or "").lower()
    hostname = host.rsplit(":", 1)[0] if ":" in host else host
    return hostname in {"127.0.0.1", "localhost"}


class StudioServer(HTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        handler: Any,
        *,
        compiler: CompilerService,
        samples: Path,
    ) -> None:
        super().__init__(address, handler)
        self.compiler = compiler
        self.samples = samples


class StudioHandler(SimpleHTTPRequestHandler):
    server: StudioServer

    def require_local_host(self) -> bool:
        if is_local_host(self.headers.get("Host")):
            return True
        self.send_json_error(HTTPStatus.MISDIRECTED_REQUEST, "Living Image Studio accepts localhost requests only")
        return False

    def send_json_error(self, status: HTTPStatus, message: str) -> None:
        payload = json.dumps({"status": "error", "message": message}, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        if not self.require_local_host():
            return
        if urlparse(self.path).path != "/api/compile":
            self.send_json_error(HTTPStatus.NOT_FOUND, "Unknown local Studio endpoint")
            return
        media_type = self.headers.get_content_type()
        try:
            length = validate_upload(self.headers.get("Content-Length"), media_type)
            filename = self.headers.get("X-Living-Image-Filename", "portrait.png")
            response = self.server.compiler.compile(read_upload_payload(self.rfile, length), filename, media_type)
        except UploadError as error:
            self.send_json_error(error.status, str(error))
            return
        except Exception:
            self.log_error("compiler request failed; traceback follows")
            traceback.print_exc()
            self.send_json_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Local compilation failed; check the Studio terminal")
            return
        self.send_response(response.status)
        self.send_header("Content-Type", f"{response.media_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(response.body)))
        self.send_header("Content-Disposition", f'attachment; filename="{response.filename}"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response.body)

    def do_GET(self) -> None:
        if not self.require_local_host():
            return
        path = urlparse(self.path).path
        if path == "/api/config":
            payload = json.dumps(
                {
                    "compiler": "local",
                    "enabled": True,
                    "samplesAvailable": all(
                        (self.server.samples / name).is_file()
                        for name in SAMPLE_FILES
                    ),
                },
                separators=(",", ":"),
            ).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        if path.startswith("/fixtures/compiled/"):
            name = path.rsplit("/", 1)[-1]
            if name not in SAMPLE_FILES:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            sample = self.server.samples / name
            if not sample.is_file():
                self.send_error(HTTPStatus.NOT_FOUND, "Run nodenv exec npm run compile:fixtures first")
                return
            payload = sample.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("dist"), help="built web root")
    parser.add_argument("--samples", type=Path, default=Path("fixtures/compiled"))
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--offline", action="store_true", help="require already-cached detector weights")
    parser.add_argument("--flip-test", action="store_true", help="slower HRNet horizontal flip ensemble")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    if not (root / "viewer.html").is_file():
        raise SystemExit(f"built Viewer not found under {root}; run nodenv exec npm run build")
    handler = partial(StudioHandler, directory=str(root))
    server = StudioServer(
        ("127.0.0.1", args.port),
        handler,
        compiler=CompilerService(offline=args.offline, flip_test=args.flip_test),
        samples=args.samples.resolve(),
    )
    print(f"Living Image Studio: http://127.0.0.1:{args.port}/viewer.html", flush=True)
    print("Images compile locally. Stop with Ctrl+C.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
