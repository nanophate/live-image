#!/usr/bin/env python3
"""Measure deterministic local-warp support descriptors without gating output.

This probe consumes compiler artifacts so every measurement is tied to the
actual automatically detected face and feature regions. It is deliberately
report-only: no value in this module changes ``quality.status`` or enables a
runtime capability.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np

from compiler import __version__ as compiler_version
from compiler.validate_suite import ValidationCase, load_manifest


PROBE_NAME = "living-image-support-domain-probe"
PROBE_VERSION = "1.0.0"
FACE_SIZE = 256
ALPHA_COMPOSITE_BACKGROUND = 255
GAUSSIAN_KERNEL = 5
GAUSSIAN_SIGMA = 1.0
GAUSSIAN_BORDER = cv2.BORDER_REFLECT_101
CANNY_LOW = 80
CANNY_HIGH = 160
CANNY_APERTURE = 3
CANNY_L2_GRADIENT = True
EDGE_SUPPORT_DISTANCE = 3.0
DISTANCE_TRANSFORM_MASK = 3
BOUNDARY_BAND = 3
BILATERAL_DIAMETER = 7
BILATERAL_SIGMA_COLOUR = 24.0
BILATERAL_SIGMA_SPACE = 5.0
BILATERAL_BORDER = cv2.BORDER_REFLECT_101
RESIDUAL_QUANTILE = 0.95
CONNECTED_COMPONENT_CONNECTIVITY = 8
MIN_EDGE_COMPONENT_PIXELS = 3
CROSSING_CLOSE_KERNEL = 3
CROSSING_CLOSE_ITERATIONS = 1
IRIS_CORE_EROSION_KERNEL = 3
MASK_BORDER = cv2.BORDER_CONSTANT
EVIDENCE_STATUSES = (
    "quality-calibration-feasibility",
    "contaminated-exploratory-replay",
)


class SupportProbeError(ValueError):
    """Raised when a source or compiler artifact cannot be probed safely."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_bgr(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SupportProbeError(f"could not decode source image: {path.name}")
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.shape[2] == 3:
        return image
    if image.shape[2] != 4:
        raise SupportProbeError(f"unsupported source channel count: {image.shape[2]}")

    colour = image[:, :, :3].astype(np.float32)
    alpha = image[:, :, 3:4].astype(np.float32) / 255.0
    # Transparent fixture pixels are composited on white so an arbitrary RGB
    # payload under alpha=0 cannot become a false high-frequency descriptor.
    return np.rint(
        colour * alpha + ALPHA_COMPOSITE_BACKGROUND * (1.0 - alpha)
    ).astype(np.uint8)


def _require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SupportProbeError(f"{label} must be an object")
    return value


def _require_sequence(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise SupportProbeError(f"{label} must be an array")
    return value


def _finite_float(
    value: Any,
    label: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    strict_minimum: bool = False,
) -> float:
    if isinstance(value, bool):
        raise SupportProbeError(f"{label} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise SupportProbeError(f"{label} must be a finite number") from error
    if not math.isfinite(number):
        raise SupportProbeError(f"{label} must be a finite number")
    if minimum is not None and (
        number <= minimum if strict_minimum else number < minimum
    ):
        operator = "greater than" if strict_minimum else "at least"
        raise SupportProbeError(f"{label} must be {operator} {minimum}")
    if maximum is not None and number > maximum:
        raise SupportProbeError(f"{label} must be at most {maximum}")
    return number


def _face_box_pixels(
    bbox: dict[str, Any], image_width: int, image_height: int
) -> tuple[int, int, int, int]:
    try:
        normalised_x = float(bbox["x"])
        normalised_y = float(bbox["y"])
        normalised_width = float(bbox["width"])
        normalised_height = float(bbox["height"])
    except (KeyError, TypeError, ValueError) as error:
        raise SupportProbeError("analysis.face.bbox is invalid") from error
    values = (normalised_x, normalised_y, normalised_width, normalised_height)
    if not all(math.isfinite(value) for value in values):
        raise SupportProbeError("analysis.face.bbox is not finite")
    if (
        normalised_x < 0.0
        or normalised_y < 0.0
        or normalised_width <= 0.0
        or normalised_height <= 0.0
        or normalised_x + normalised_width > 1.0 + 1e-9
        or normalised_y + normalised_height > 1.0 + 1e-9
    ):
        raise SupportProbeError("analysis.face.bbox is outside the source image")
    x0 = int(math.floor(normalised_x * image_width))
    y0 = int(math.floor(normalised_y * image_height))
    x1 = int(math.ceil((normalised_x + normalised_width) * image_width))
    y1 = int(math.ceil((normalised_y + normalised_height) * image_height))
    x0 = max(0, min(image_width - 1, x0))
    y0 = max(0, min(image_height - 1, y0))
    x1 = max(x0 + 1, min(image_width, x1))
    y1 = max(y0 + 1, min(image_height, y1))
    return x0, y0, x1, y1


def _point_on_face(
    point: dict[str, Any],
    face_box: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> tuple[float, float]:
    x0, y0, x1, y1 = face_box
    try:
        normalised_x = float(point["x"])
        normalised_y = float(point["y"])
    except (KeyError, TypeError, ValueError) as error:
        raise SupportProbeError("feature point is invalid") from error
    if (
        not math.isfinite(normalised_x)
        or not math.isfinite(normalised_y)
        or not 0.0 <= normalised_x <= 1.0
        or not 0.0 <= normalised_y <= 1.0
    ):
        raise SupportProbeError("feature point is outside the source image")
    source_x = normalised_x * image_width
    source_y = normalised_y * image_height
    return (
        (source_x - x0) * FACE_SIZE / max(1, x1 - x0),
        (source_y - y0) * FACE_SIZE / max(1, y1 - y0),
    )


def _polygon_mask(points: Sequence[tuple[float, float]]) -> np.ndarray:
    mask = np.zeros((FACE_SIZE, FACE_SIZE), dtype=np.uint8)
    polygon = np.rint(np.asarray(points, dtype=np.float32)).astype(np.int32)
    if len(polygon) >= 3:
        cv2.fillPoly(mask, [polygon], 255)
    return mask


def _region_mask(
    region: dict[str, Any],
    face_box: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> np.ndarray:
    try:
        normalised_x = float(region["x"])
        normalised_y = float(region["y"])
        normalised_width = float(region["width"])
        normalised_height = float(region["height"])
        corners = (
            {"x": normalised_x, "y": normalised_y},
            {
                "x": normalised_x + normalised_width,
                "y": normalised_y + normalised_height,
            },
        )
    except (KeyError, TypeError, ValueError) as error:
        raise SupportProbeError("feature region is invalid") from error
    values = (normalised_x, normalised_y, normalised_width, normalised_height)
    if (
        not all(math.isfinite(value) for value in values)
        or normalised_x < 0.0
        or normalised_y < 0.0
        or normalised_width <= 0.0
        or normalised_height <= 0.0
        or normalised_x + normalised_width > 1.0 + 1e-9
        or normalised_y + normalised_height > 1.0 + 1e-9
    ):
        raise SupportProbeError("feature region is outside the source image")
    first = _point_on_face(corners[0], face_box, image_width, image_height)
    second = _point_on_face(corners[1], face_box, image_width, image_height)
    left = max(0, min(FACE_SIZE - 1, int(math.floor(min(first[0], second[0])))))
    top = max(0, min(FACE_SIZE - 1, int(math.floor(min(first[1], second[1])))))
    right = max(left + 1, min(FACE_SIZE, int(math.ceil(max(first[0], second[0])))))
    bottom = max(top + 1, min(FACE_SIZE, int(math.ceil(max(first[1], second[1])))))
    mask = np.zeros((FACE_SIZE, FACE_SIZE), dtype=np.uint8)
    mask[top:bottom, left:right] = 255
    return mask


def _density(edges: np.ndarray, mask: np.ndarray) -> float:
    selected = mask > 0
    count = int(np.count_nonzero(selected))
    return float(np.count_nonzero((edges > 0) & selected) / count) if count else 0.0


def _boundary_metrics(edges: np.ndarray, region_mask: np.ndarray) -> dict[str, float]:
    kernel_size = BOUNDARY_BAND * 2 + 1
    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
    eroded = cv2.erode(
        region_mask, kernel, iterations=1, borderType=MASK_BORDER, borderValue=0
    )
    dilated = cv2.dilate(
        region_mask, kernel, iterations=1, borderType=MASK_BORDER, borderValue=0
    )
    inside = cv2.subtract(region_mask, eroded)
    outside = cv2.subtract(dilated, region_mask)
    inside_density = _density(edges, inside)
    outside_density = _density(edges, outside)
    return {
        "insideEdgeDensity": inside_density,
        "outsideEdgeDensity": outside_density,
        "absoluteDensityJump": abs(inside_density - outside_density),
    }


def _feature_edge_support(
    distance: np.ndarray,
    points: Sequence[tuple[float, float]],
) -> dict[str, Any]:
    distances: list[float] = []
    for x, y in points:
        sample_x = max(0, min(FACE_SIZE - 1, int(round(x))))
        sample_y = max(0, min(FACE_SIZE - 1, int(round(y))))
        distances.append(float(distance[sample_y, sample_x]))
    if not distances:
        return {"sampleCount": 0, "supportedFraction": 0.0, "medianDistancePixels": 0.0}
    return {
        "sampleCount": len(distances),
        "supportedFraction": float(
            sum(value <= EDGE_SUPPORT_DISTANCE for value in distances) / len(distances)
        ),
        "medianDistancePixels": float(np.median(np.asarray(distances))),
    }


def _residual_metrics(residual: np.ndarray, mask: np.ndarray | None = None) -> dict[str, float]:
    values = residual[mask > 0] if mask is not None else residual.reshape(-1)
    if values.size == 0:
        return {"mean": 0.0, "p95": 0.0}
    return {
        "mean": float(np.mean(values)),
        "p95": float(np.quantile(values, RESIDUAL_QUANTILE)),
    }


def _component_metrics(edges: np.ndarray) -> tuple[dict[str, float | int], np.ndarray, np.ndarray]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        (edges > 0).astype(np.uint8), connectivity=CONNECTED_COMPONENT_CONNECTIVITY
    )
    sizes = [
        int(stats[index, cv2.CC_STAT_AREA])
        for index in range(1, count)
        if int(stats[index, cv2.CC_STAT_AREA]) >= MIN_EDGE_COMPONENT_PIXELS
    ]
    face_pixels = FACE_SIZE * FACE_SIZE
    metrics: dict[str, float | int] = {
        "componentCount": len(sizes),
        "componentsPer10kPixels": float(len(sizes) * 10_000 / face_pixels),
        "medianComponentPixels": float(np.median(sizes)) if sizes else 0.0,
        "largestComponentFraction": float(max(sizes) / face_pixels) if sizes else 0.0,
    }
    return metrics, labels, stats


def _crossing_components(edges: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    # Canny intentionally thins and may split a physical stroke at a crossing.
    # A fixed small close reconnects only immediate gaps before testing whether
    # one stroke spans the iris core and the outside of the detected eyelid.
    closed = cv2.morphologyEx(
        edges,
        cv2.MORPH_CLOSE,
        np.ones((CROSSING_CLOSE_KERNEL, CROSSING_CLOSE_KERNEL), dtype=np.uint8),
        iterations=CROSSING_CLOSE_ITERATIONS,
        borderType=MASK_BORDER,
        borderValue=0,
    )
    _, labels, stats, _ = cv2.connectedComponentsWithStats(
        (closed > 0).astype(np.uint8),
        connectivity=CONNECTED_COMPONENT_CONNECTIVITY,
    )
    return labels, stats


def _iris_connected_edge_metrics(
    eye: dict[str, Any],
    labels: np.ndarray,
    stats: np.ndarray,
    face_box: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> dict[str, Any]:
    rig = eye.get("rig")
    deformation = rig.get("deformation") if isinstance(rig, dict) else None
    iris = deformation.get("iris") if isinstance(deformation, dict) else None
    if not isinstance(iris, dict):
        return {
            "available": False,
            "connectedComponentCount": 0,
            "largestConnectedComponentPixels": 0,
        }

    landmarks = _require_sequence(eye.get("landmarks"), "eye.landmarks")
    eye_points = [
        _point_on_face(_require_mapping(point, "eye landmark"), face_box, image_width, image_height)
        for point in landmarks
    ]
    eye_mask = _polygon_mask(eye_points)
    centre = _point_on_face(
        _require_mapping(iris.get("centre"), "eye iris centre"),
        face_box,
        image_width,
        image_height,
    )
    x0, y0, x1, y1 = face_box
    radius_x = _finite_float(
        iris.get("radiusX"), "eye iris radiusX", minimum=0.0, strict_minimum=True
    ) * image_width * FACE_SIZE / max(1, x1 - x0)
    radius_y = _finite_float(
        iris.get("radiusY"), "eye iris radiusY", minimum=0.0, strict_minimum=True
    ) * image_height * FACE_SIZE / max(1, y1 - y0)
    iris_mask = np.zeros((FACE_SIZE, FACE_SIZE), dtype=np.uint8)
    cv2.ellipse(
        iris_mask,
        (int(round(centre[0])), int(round(centre[1]))),
        (max(1, int(round(radius_x))), max(1, int(round(radius_y)))),
        0,
        0,
        360,
        255,
        -1,
    )
    iris_core = cv2.erode(
        iris_mask,
        np.ones((IRIS_CORE_EROSION_KERNEL, IRIS_CORE_EROSION_KERNEL), dtype=np.uint8),
        iterations=1,
        borderType=MASK_BORDER,
        borderValue=0,
    )
    eye_height = max(point[1] for point in eye_points) - min(point[1] for point in eye_points)
    minimum_length = max(6, int(math.ceil(0.5 * eye_height)))
    crossing_sizes: list[int] = []
    label_count = int(stats.shape[0])
    for label in range(1, label_count):
        size = int(stats[label, cv2.CC_STAT_AREA])
        if size < minimum_length:
            continue
        component = labels == label
        core_pixels = int(np.count_nonzero(component & (iris_core > 0)))
        outside_eye_pixels = int(np.count_nonzero(component & (eye_mask == 0)))
        if core_pixels >= 3 and outside_eye_pixels > 0:
            crossing_sizes.append(size)
    return {
        "available": True,
        "minimumComponentPixels": minimum_length,
        "connectedComponentCount": len(crossing_sizes),
        "largestConnectedComponentPixels": max(crossing_sizes, default=0),
    }


def _eye_geometry(
    eye: dict[str, Any], image_width: int, image_height: int
) -> dict[str, Any]:
    landmarks = _require_sequence(eye.get("landmarks"), "eye.landmarks")
    points = [_require_mapping(point, "eye landmark") for point in landmarks]
    xs = [float(point["x"]) * image_width for point in points]
    ys = [float(point["y"]) * image_height for point in points]
    rig = eye.get("rig")
    deformation = rig.get("deformation") if isinstance(rig, dict) else None
    iris = deformation.get("iris") if isinstance(deformation, dict) else None
    safe_gaze_x = _finite_float(
        rig.get("maxGazeX", 0.0) if isinstance(rig, dict) else 0.0,
        "eye rig maxGazeX",
        minimum=0.0,
    )
    safe_gaze_y = _finite_float(
        rig.get("maxGazeY", 0.0) if isinstance(rig, dict) else 0.0,
        "eye rig maxGazeY",
        minimum=0.0,
    )
    result: dict[str, Any] = {
        "side": eye.get("side", "unknown"),
        "widthPixels": max(xs) - min(xs),
        "heightPixels": max(ys) - min(ys),
        "safeGazeXPixels": safe_gaze_x * image_width,
        "safeGazeYPixels": safe_gaze_y * image_height,
        "irisAvailable": isinstance(iris, dict),
    }
    if isinstance(iris, dict):
        radius_x = _finite_float(
            iris.get("radiusX"),
            "eye iris radiusX",
            minimum=0.0,
            strict_minimum=True,
        )
        radius_y = _finite_float(
            iris.get("radiusY"),
            "eye iris radiusY",
            minimum=0.0,
            strict_minimum=True,
        )
        centre = _require_mapping(iris.get("centre"), "eye iris centre")
        centre_x = _finite_float(centre.get("x"), "eye iris centre.x", minimum=0.0, maximum=1.0)
        centre_y = _finite_float(centre.get("y"), "eye iris centre.y", minimum=0.0, maximum=1.0)
        if (
            centre_x - radius_x < 0.0
            or centre_x + radius_x > 1.0
            or centre_y - radius_y < 0.0
            or centre_y + radius_y > 1.0
        ):
            raise SupportProbeError("eye iris ellipse is outside the source image")
        result["irisRadiusXPixels"] = radius_x * image_width
        result["irisRadiusYPixels"] = radius_y * image_height
        result["compilerIrisGeometricEligibilityScore"] = _finite_float(
            iris.get("segmentationConfidence", 0.0),
            "eye iris geometric eligibility score",
            minimum=0.0,
            maximum=1.0,
        )
    return result


def compute_support_descriptors(image: np.ndarray, artifact: dict[str, Any]) -> dict[str, Any]:
    """Compute report-only descriptors from one source and compiled artifact."""

    if image.ndim != 3 or image.shape[2] != 3:
        raise SupportProbeError("source image must be BGR")
    image_height, image_width = image.shape[:2]
    analysis = _require_mapping(artifact.get("analysis"), "analysis")
    face = _require_mapping(analysis.get("face"), "analysis.face")
    face_box = _face_box_pixels(
        _require_mapping(face.get("bbox"), "analysis.face.bbox"),
        image_width,
        image_height,
    )
    x0, y0, x1, y1 = face_box
    face_crop = image[y0:y1, x0:x1]
    shrinking = max(face_crop.shape[:2]) > FACE_SIZE
    interpolation = cv2.INTER_AREA if shrinking else cv2.INTER_LINEAR
    resized = cv2.resize(face_crop, (FACE_SIZE, FACE_SIZE), interpolation=interpolation)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(
        gray,
        (GAUSSIAN_KERNEL, GAUSSIAN_KERNEL),
        GAUSSIAN_SIGMA,
        borderType=GAUSSIAN_BORDER,
    )
    edges = cv2.Canny(
        blurred,
        CANNY_LOW,
        CANNY_HIGH,
        apertureSize=CANNY_APERTURE,
        L2gradient=CANNY_L2_GRADIENT,
    )
    distance = cv2.distanceTransform(
        (edges == 0).astype(np.uint8),
        cv2.DIST_L2,
        DISTANCE_TRANSFORM_MASK,
    )
    smoothed = cv2.bilateralFilter(
        gray,
        BILATERAL_DIAMETER,
        BILATERAL_SIGMA_COLOUR,
        BILATERAL_SIGMA_SPACE,
        borderType=BILATERAL_BORDER,
    )
    residual = cv2.absdiff(gray, smoothed).astype(np.float32) / 255.0
    components, _, _ = _component_metrics(edges)
    crossing_labels, crossing_stats = _crossing_components(edges)

    features = _require_mapping(analysis.get("features"), "analysis.features")
    eyes = [
        _require_mapping(eye, "analysis.features.eyes item")
        for eye in _require_sequence(features.get("eyes"), "analysis.features.eyes")
    ]
    mouth = _require_mapping(features.get("mouth"), "analysis.features.mouth")
    named_features = [(str(eye.get("side", "eye")), eye) for eye in eyes]
    named_features.append(("mouth", mouth))

    edge_support: dict[str, Any] = {}
    boundary: dict[str, Any] = {}
    local_residual: dict[str, Any] = {}
    for name, feature in named_features:
        landmark_values = _require_sequence(feature.get("landmarks"), f"{name}.landmarks")
        points = [
            _point_on_face(
                _require_mapping(point, f"{name} landmark"),
                face_box,
                image_width,
                image_height,
            )
            for point in landmark_values
        ]
        edge_support[name] = _feature_edge_support(distance, points)
        mask = _region_mask(
            _require_mapping(feature.get("region"), f"{name}.region"),
            face_box,
            image_width,
            image_height,
        )
        boundary[name] = _boundary_metrics(edges, mask)
        local_residual[name] = _residual_metrics(residual, mask)

    quality = _require_mapping(artifact.get("quality"), "quality")
    geometry = _require_mapping(quality.get("metrics"), "quality.metrics")
    numeric_geometry: dict[str, float] = {}
    for key, value in geometry.items():
        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(float(value))
        ):
            output_key = (
                "compilerIrisGeometricEligibilityScore"
                if key == "irisSegmentationConfidence"
                else key
            )
            numeric_geometry[output_key] = float(value)

    descriptors = {
        "faceResizeInterpolation": "INTER_AREA" if shrinking else "INTER_LINEAR",
        "featureLandmarkEdgeSupport": edge_support,
        "patchBoundaryEdgeDensityJump": boundary,
        "bilateralAbsoluteResidual": {
            "face": _residual_metrics(residual),
            "features": local_residual,
        },
        "strongEdgeComponents": components,
        "irisConnectedEdgeGraph": {
            str(eye.get("side", f"eye-{index}")): _iris_connected_edge_metrics(
                eye,
                crossing_labels,
                crossing_stats,
                face_box,
                image_width,
                image_height,
            )
            for index, eye in enumerate(eyes)
        },
        "effectiveEyeGeometry": [
            _eye_geometry(eye, image_width, image_height) for eye in eyes
        ],
        "compilerGeometry": numeric_geometry,
    }
    try:
        json.dumps(descriptors, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise SupportProbeError("descriptor output is not finite JSON") from error
    return descriptors


def _read_artifact(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SupportProbeError(f"could not read artifact: {path.name}") from error
    return _require_mapping(document, "artifact")


def _case_artifact_path(case: ValidationCase, artifacts_dir: Path) -> Path:
    root = artifacts_dir.resolve()
    case_directory = artifacts_dir / case.id
    path = case_directory / f"{case.source_path.stem}.limg"
    if case_directory.is_symlink() or path.is_symlink():
        raise SupportProbeError(f"compiler artifact path is symlinked for {case.id}")
    resolved = path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise SupportProbeError(
            f"compiler artifact resolves outside the artifact root for {case.id}"
        ) from error
    if not resolved.is_file():
        raise SupportProbeError(f"missing compiler artifact for {case.id}")
    return resolved


def _validate_artifact_binding(
    case: ValidationCase,
    artifact: dict[str, Any],
    image: np.ndarray,
) -> None:
    if case.source_sha256 is None:
        raise SupportProbeError(f"source SHA-256 is not pinned for {case.id}")
    if artifact.get("format") != "living-image" or artifact.get("version") != 1:
        raise SupportProbeError(f"unsupported compiler artifact format for {case.id}")
    if artifact.get("id") != case.source_path.stem:
        raise SupportProbeError(f"compiler artifact id does not match source for {case.id}")

    compiler = _require_mapping(artifact.get("compiler"), "compiler")
    if compiler.get("version") != compiler_version:
        raise SupportProbeError(
            f"compiler artifact version does not match probe for {case.id}"
        )
    image_record = _require_mapping(artifact.get("image"), "image")
    provenance = _require_mapping(artifact.get("provenance"), "provenance")
    for label, value in (
        ("image.sha256", image_record.get("sha256")),
        ("provenance.sourceSha256", provenance.get("sourceSha256")),
    ):
        if value != case.source_sha256:
            raise SupportProbeError(f"{label} does not match source for {case.id}")
    image_height, image_width = image.shape[:2]
    if image_record.get("width") != image_width or image_record.get("height") != image_height:
        raise SupportProbeError(f"compiler artifact dimensions do not match source for {case.id}")


def probe_manifest(
    manifest_path: Path,
    artifacts_dir: Path,
    *,
    evidence_status: str = "quality-calibration-feasibility",
) -> dict[str, Any]:
    if evidence_status not in EVIDENCE_STATUSES:
        raise SupportProbeError("invalid evidence status")
    cases = load_manifest(manifest_path)
    results: list[dict[str, Any]] = []
    for case in cases:
        result: dict[str, Any] = {
            "id": case.id,
            "category": case.category,
            "source": case.source,
            "sourceSha256": _sha256_file(case.source_path),
            "expected": case.expected,
        }
        try:
            artifact_path = _case_artifact_path(case, artifacts_dir)
            artifact = _read_artifact(artifact_path)
            image = _load_bgr(case.source_path)
            _validate_artifact_binding(case, artifact, image)
            quality = _require_mapping(artifact.get("quality"), "quality")
            result["compilerStatus"] = quality.get("status")
            result["artifactSha256"] = _sha256_file(artifact_path)
            result["descriptors"] = compute_support_descriptors(image, artifact)
        except Exception as error:
            message = str(error)
            for root in (manifest_path.parent.resolve(), artifacts_dir.resolve()):
                message = message.replace(str(root), ".")
            result["error"] = message
        results.append(result)

    error_count = sum("error" in result for result in results)
    return {
        "version": 1,
        "probe": {
            "name": PROBE_NAME,
            "version": PROBE_VERSION,
            "compilerVersion": compiler_version,
            "parameters": {
                "faceSize": FACE_SIZE,
                "faceBoxRule": "floor-min-ceil-max-strict-normalized-bounds",
                "featureRegionRule": "axis-aligned-strict-normalized-bounds",
                "resizeRule": "INTER_AREA-when-shrinking-otherwise-INTER_LINEAR",
                "colourConversion": "BGR-to-gray-COLOR_BGR2GRAY",
                "alphaCompositeBackgroundBgr": [
                    ALPHA_COMPOSITE_BACKGROUND,
                    ALPHA_COMPOSITE_BACKGROUND,
                    ALPHA_COMPOSITE_BACKGROUND,
                ],
                "gaussianKernel": GAUSSIAN_KERNEL,
                "gaussianSigma": GAUSSIAN_SIGMA,
                "gaussianBorder": "BORDER_REFLECT_101",
                "cannyLow": CANNY_LOW,
                "cannyHigh": CANNY_HIGH,
                "cannyAperture": CANNY_APERTURE,
                "cannyL2Gradient": CANNY_L2_GRADIENT,
                "edgeSupportDistance": EDGE_SUPPORT_DISTANCE,
                "distanceTransform": "DIST_L2",
                "distanceTransformMask": DISTANCE_TRANSFORM_MASK,
                "boundaryBand": BOUNDARY_BAND,
                "bilateralDiameter": BILATERAL_DIAMETER,
                "bilateralSigmaColour": BILATERAL_SIGMA_COLOUR,
                "bilateralSigmaSpace": BILATERAL_SIGMA_SPACE,
                "bilateralBorder": "BORDER_REFLECT_101",
                "residualDefinition": "abs(gray-bilateral-gray)/255",
                "residualQuantile": RESIDUAL_QUANTILE,
                "connectedComponentConnectivity": CONNECTED_COMPONENT_CONNECTIVITY,
                "minimumEdgeComponentPixels": MIN_EDGE_COMPONENT_PIXELS,
                "crossingCloseKernel": CROSSING_CLOSE_KERNEL,
                "crossingCloseIterations": CROSSING_CLOSE_ITERATIONS,
                "irisCoreErosionKernel": IRIS_CORE_EROSION_KERNEL,
                "maskMorphologyBorder": "BORDER_CONSTANT-zero",
                "legacyFieldMapping": {
                    "quality.metrics.irisSegmentationConfidence":
                        "compilerIrisGeometricEligibilityScore"
                },
                "opencvVersion": cv2.__version__,
                "numpyVersion": np.__version__,
            },
        },
        "sourceManifest": manifest_path.name,
        "sourceManifestSha256": _sha256_file(manifest_path),
        "evidenceStatus": evidence_status,
        "summary": {
            "total": len(results),
            "measured": len(results) - error_count,
            "errors": error_count,
        },
        "cases": results,
        "generatedAt": "reproducible-probe-does-not-store-wall-clock",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        help="compiler artifact root; defaults to <manifest directory>/artifacts",
    )
    parser.add_argument(
        "--evidence-status",
        choices=EVIDENCE_STATUSES,
        required=True,
        help="explicitly labels whether the suite is calibration feasibility or contaminated replay",
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    manifest_path = args.manifest.resolve()
    artifacts_dir = (
        args.artifacts_dir.resolve()
        if args.artifacts_dir is not None
        else manifest_path.parent / "artifacts"
    )
    report = probe_manifest(
        manifest_path, artifacts_dir, evidence_status=args.evidence_status
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"{args.output}: {report['summary']['measured']}/{report['summary']['total']} "
        "cases measured"
    )
    return 1 if report["summary"]["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
