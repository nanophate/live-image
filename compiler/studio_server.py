#!/usr/bin/env python3
"""Serve the local product Studio and compile one uploaded image at a time."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from functools import partial
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
from pathlib import Path
import re
import struct
import tempfile
import traceback
from typing import Any, Callable
from urllib.parse import unquote, urlparse

from compiler.compile_character import (
    DetectorRuntime,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
    compile_paths,
    load_detector_runtime,
)


MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_MEDIA_TYPES = {"image/png": ".png", "image/jpeg": ".jpg"}
SAMPLE_FILES = {"teal-librarian.limg", "copper-courier.limg"}


class UploadError(ValueError):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class CompileResponse:
    status: HTTPStatus
    filename: str
    media_type: str
    body: bytes


def safe_upload_name(value: str, media_type: str) -> str:
    suffix = ALLOWED_MEDIA_TYPES.get(media_type)
    if suffix is None:
        raise UploadError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Choose a PNG or JPEG image")
    basename = unquote(value).replace("\\", "/").rsplit("/", 1)[-1]
    stem = Path(basename).stem
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-")[:80]
    return f"{cleaned or 'portrait'}{suffix}"


def validate_upload(length_header: str | None, media_type: str) -> int:
    if media_type not in ALLOWED_MEDIA_TYPES:
        raise UploadError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Choose a PNG or JPEG image")
    try:
        length = int(length_header or "")
    except ValueError as error:
        raise UploadError(HTTPStatus.LENGTH_REQUIRED, "A valid upload length is required") from error
    if length <= 0:
        raise UploadError(HTTPStatus.BAD_REQUEST, "The selected image is empty")
    if length > MAX_UPLOAD_BYTES:
        raise UploadError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "The selected image exceeds 20 MiB")
    return length


def _jpeg_dimensions(payload: bytes) -> tuple[int, int]:
    if not payload.startswith(b"\xff\xd8"):
        raise UploadError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "The file content is not a JPEG image")
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    index = 2
    while index < len(payload):
        while index < len(payload) and payload[index] == 0xFF:
            index += 1
        if index >= len(payload):
            break
        marker = payload[index]
        index += 1
        if marker in {0x01, *range(0xD0, 0xDA)}:
            continue
        if marker == 0xDA:
            break
        if index + 2 > len(payload):
            break
        segment_length = int.from_bytes(payload[index:index + 2], "big")
        if segment_length < 2 or index + segment_length > len(payload):
            break
        if marker in sof_markers:
            if segment_length < 7:
                break
            height = int.from_bytes(payload[index + 3:index + 5], "big")
            width = int.from_bytes(payload[index + 5:index + 7], "big")
            return width, height
        index += segment_length
    raise UploadError(HTTPStatus.BAD_REQUEST, "The JPEG header has no valid image dimensions")


def validate_image_payload(payload: bytes, media_type: str) -> tuple[int, int]:
    if media_type == "image/png":
        if (
            len(payload) < 24
            or payload[:8] != b"\x89PNG\r\n\x1a\n"
            or payload[12:16] != b"IHDR"
            or int.from_bytes(payload[8:12], "big") != 13
        ):
            raise UploadError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "The file content is not a PNG image")
        width, height = struct.unpack(">II", payload[16:24])
    elif media_type == "image/jpeg":
        width, height = _jpeg_dimensions(payload)
    else:
        raise UploadError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Choose a PNG or JPEG image")
    if width <= 0 or height <= 0:
        raise UploadError(HTTPStatus.BAD_REQUEST, "The image dimensions are invalid")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS:
        raise UploadError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            f"The image exceeds the portable runtime limit ({MAX_IMAGE_DIMENSION}px per side, {MAX_IMAGE_PIXELS} pixels)",
        )
    return width, height


def is_local_host(value: str | None) -> bool:
    host = (value or "").lower()
    hostname = host.rsplit(":", 1)[0] if ":" in host else host
    return hostname in {"127.0.0.1", "localhost"}


class CompilerService:
    """Lazy single-process compiler that reuses the loaded detector runtime."""

    def __init__(
        self,
        *,
        offline: bool,
        flip_test: bool,
        runtime_loader: Callable[[bool, bool], DetectorRuntime] = load_detector_runtime,
        compile_function: Callable[..., list[tuple[Path, dict[str, Any]]]] = compile_paths,
    ) -> None:
        self.offline = offline
        self.flip_test = flip_test
        self._runtime_loader = runtime_loader
        self._compile_function = compile_function
        self._runtime: DetectorRuntime | None = None

    def compile(self, payload: bytes, filename: str, media_type: str) -> CompileResponse:
        safe_name = safe_upload_name(filename, media_type)
        validate_image_payload(payload, media_type)
        if self._runtime is None:
            self._runtime = self._runtime_loader(self.offline, self.flip_test)
        with tempfile.TemporaryDirectory(prefix="living-image-studio-") as temporary:
            root = Path(temporary)
            source = root / safe_name
            output = root / "output"
            source.write_bytes(payload)
            results = self._compile_function(
                [source],
                output,
                None,
                self.offline,
                self.flip_test,
                self._runtime,
            )
            if len(results) != 1:
                raise RuntimeError("compiler returned an unexpected result count")
            output_path, result = results[0]
            quality = result.get("quality", result)
            status = quality.get("status", "error")
            if status == "reject":
                diagnostic = {
                    "status": "reject",
                    "rejectionReasons": quality.get("rejectionReasons", ["image is outside the supported portrait domain"]),
                    "warnings": quality.get("warnings", []),
                }
                return CompileResponse(
                    status=HTTPStatus.UNPROCESSABLE_ENTITY,
                    filename=f"{Path(safe_name).stem}.diagnostic.json",
                    media_type="application/json",
                    body=json.dumps(diagnostic, separators=(",", ":")).encode("utf-8"),
                )
            if status not in {"full", "limited"} or output_path.suffix != ".limg":
                raise RuntimeError("compiler returned an unsupported result")
            return CompileResponse(
                status=HTTPStatus.OK,
                filename=f"{Path(safe_name).stem}.limg",
                media_type="application/json",
                body=output_path.read_bytes(),
            )


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
            response = self.server.compiler.compile(self.rfile.read(length), filename, media_type)
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
