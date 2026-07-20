#!/usr/bin/env python3
"""Compile a near-frontal anime portrait into a portable `.limg` manifest.

The primary path uses real anime-face-detector output. All coordinates needed by
the runtime are recorded in the output; the browser player has no image-specific
constants or fixture-name branches.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.metadata
import json
import math
import mimetypes
import os
from pathlib import Path
from typing import Any, Iterable, Sequence

import cv2
import numpy as np
from anime_face_detector import create_detector, get_checkpoint_path

from compiler import __version__


Point = tuple[float, float]
EYE_GROUPS = {
    "left": (11, 12, 13, 16, 15, 14),
    "right": (17, 18, 19, 22, 21, 20),
}
MOUTH_GROUP = (24, 25, 26, 27)

# Quality policy v2. The reject thresholds below describe inputs for which the
# near-frontal rig cannot be built safely. These higher thresholds only gate the
# eye controls that depend on precise local pixels and geometry.
MIN_FULL_PUPIL_CONFIDENCE = 0.60
MIN_FULL_EYE_CONFIDENCE = 0.70
MIN_FULL_EYE_SYMMETRY = 0.70
MIN_FULL_IMAGE_DIMENSION = 256


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalise_point(point: Sequence[float], width: int, height: int) -> dict[str, float]:
    return {"x": float(point[0]) / width, "y": float(point[1]) / height}


def normalise_box(box: Sequence[float], width: int, height: int) -> dict[str, float]:
    x0, y0, x1, y1 = (float(v) for v in box[:4])
    normalised_x0 = clamp(x0 / width, 0.0, 1.0)
    normalised_y0 = clamp(y0 / height, 0.0, 1.0)
    normalised_x1 = clamp(x1 / width, 0.0, 1.0)
    normalised_y1 = clamp(y1 / height, 0.0, 1.0)
    return {
        "x": normalised_x0,
        "y": normalised_y0,
        "width": max(0.0, normalised_x1 - normalised_x0),
        "height": max(0.0, normalised_y1 - normalised_y0),
    }


def _rect_from_points(
    points: np.ndarray,
    image_width: int,
    image_height: int,
    pad_x: float,
    pad_y: float,
) -> tuple[int, int, int, int]:
    min_xy = points.min(axis=0)
    max_xy = points.max(axis=0)
    feature_width = max(2.0, float(max_xy[0] - min_xy[0]))
    feature_height = max(2.0, float(max_xy[1] - min_xy[1]))
    x0 = max(0, int(math.floor(min_xy[0] - feature_width * pad_x)))
    y0 = max(0, int(math.floor(min_xy[1] - feature_height * pad_y)))
    x1 = min(image_width - 1, int(math.ceil(max_xy[0] + feature_width * pad_x)))
    y1 = min(image_height - 1, int(math.ceil(max_xy[1] + feature_height * pad_y)))
    return x0, y0, x1, y1


def detect_pupil(image: np.ndarray, polygon: np.ndarray) -> dict[str, float | Point]:
    """Find a conservative pupil/iris centre from local appearance.

    Anime pupils are not always the darkest component: eyelashes can be darker,
    while coloured irises can carry stronger saturation. We therefore combine
    grayscale darkness and saturation with an inner-ellipse and centre prior.
    The result is only a candidate; confidence controls the allowed gaze range.
    """

    height, width = image.shape[:2]
    x0, y0, x1, y1 = _rect_from_points(polygon, width, height, 0.02, 0.02)
    crop = image[y0 : y1 + 1, x0 : x1 + 1]
    local_polygon = np.rint(polygon - np.array([x0, y0])).astype(np.int32)
    polygon_mask = np.zeros(crop.shape[:2], dtype=np.uint8)
    cv2.fillPoly(polygon_mask, [local_polygon], 255)

    crop_height, crop_width = crop.shape[:2]
    yy, xx = np.mgrid[0:crop_height, 0:crop_width]
    centre_x = float(polygon[:, 0].mean() - x0)
    centre_y = float(polygon[:, 1].mean() - y0)
    radius_x = max(2.0, crop_width * 0.36)
    radius_y = max(2.0, crop_height * 0.42)
    ellipse = ((xx - centre_x) / radius_x) ** 2 + ((yy - centre_y) / radius_y) ** 2 <= 1.0
    valid = (polygon_mask > 0) & ellipse

    if int(valid.sum()) < 12:
        return {"point": (centre_x + x0, centre_y + y0), "confidence": 0.0, "contrast": 0.0}

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    saturation = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)[:, :, 1].astype(np.float32)
    darkness = 255.0 - gray
    sigma_x = max(2.0, crop_width * 0.26)
    sigma_y = max(2.0, crop_height * 0.32)
    prior = np.exp(-0.5 * (((xx - centre_x) / sigma_x) ** 2 + ((yy - centre_y) / sigma_y) ** 2))
    score = (darkness + 0.28 * saturation) * (0.35 + 0.65 * prior)
    values = score[valid]
    threshold = float(np.quantile(values, 0.82))
    candidates = valid & (score >= threshold)
    weights = np.where(candidates, np.maximum(score - threshold + 1.0, 0.0), 0.0)

    total = float(weights.sum())
    if total <= 0:
        pupil_x, pupil_y = centre_x, centre_y
    else:
        pupil_x = float((weights * xx).sum() / total)
        pupil_y = float((weights * yy).sum() / total)

    median = float(np.median(values))
    high = float(np.quantile(values, 0.95))
    contrast = max(0.0, high - median)
    distance = math.sqrt(
        ((pupil_x - centre_x) / max(1.0, crop_width * 0.32)) ** 2
        + ((pupil_y - centre_y) / max(1.0, crop_height * 0.38)) ** 2
    )
    confidence = clamp((contrast / 80.0) * (1.0 - 0.35 * clamp(distance, 0.0, 1.5)), 0.0, 1.0)
    return {
        "point": (pupil_x + x0, pupil_y + y0),
        "confidence": confidence,
        "contrast": contrast,
    }


def compile_eye(
    side: str,
    image: np.ndarray,
    keypoints: np.ndarray,
    image_width: int,
    image_height: int,
    face_width: float,
) -> dict[str, Any]:
    indices = EYE_GROUPS[side]
    raw = keypoints[list(indices)]
    polygon = raw[:, :2]
    x0, y0, x1, y1 = _rect_from_points(polygon, image_width, image_height, 0.22, 0.85)
    eye_left = float(polygon[:, 0].min())
    eye_right = float(polygon[:, 0].max())
    eye_top = float(polygon[:, 1].min())
    eye_bottom = float(polygon[:, 1].max())
    eye_width = eye_right - eye_left
    eye_height = eye_bottom - eye_top
    pupil = detect_pupil(image, polygon)

    landmark_confidence = clamp(float(raw[:, 2].mean()), 0.0, 1.0)
    width_score = clamp((eye_width / max(1.0, face_width) - 0.06) / 0.12, 0.0, 1.0)
    aspect = eye_height / max(1.0, eye_width)
    aspect_score = 1.0 - clamp(abs(aspect - 0.38) / 0.34, 0.0, 1.0)
    geometry_confidence = clamp(0.55 * width_score + 0.45 * aspect_score, 0.0, 1.0)
    pupil_confidence = float(pupil["confidence"])
    confidence = clamp(
        0.55 * landmark_confidence + 0.25 * geometry_confidence + 0.20 * pupil_confidence,
        0.0,
        1.0,
    )

    gaze_scale = 0.35 + 0.65 * pupil_confidence
    return {
        "side": side,
        "landmarkIndices": list(indices),
        "landmarks": [normalise_point(point, image_width, image_height) for point in polygon],
        "region": normalise_box((x0, y0, x1, y1), image_width, image_height),
        "anchors": {
            "left": eye_left / image_width,
            "right": eye_right / image_width,
            "top": eye_top / image_height,
            "bottom": eye_bottom / image_height,
            "centreY": ((eye_top + eye_bottom) * 0.5) / image_height,
        },
        "pupil": {
            **normalise_point(pupil["point"], image_width, image_height),
            "radius": max(2.0, min(eye_width, eye_height) * 0.17) / min(image_width, image_height),
            "confidence": pupil_confidence,
            "contrast": float(pupil["contrast"]),
            "method": "local-darkness-saturation-centre-prior-v1",
        },
        "rig": {
            "maxGazeX": (eye_width * 0.075 * gaze_scale) / image_width,
            "maxGazeY": (eye_height * 0.075 * gaze_scale) / image_height,
            "blinkFloor": max(0.8, eye_height * 0.035) / image_height,
        },
        "confidence": confidence,
        "landmarkConfidence": landmark_confidence,
        "geometryConfidence": geometry_confidence,
    }


def _dark_colour(image: np.ndarray, box: tuple[int, int, int, int]) -> str:
    x0, y0, x1, y1 = box
    crop = image[y0 : y1 + 1, x0 : x1 + 1]
    if crop.size == 0:
        return "#351b24"
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # The mouth line occupies only a small fraction of the padded patch. Using
    # a broad quantile averages it back into skin colour and creates a pasted-on
    # peach interior, so sample only the darkest four percent.
    threshold = np.quantile(gray, 0.04)
    selected = crop[gray <= threshold]
    if len(selected) == 0:
        selected = crop.reshape(-1, 3)
    b, g, r = np.median(selected, axis=0).astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def compile_mouth(
    image: np.ndarray,
    keypoints: np.ndarray,
    image_width: int,
    image_height: int,
    face_box: Sequence[float],
) -> dict[str, Any]:
    raw = keypoints[list(MOUTH_GROUP)]
    points = raw[:, :2]
    face_height = float(face_box[3] - face_box[1])
    left = float(points[:, 0].min())
    right = float(points[:, 0].max())
    centre_x = float(np.median(points[:, 0]))
    centre_y = float(np.median(points[:, 1]))
    mouth_width = max(2.0, right - left)
    half_region_height = max(5.0, face_height * 0.047)
    x0 = max(0, int(math.floor(left - mouth_width * 0.20)))
    x1 = min(image_width - 1, int(math.ceil(right + mouth_width * 0.20)))
    y0 = max(0, int(math.floor(centre_y - half_region_height)))
    y1 = min(image_height - 1, int(math.ceil(centre_y + half_region_height)))
    landmark_confidence = clamp(float(raw[:, 2].mean()), 0.0, 1.0)
    width_score = clamp((mouth_width / max(1.0, float(face_box[2] - face_box[0])) - 0.08) / 0.18, 0.0, 1.0)
    confidence = clamp(0.75 * landmark_confidence + 0.25 * width_score, 0.0, 1.0)
    max_open = clamp(face_height * 0.020, 3.0, 13.0)
    return {
        "landmarkIndices": list(MOUTH_GROUP),
        "landmarks": [normalise_point(point, image_width, image_height) for point in points],
        "region": normalise_box((x0, y0, x1, y1), image_width, image_height),
        "anchors": {
            "left": left / image_width,
            "right": right / image_width,
            "centreX": centre_x / image_width,
            "centreY": centre_y / image_height,
        },
        "rig": {"maxOpen": max_open / image_height, "interiorColour": _dark_colour(image, (x0, y0, x1, y1))},
        "confidence": confidence,
        "landmarkConfidence": landmark_confidence,
    }


def assess_quality(
    face_box: Sequence[float],
    keypoints: np.ndarray,
    eyes: Sequence[dict[str, Any]],
    mouth: dict[str, Any],
    image_width: int,
    image_height: int,
    detection_count: int,
) -> dict[str, Any]:
    warnings: list[str] = []
    reasons: list[str] = []
    disabled: list[str] = []
    face_score = clamp(float(face_box[4]), 0.0, 1.0)
    landmark_score = clamp(float(keypoints[:, 2].mean()), 0.0, 1.0)
    face_width = float(face_box[2] - face_box[0])
    face_height = float(face_box[3] - face_box[1])
    face_scale = min(face_width / image_width, face_height / image_height)
    min_image_dimension = min(image_width, image_height)
    eye_confidence = min(float(eye["confidence"]) for eye in eyes)
    mouth_confidence = float(mouth["confidence"])

    eye_widths = [float(eye["anchors"]["right"] - eye["anchors"]["left"]) for eye in eyes]
    eye_symmetry = min(eye_widths) / max(1e-6, max(eye_widths))
    pupil_confidence = min(float(eye["pupil"]["confidence"]) for eye in eyes)

    if detection_count > 1:
        warnings.append(f"{detection_count} faces detected; the strongest face was selected")
    if face_score < 0.70:
        reasons.append("face detector confidence below 0.70")
    if landmark_score < 0.62:
        reasons.append("mean landmark confidence below 0.62")
    if face_scale < 0.22:
        reasons.append("face is too small for stable local deformation")
    if eye_symmetry < 0.48:
        reasons.append("eye geometry is too asymmetric for the near-frontal MVP")
    elif eye_symmetry < MIN_FULL_EYE_SYMMETRY:
        disabled.append("blink")
        warnings.append(
            f"blink disabled because eye symmetry is below {MIN_FULL_EYE_SYMMETRY:.2f}"
        )
    if eye_confidence < 0.48:
        reasons.append("one or both eye regions are unreliable")
    elif eye_confidence < MIN_FULL_EYE_CONFIDENCE:
        disabled.extend(("blink", "gaze"))
        warnings.append(
            f"blink and gaze disabled because eye confidence is below {MIN_FULL_EYE_CONFIDENCE:.2f}"
        )
    if mouth_confidence < 0.48:
        disabled.append("mouth")
        warnings.append("mouth control disabled because its region is unreliable")
    if pupil_confidence < MIN_FULL_PUPIL_CONFIDENCE:
        disabled.append("gaze")
        warnings.append(
            f"gaze disabled because pupil confidence is below {MIN_FULL_PUPIL_CONFIDENCE:.2f}"
        )
    if min_image_dimension < MIN_FULL_IMAGE_DIMENSION:
        disabled.extend(("blink", "gaze"))
        warnings.append(
            "blink and gaze disabled because the image shortest side is "
            f"below {MIN_FULL_IMAGE_DIMENSION} pixels"
        )

    score = clamp(
        0.25 * face_score
        + 0.25 * landmark_score
        + 0.22 * eye_confidence
        + 0.13 * mouth_confidence
        + 0.10 * eye_symmetry
        + 0.05 * clamp(face_scale / 0.45, 0.0, 1.0),
        0.0,
        1.0,
    )
    if reasons:
        status = "reject"
        disabled = ["blink", "gaze", "mouth"]
    elif disabled or warnings:
        status = "limited"
    else:
        status = "full"
    return {
        "status": status,
        "score": score,
        "disabledCapabilities": sorted(set(disabled)),
        "warnings": warnings,
        "rejectionReasons": reasons,
        "metrics": {
            "faceScore": face_score,
            "meanLandmarkScore": landmark_score,
            "eyeConfidence": eye_confidence,
            "mouthConfidence": mouth_confidence,
            "pupilConfidence": pupil_confidence,
            "eyeSymmetry": eye_symmetry,
            "faceScale": face_scale,
            "minImageDimensionPixels": min_image_dimension,
        },
    }


def _image_data(path: Path) -> tuple[str, str]:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return mime, f"data:{mime};base64,{encoded}"


def build_manifest(
    image_path: Path,
    image: np.ndarray,
    predictions: Sequence[dict[str, np.ndarray]],
    detector_digests: dict[str, str],
) -> dict[str, Any]:
    if not predictions:
        raise ValueError("no near-frontal anime face detected")

    prediction = max(predictions, key=lambda item: float(item["bbox"][4]))
    face_box = prediction["bbox"]
    keypoints = prediction["keypoints"]
    image_height, image_width = image.shape[:2]
    face_width = float(face_box[2] - face_box[0])
    eyes = [
        compile_eye(side, image, keypoints, image_width, image_height, face_width)
        for side in ("left", "right")
    ]
    mouth = compile_mouth(image, keypoints, image_width, image_height, face_box)
    quality = assess_quality(
        face_box,
        keypoints,
        eyes,
        mouth,
        image_width,
        image_height,
        len(predictions),
    )
    mime, data_url = _image_data(image_path)

    return {
        "format": "living-image",
        "version": 1,
        "id": image_path.stem,
        "compiler": {
            "name": "living-image-compiler",
            "version": __version__,
            "detector": "hysts/anime-face-detector",
            "detectorVersion": importlib.metadata.version("anime-face-detector"),
            "faceModel": "hysts/anime-face-detector-yolov3",
            "landmarkModel": "hysts/anime-face-detector-hrnetv2",
            "modelSha256": detector_digests,
        },
        "image": {
            "mimeType": mime,
            "width": image_width,
            "height": image_height,
            "sha256": sha256_file(image_path),
            "dataUrl": data_url,
        },
        "analysis": {
            "face": {
                "bbox": normalise_box(face_box, image_width, image_height),
                "score": float(face_box[4]),
            },
            "landmarks": [
                {**normalise_point(point, image_width, image_height), "score": float(point[2])}
                for point in keypoints
            ],
            "features": {"eyes": eyes, "mouth": mouth},
        },
        "rig": {
            "controls": {
                "blinkLeft": {"min": 0.0, "max": 1.0},
                "blinkRight": {"min": 0.0, "max": 1.0},
                "gazeX": {"min": -1.0, "max": 1.0},
                "gazeY": {"min": -1.0, "max": 1.0},
                "mouthOpen": {"min": 0.0, "max": 1.0},
                "breath": {"min": -1.0, "max": 1.0},
            },
            "breath": {
                "pivotY": clamp((float(face_box[3]) + 0.10 * image_height) / image_height, 0.55, 0.82),
                "maxScaleY": clamp(0.005 + 0.004 * quality["score"], 0.004, 0.010),
                "maxLift": 1.5 / image_height,
            },
        },
        "behavior": {
            "seed": int(image_path.stat().st_size % 2_147_483_647),
            "blink": {"interval": 3.4, "jitter": 1.35, "duration": 0.16},
            "breath": {"period": 4.8},
            "smoothing": {"gaze": 12.0, "mouth": 18.0},
        },
        "quality": quality,
        "provenance": {
            "sourceFile": image_path.name,
            "sourceSha256": sha256_file(image_path),
            "detectorCodeLicense": "MIT with Apache-2.0 vendored portions",
            "detectorWeightLicense": "MIT (per upstream model cards; training-data provenance not warranted)",
            "generatedAt": "reproducible-build-does-not-store-wall-clock",
        },
    }


def draw_overlay(image: np.ndarray, manifest: dict[str, Any]) -> np.ndarray:
    overlay = image.copy()
    height, width = overlay.shape[:2]

    def px(point: dict[str, float]) -> tuple[int, int]:
        return int(round(point["x"] * width)), int(round(point["y"] * height))

    face = manifest["analysis"]["face"]["bbox"]
    x0 = int(face["x"] * width)
    y0 = int(face["y"] * height)
    x1 = int((face["x"] + face["width"]) * width)
    y1 = int((face["y"] + face["height"]) * height)
    cv2.rectangle(overlay, (x0, y0), (x1, y1), (70, 220, 70), 2)

    group_colours = {
        **{index: (255, 190, 50) for index in range(0, 11)},
        **{index: (20, 220, 255) for index in range(11, 23)},
        **{index: (255, 90, 220) for index in range(23, 28)},
    }
    for index, point in enumerate(manifest["analysis"]["landmarks"]):
        position = px(point)
        colour = group_colours[index]
        cv2.circle(overlay, position, 4, colour, -1, cv2.LINE_AA)
        cv2.putText(overlay, str(index), (position[0] + 5, position[1] - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.38, colour, 1, cv2.LINE_AA)

    for eye in manifest["analysis"]["features"]["eyes"]:
        polygon = np.array([px(point) for point in eye["landmarks"]], dtype=np.int32)
        cv2.polylines(overlay, [polygon], True, (40, 255, 255), 2, cv2.LINE_AA)
        pupil = px(eye["pupil"])
        cv2.circle(overlay, pupil, 6, (30, 30, 255), 2, cv2.LINE_AA)
        region = eye["region"]
        rx0, ry0 = int(region["x"] * width), int(region["y"] * height)
        rx1 = int((region["x"] + region["width"]) * width)
        ry1 = int((region["y"] + region["height"]) * height)
        cv2.rectangle(overlay, (rx0, ry0), (rx1, ry1), (255, 160, 20), 1)

    mouth = manifest["analysis"]["features"]["mouth"]
    region = mouth["region"]
    mx0, my0 = int(region["x"] * width), int(region["y"] * height)
    mx1 = int((region["x"] + region["width"]) * width)
    my1 = int((region["y"] + region["height"]) * height)
    cv2.rectangle(overlay, (mx0, my0), (mx1, my1), (255, 80, 210), 2)

    quality = manifest["quality"]
    label = f"{quality['status']}  {quality['score']:.3f}"
    cv2.rectangle(overlay, (12, 12), (270, 54), (25, 25, 25), -1)
    cv2.putText(overlay, label, (24, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (240, 240, 240), 2, cv2.LINE_AA)
    return overlay


def compile_paths(
    input_paths: Iterable[Path],
    output_dir: Path,
    overlay_dir: Path | None,
    offline: bool,
    flip_test: bool,
) -> list[tuple[Path, dict[str, Any]]]:
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    output_dir.mkdir(parents=True, exist_ok=True)
    if overlay_dir:
        overlay_dir.mkdir(parents=True, exist_ok=True)

    detector = create_detector("yolov3", device="cpu", flip_test=flip_test)
    model_paths = {name: get_checkpoint_path(name) for name in ("yolov3", "hrnetv2")}
    digests = {name: sha256_file(path) for name, path in model_paths.items()}
    results: list[tuple[Path, dict[str, Any]]] = []

    for input_path in input_paths:
        image = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"could not decode image: {input_path}")
        predictions = detector(image)
        if not predictions:
            diagnostic = {
                "input": input_path.name,
                "status": "reject",
                "rejectionReasons": ["no near-frontal anime face detected"],
                "detector": "hysts/anime-face-detector@0.1.0",
                "compilerVersion": __version__,
            }
            diagnostic_path = output_dir / f"{input_path.stem}.diagnostic.json"
            diagnostic_path.write_text(json.dumps(diagnostic, indent=2), encoding="utf-8")
            results.append((diagnostic_path, diagnostic))
            continue

        manifest = build_manifest(input_path, image, predictions, digests)
        output_path = output_dir / f"{input_path.stem}.limg"
        output_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
        if overlay_dir:
            overlay = draw_overlay(image, manifest)
            cv2.imwrite(str(overlay_dir / f"{input_path.stem}.png"), overlay)
        results.append((output_path, manifest))
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path, help="input PNG/JPEG portraits")
    parser.add_argument("--output-dir", type=Path, default=Path("fixtures/compiled"))
    parser.add_argument("--overlay-dir", type=Path, default=Path("fixtures/overlays"))
    parser.add_argument("--offline", action="store_true", help="require cached model weights")
    parser.add_argument("--flip-test", action="store_true", help="slower HRNet horizontal flip ensemble")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    results = compile_paths(args.inputs, args.output_dir, args.overlay_dir, args.offline, args.flip_test)
    rejected = False
    for output_path, result in results:
        quality = result.get("quality", result)
        status = quality.get("status", "unknown")
        score = quality.get("score")
        score_text = f" score={score:.3f}" if isinstance(score, (float, int)) else ""
        print(f"{output_path}: {status}{score_text}")
        rejected = rejected or status == "reject"
    return 2 if rejected else 0


if __name__ == "__main__":
    raise SystemExit(main())
