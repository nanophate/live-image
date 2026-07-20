"""Shared validation and single-process compilation service.

The local Studio and hosted container API deliberately have different HTTP
surfaces. Only the image validation and compile operation are shared here.
"""

from __future__ import annotations

from dataclasses import dataclass
from http import HTTPStatus
import json
from pathlib import Path
import re
import struct
import tempfile
from typing import Any, BinaryIO, Callable
from urllib.parse import unquote

from compiler.compile_character import (
    DetectorRuntime,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
    compile_paths,
    load_detector_runtime,
)


MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_MEDIA_TYPES = {"image/png": ".png", "image/jpeg": ".jpg"}


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


def read_upload_payload(stream: BinaryIO, length: int) -> bytes:
    payload = stream.read(length)
    if len(payload) != length:
        raise UploadError(HTTPStatus.BAD_REQUEST, "The upload ended before its declared length")
    return payload


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


class CompilerService:
    """Lazy serial compiler that reuses one loaded detector runtime."""

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

    @property
    def loaded(self) -> bool:
        return self._runtime is not None

    def load(self) -> DetectorRuntime:
        if self._runtime is None:
            self._runtime = self._runtime_loader(self.offline, self.flip_test)
        return self._runtime

    def model_digests(self) -> dict[str, str]:
        return dict(self.load().digests)

    def compile(self, payload: bytes, filename: str, media_type: str) -> CompileResponse:
        safe_name = safe_upload_name(filename, media_type)
        validate_image_payload(payload, media_type)
        runtime = self.load()
        with tempfile.TemporaryDirectory(prefix="living-image-compile-") as temporary:
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
                runtime,
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
