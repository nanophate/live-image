#!/usr/bin/env python3
"""Serve the public hosted Viewer and Compiler from one trusted origin."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import signal
import threading
from types import FrameType
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from compiler import __version__
from compiler.compiler_service import CompilerService, UploadError, read_upload_payload, validate_upload


MAX_FILENAME_HEADER_LENGTH = 512
UPLOAD_READ_TIMEOUT_SECONDS = 30


def interrupt_on_termination(_signum: int, _frame: FrameType | None) -> None:
    """Let active temporary compilation contexts unwind before PID 1 exits."""

    raise KeyboardInterrupt


def normalize_public_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("PUBLIC_ORIGIN must contain only an http(s) origin")
    hostname = parsed.hostname.rstrip(".").lower()
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("PUBLIC_ORIGIN contains an invalid port") from error
    default_port = 80 if parsed.scheme == "http" else 443
    port_suffix = f":{port}" if port is not None and port != default_port else ""
    return f"{parsed.scheme}://{hostname}{port_suffix}"


def public_origin_from_environment() -> str | None:
    configured = os.environ.get("PUBLIC_ORIGIN")
    if configured:
        return normalize_public_origin(configured)
    space_host = os.environ.get("SPACE_HOST")
    if not space_host:
        return None
    if any(character in space_host for character in "/:@?#\\"):
        raise ValueError("SPACE_HOST must be a hostname")
    return normalize_public_origin(f"https://{space_host}")


def request_matches_origin(origin: str | None, host: str | None, expected_origin: str) -> bool:
    if origin is None or host is None:
        return False
    try:
        actual_origin = normalize_public_origin(origin)
        host_origin = normalize_public_origin(f"{urlsplit(expected_origin).scheme}://{host}")
    except ValueError:
        return False
    return actual_origin == expected_origin and host_origin == expected_origin


class HostedServer(ThreadingHTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        *,
        compiler: CompilerService,
        web_root: Path,
        public_origin: str | None,
        compiler_enabled: bool,
    ) -> None:
        super().__init__(address, handler)
        self.compiler = compiler
        self.web_root = web_root.resolve(strict=True)
        self.public_origin = public_origin
        self.compiler_enabled = compiler_enabled and public_origin is not None
        self.compile_lock = threading.Lock()
        self.daemon_threads = True


class HostedHandler(BaseHTTPRequestHandler):
    """Expose an allow-root static site and a same-origin compilation API."""

    server: HostedServer
    server_version = "LivingImage"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(UPLOAD_READ_TIMEOUT_SECONDS)

    def request_id(self) -> str:
        value = getattr(self, "_request_id", None)
        if value is None:
            value = str(uuid4())
            self._request_id = value
        return value

    def send_payload(
        self,
        status: HTTPStatus,
        payload: bytes,
        *,
        media_type: str,
        cache_control: str = "no-store",
        filename: str | None = None,
        include_request_id: bool = False,
        send_body: bool = True,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if include_request_id:
            self.send_header("X-Request-Id", self.request_id())
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if send_body:
            self.wfile.write(payload)

    def send_json(
        self,
        status: HTTPStatus,
        body: dict[str, object],
        *,
        request_id: bool = True,
        send_body: bool = True,
    ) -> None:
        self.send_payload(
            status,
            json.dumps(body, separators=(",", ":")).encode("utf-8"),
            media_type="application/json; charset=utf-8",
            include_request_id=request_id,
            send_body=send_body,
        )

    def static_path(self) -> Path | None:
        decoded = unquote(urlsplit(self.path).path)
        if decoded == "/":
            decoded = "/index.html"
        if not decoded.startswith("/") or decoded.endswith("/") or "\\" in decoded or "\x00" in decoded:
            return None
        relative = PurePosixPath(decoded.removeprefix("/"))
        if not relative.parts or any(part in {"", ".", ".."} or part.startswith(".") for part in relative.parts):
            return None
        candidate = self.server.web_root
        for part in relative.parts:
            candidate = candidate / part
            if candidate.is_symlink():
                return None
        try:
            resolved = candidate.resolve(strict=True)
        except (FileNotFoundError, OSError):
            return None
        if not resolved.is_relative_to(self.server.web_root) or not resolved.is_file():
            return None
        return resolved

    def send_static(self, *, send_body: bool = True) -> None:
        path = self.static_path()
        if path is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "Not found"})
            return
        payload = path.read_bytes()
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if media_type.startswith("text/") or media_type in {"application/javascript", "application/json"}:
            media_type += "; charset=utf-8"
        relative = path.relative_to(self.server.web_root)
        cache_control = "public, max-age=31536000, immutable" if relative.parts[0] == "assets" else "no-cache"
        self.send_payload(
            HTTPStatus.OK,
            payload,
            media_type=media_type,
            cache_control=cache_control,
            send_body=send_body,
            extra_headers={
                "Content-Security-Policy": (
                    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                    "connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; "
                    "base-uri 'none'; form-action 'none'"
                ),
            },
        )

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/ping":
            self.send_json(HTTPStatus.OK, {"status": "ok"}, request_id=False)
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
                request_id=False,
            )
            return
        if path == "/api/config":
            self.send_json(
                HTTPStatus.OK,
                {
                    "compiler": "hosted",
                    "enabled": self.server.compiler_enabled,
                    "authentication": "platform",
                    "samplesAvailable": False,
                    "provider": "hugging-face",
                },
                request_id=False,
            )
            return
        if path.startswith("/api/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "Unknown hosted endpoint"})
            return
        self.send_static()

    def do_HEAD(self) -> None:
        if urlsplit(self.path).path.startswith("/api/"):
            self.send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {"status": "error", "message": "Method not allowed"},
                send_body=False,
            )
            return
        self.send_static(send_body=False)

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/compile":
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "Unknown hosted endpoint"})
            return
        if not self.server.compiler_enabled or self.server.public_origin is None:
            self.send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"status": "error", "message": "Hosted compilation is not enabled for this deployment"},
            )
            return
        if not request_matches_origin(
            self.headers.get("Origin"),
            self.headers.get("Host"),
            self.server.public_origin,
        ):
            self.send_json(
                HTTPStatus.FORBIDDEN,
                {"status": "error", "message": "Cross-origin compilation is disabled"},
            )
            return
        filename = self.headers.get("X-Living-Image-Filename", "portrait.png")
        if (
            not filename
            or len(filename) > MAX_FILENAME_HEADER_LENGTH
            or any(ord(character) < 32 or ord(character) == 127 for character in filename)
        ):
            self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "The upload filename is invalid"})
            return
        media_type = self.headers.get_content_type()
        try:
            length = validate_upload(self.headers.get("Content-Length"), media_type)
        except UploadError as error:
            self.send_json(error.status, {"status": "error", "message": str(error)})
            return
        if not self.server.compile_lock.acquire(blocking=False):
            self.send_payload(
                HTTPStatus.TOO_MANY_REQUESTS,
                json.dumps(
                    {"status": "error", "message": "The hosted compiler is busy; try again shortly"},
                    separators=(",", ":"),
                ).encode("utf-8"),
                media_type="application/json; charset=utf-8",
                include_request_id=True,
                extra_headers={"Retry-After": "10"},
            )
            return
        try:
            try:
                response = self.server.compiler.compile(
                    read_upload_payload(self.rfile, length),
                    filename,
                    media_type,
                )
            except UploadError as error:
                self.send_json(error.status, {"status": "error", "message": str(error)})
                return
            except TimeoutError:
                self.send_json(
                    HTTPStatus.REQUEST_TIMEOUT,
                    {"status": "error", "message": "The upload timed out"},
                )
                return
            except Exception:
                print(f"Hosted compilation failed: request {self.request_id()}", flush=True)
                self.send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"status": "error", "message": "Compilation failed", "requestId": self.request_id()},
                )
                return
        finally:
            self.server.compile_lock.release()
        self.send_payload(
            response.status,
            response.body,
            media_type=f"{response.media_type}; charset=utf-8",
            filename=response.filename,
            include_request_id=True,
        )

    def method_not_allowed(self) -> None:
        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"status": "error", "message": "Method not allowed"})

    do_DELETE = method_not_allowed
    do_OPTIONS = method_not_allowed
    do_PATCH = method_not_allowed
    do_PUT = method_not_allowed

    def log_message(self, _format: str, *_args: object) -> None:
        """Do not copy client IPs or request metadata into application logs."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("dist"), help="built web root")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    parser.add_argument("--offline", action="store_true", help="require weights to exist in the image cache")
    parser.add_argument("--flip-test", action="store_true", help="slower horizontal flip ensemble")
    parser.add_argument("--eager-load", action="store_true", help="load and verify detector weights before listening")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    if not (root / "compiler.html").is_file() or not (root / "viewer.html").is_file():
        raise SystemExit(f"built Compiler/Viewer not found under {root}")
    try:
        public_origin = public_origin_from_environment()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    requested_enabled = os.environ.get("HOSTED_COMPILER_ENABLED", "false").lower() == "true"
    if requested_enabled and public_origin is None:
        raise SystemExit("HOSTED_COMPILER_ENABLED requires PUBLIC_ORIGIN or the Hugging Face SPACE_HOST")
    compiler = CompilerService(offline=args.offline, flip_test=args.flip_test)
    if args.eager_load:
        compiler.load()
    server = HostedServer(
        (args.host, args.port),
        HostedHandler,
        compiler=compiler,
        web_root=root,
        public_origin=public_origin,
        compiler_enabled=requested_enabled,
    )
    signal.signal(signal.SIGTERM, interrupt_on_termination)
    print(f"Living Image hosted Compiler/Viewer listening on {args.host}:{args.port}", flush=True)
    print(f"Hosted compiler enabled: {server.compiler_enabled}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
