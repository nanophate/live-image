#!/usr/bin/env python3
"""Minimal HTTP API for a private container behind an edge gateway."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import re
import signal
import traceback
from types import FrameType
from urllib.parse import urlparse

from compiler import __version__
from compiler.compiler_service import CompilerService, UploadError, read_upload_payload, validate_upload


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,96}$")


def interrupt_on_termination(_signum: int, _frame: FrameType | None) -> None:
    """Let active request contexts unwind before PID 1 exits."""

    raise KeyboardInterrupt


class ContainerServer(HTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        *,
        compiler: CompilerService,
    ) -> None:
        super().__init__(address, handler)
        self.compiler = compiler


class ContainerHandler(BaseHTTPRequestHandler):
    """Expose only compiler and health routes; static files are edge assets."""

    server: ContainerServer

    def request_id(self) -> str | None:
        value = self.headers.get("X-Request-Id")
        return value if value and REQUEST_ID_PATTERN.fullmatch(value) else None

    def send_payload(
        self,
        status: HTTPStatus,
        payload: bytes,
        *,
        media_type: str = "application/json",
        filename: str | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", f"{media_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        request_id = self.request_id()
        if request_id:
            self.send_header("X-Request-Id", request_id)
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, status: HTTPStatus, body: dict[str, object]) -> None:
        self.send_payload(status, json.dumps(body, separators=(",", ":")).encode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/ping":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if path == "/healthz":
            ready = self.server.compiler.loaded
            self.send_json(
                HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "status": "ready" if ready else "starting",
                    "ready": ready,
                    "compilerVersion": __version__,
                },
            )
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "Unknown compiler endpoint"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/compile":
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "Unknown compiler endpoint"})
            return
        media_type = self.headers.get_content_type()
        try:
            length = validate_upload(self.headers.get("Content-Length"), media_type)
            filename = self.headers.get("X-Living-Image-Filename", "portrait.png")
            response = self.server.compiler.compile(read_upload_payload(self.rfile, length), filename, media_type)
        except UploadError as error:
            self.send_json(error.status, {"status": "error", "message": str(error)})
            return
        except Exception:
            self.log_error("compiler request failed; traceback follows")
            traceback.print_exc()
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"status": "error", "message": "Compilation failed", "requestId": self.request_id() or ""},
            )
            return
        self.send_payload(
            response.status,
            response.body,
            media_type=response.media_type,
            filename=response.filename,
        )

    def do_PUT(self) -> None:
        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"status": "error", "message": "Method not allowed"})

    do_DELETE = do_PUT
    do_PATCH = do_PUT


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    parser.add_argument("--offline", action="store_true", help="require weights to exist in the image cache")
    parser.add_argument("--flip-test", action="store_true", help="slower horizontal flip ensemble")
    parser.add_argument("--eager-load", action="store_true", help="load and verify detector weights before listening")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    compiler = CompilerService(offline=args.offline, flip_test=args.flip_test)
    if args.eager_load:
        compiler.load()
    server = ContainerServer((args.host, args.port), ContainerHandler, compiler=compiler)
    signal.signal(signal.SIGTERM, interrupt_on_termination)
    print(f"Living Image compiler API listening on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
