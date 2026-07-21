#!/usr/bin/env python3
"""Profile the exact detector and compiler stages without changing artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from time import perf_counter
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--iterations", type=int, default=2)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--flip-test", action="store_true")
    parser.add_argument("--torch-threads", type=int)
    parser.add_argument("--torch-interop-threads", type=int)
    parser.add_argument("--opencv-threads", type=int)
    return parser.parse_args()


def elapsed(start: float) -> float:
    return round(perf_counter() - start, 6)


def main() -> int:
    args = parse_args()
    if args.iterations < 1:
        raise SystemExit("--iterations must be at least 1")
    if args.torch_threads is not None and args.torch_threads < 1:
        raise SystemExit("--torch-threads must be at least 1")
    if args.opencv_threads is not None and args.opencv_threads < 1:
        raise SystemExit("--opencv-threads must be at least 1")
    if args.torch_interop_threads is not None and args.torch_interop_threads < 1:
        raise SystemExit("--torch-interop-threads must be at least 1")
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if args.torch_threads is not None:
        os.environ["LIVING_IMAGE_TORCH_THREADS"] = str(args.torch_threads)
    if args.torch_interop_threads is not None:
        os.environ["LIVING_IMAGE_TORCH_INTEROP_THREADS"] = str(args.torch_interop_threads)

    import cv2
    import torch

    from compiler import __version__
    from compiler.compile_character import (
        MAX_IMAGE_DIMENSION,
        MAX_IMAGE_PIXELS,
        build_manifest,
        load_detector_runtime,
    )

    if args.opencv_threads is not None:
        cv2.setNumThreads(args.opencv_threads)

    load_start = perf_counter()
    runtime = load_detector_runtime(args.offline, args.flip_test)
    load_seconds = elapsed(load_start)
    detector = runtime.detector
    detect_faces = getattr(detector, "_detect_faces", None)
    if not callable(detect_faces):
        raise RuntimeError("anime-face-detector 0.1.0 profiling hook is unavailable")

    input_bytes = args.input.read_bytes()
    input_sha256 = hashlib.sha256(input_bytes).hexdigest()
    iterations: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="living-image-profile-") as temporary:
        output_root = Path(temporary)
        for index in range(args.iterations):
            total_start = perf_counter()

            stage_start = perf_counter()
            image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
            decode_seconds = elapsed(stage_start)
            if image is None:
                raise ValueError(f"could not decode image: {args.input.name}")
            image_height, image_width = image.shape[:2]
            if (
                image_width > MAX_IMAGE_DIMENSION
                or image_height > MAX_IMAGE_DIMENSION
                or image_width * image_height > MAX_IMAGE_PIXELS
            ):
                raise ValueError(f"image dimensions exceed the portable runtime limit: {image_width}x{image_height}")

            stage_start = perf_counter()
            boxes = detect_faces(image)
            face_seconds = elapsed(stage_start)

            stage_start = perf_counter()
            predictions = detector(image, boxes=boxes) if boxes else []
            landmark_seconds = elapsed(stage_start)

            stage_start = perf_counter()
            if predictions:
                manifest = build_manifest(args.input, image, predictions, runtime.digests)
                result: dict[str, Any] = {
                    "status": manifest["quality"]["status"],
                    "disabledCapabilities": manifest["quality"].get("disabledCapabilities", []),
                }
            else:
                manifest = {
                    "status": "reject",
                    "rejectionReasons": ["no near-frontal anime face detected"],
                }
                result = {"status": "reject", "disabledCapabilities": []}
            manifest_seconds = elapsed(stage_start)

            stage_start = perf_counter()
            payload = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
            output_path = output_root / f"iteration-{index + 1}.json"
            output_path.write_bytes(payload)
            serialization_seconds = elapsed(stage_start)

            result.update(
                {
                    "iteration": index + 1,
                    "seconds": {
                        "decode": decode_seconds,
                        "faceDetection": face_seconds,
                        "landmarkDetection": landmark_seconds,
                        "manifestBuild": manifest_seconds,
                        "serializationWrite": serialization_seconds,
                        "total": elapsed(total_start),
                    },
                    "outputBytes": len(payload),
                    "outputSha256": hashlib.sha256(payload).hexdigest(),
                }
            )
            iterations.append(result)

    report = {
        "profile": "living-image-compiler-stage-timing-v1",
        "compilerVersion": __version__,
        "input": {
            "name": args.input.name,
            "bytes": len(input_bytes),
            "sha256": input_sha256,
        },
        "configuration": {
            "offline": args.offline,
            "flipTest": args.flip_test,
            "osCpuCount": os.cpu_count(),
            "affinityCpuCount": len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
            "torchThreads": torch.get_num_threads(),
            "torchInteropThreads": torch.get_num_interop_threads(),
            "opencvThreads": cv2.getNumThreads(),
        },
        "modelLoadSeconds": load_seconds,
        "modelSha256": runtime.digests,
        "iterations": iterations,
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
