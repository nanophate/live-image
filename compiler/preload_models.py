"""Download the reviewed detector weights and fail if their digests drift."""

from __future__ import annotations

from anime_face_detector import get_checkpoint_path

from compiler.compile_character import EXPECTED_MODEL_SHA256, sha256_file


def main() -> int:
    for name, expected in EXPECTED_MODEL_SHA256.items():
        path = get_checkpoint_path(name)
        actual = sha256_file(path)
        if actual != expected:
            raise SystemExit(f"{name} weight digest mismatch: expected {expected}, got {actual}")
        print(f"{name}: {actual}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
