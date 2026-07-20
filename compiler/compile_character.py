#!/usr/bin/env python3
"""Compile a near-frontal anime portrait into a portable `.limg` manifest.

The primary path uses real anime-face-detector output. All coordinates needed by
the runtime are recorded in the output; the browser player has no image-specific
constants or fixture-name branches.
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
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
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 33_554_432
EXPECTED_MODEL_SHA256 = {
    "yolov3": "23bbc708146bcbc1c910f00fe152adbc70d7658d875a0121eaf4ee61d978b2c4",
    "hrnetv2": "e71271376406a743c01528a0460637fcc06e72aeeea583f85007cc72dc8b7a4a",
}


@dataclass(frozen=True)
class DetectorRuntime:
    """Loaded detector and immutable model digests reusable across compiles."""

    detector: Any
    digests: dict[str, str]


def load_detector_runtime(offline: bool, flip_test: bool) -> DetectorRuntime:
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    detector = create_detector("yolov3", device="cpu", flip_test=flip_test)
    model_paths = {name: get_checkpoint_path(name) for name in ("yolov3", "hrnetv2")}
    digests = {name: sha256_file(path) for name, path in model_paths.items()}
    mismatches = {
        name: {"expected": EXPECTED_MODEL_SHA256[name], "actual": digest}
        for name, digest in digests.items()
        if digest != EXPECTED_MODEL_SHA256[name]
    }
    if mismatches:
        raise RuntimeError(f"detector weight digest mismatch: {mismatches}")
    return DetectorRuntime(detector=detector, digests=digests)


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


def _rgba_data_url(rgba: np.ndarray, label: str) -> str:
    """Encode one deterministic compiler-authored RGBA layer."""

    encoded, payload = cv2.imencode(".png", rgba)
    if not encoded:
        raise RuntimeError(f"could not encode {label}")
    return "data:image/png;base64," + base64.b64encode(payload.tobytes()).decode("ascii")


def _alpha_mask_data_url(mask: np.ndarray) -> str:
    """Encode one deterministic alpha mask without adding a runtime dependency."""

    rgba = np.full((*mask.shape, 4), 255, dtype=np.uint8)
    rgba[:, :, 3] = mask
    return _rgba_data_url(rgba, "protected line-art mask")


def iris_base_eye_layers(
    image: np.ndarray,
    polygon: np.ndarray,
    pupil: dict[str, float | Point],
    region: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> tuple[dict[str, Any] | None, np.ndarray | None]:
    """Extract one rigid iris/highlight texture and its inpainted base eye.

    The conservative ellipse is compiler-authored from the automatic pupil and
    eyelid landmarks. Its full source colour is retained so highlights remain
    attached to the iris instead of being rediscovered from brightness at run
    time. Unreliable or eyelid-crossing ellipses are omitted.
    """

    pupil_confidence = float(pupil["confidence"])
    if pupil_confidence < MIN_FULL_PUPIL_CONFIDENCE:
        return None, None
    point = pupil["point"]
    if not isinstance(point, tuple) or len(point) != 2:
        return None, None
    centre_x, centre_y = float(point[0]), float(point[1])
    if cv2.pointPolygonTest(polygon.astype(np.float32), (centre_x, centre_y), False) < 0:
        return None, None

    x0, y0, x1, y1 = region
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return None, None
    crop_height, crop_width = crop.shape[:2]
    eye_width = max(2.0, float(polygon[:, 0].max() - polygon[:, 0].min()))
    eye_height = max(2.0, float(polygon[:, 1].max() - polygon[:, 1].min()))
    target_radius_x = max(2, int(round(min(eye_width * 0.20, eye_height * 0.72))))
    target_radius_y = max(2, int(round(eye_height * 0.40)))
    local_centre = (int(round(centre_x - x0)), int(round(centre_y - y0)))
    # Emit the exact geometry used to rasterize the layer. Otherwise a rounded
    # PNG can pass this crop check while its unrounded manifest ellipse crosses
    # the deformation region by a subpixel and is rejected by the Viewer.
    centre_x = float(x0 + local_centre[0])
    centre_y = float(y0 + local_centre[1])
    polygon_mask = np.zeros((crop_height, crop_width), dtype=np.uint8)
    local_polygon = np.rint(polygon - np.array([x0, y0])).astype(np.int32)
    cv2.fillPoly(polygon_mask, [local_polygon], 255)
    # Never move a source-eyelid-shaped cutout with the iris. The entire
    # ellipse support must be inside the detected open-eye polygon. Adapt the
    # initial cage down slightly rather than translating a clipped source shape;
    # omit it if no cage at least 75% of the initial radii is fully contained.
    ellipse: np.ndarray | None = None
    local_radius: tuple[int, int] | None = None
    seen_radii: set[tuple[int, int]] = set()
    for scale in np.linspace(1.0, 0.75, 11):
        candidate_radius = (
            max(2, int(round(target_radius_x * float(scale)))),
            max(2, int(round(target_radius_y * float(scale)))),
        )
        if candidate_radius in seen_radii:
            continue
        seen_radii.add(candidate_radius)
        radius_x, radius_y = float(candidate_radius[0]), float(candidate_radius[1])
        if (
            centre_x - radius_x < x0
            or centre_y - radius_y < y0
            or centre_x + radius_x >= x1
            or centre_y + radius_y >= y1
        ):
            continue
        candidate = np.zeros_like(polygon_mask)
        # A hard compiler-authored alpha edge keeps containment exact; Canvas
        # performs the final subpixel sampling when the rigid layer moves.
        cv2.ellipse(candidate, local_centre, candidate_radius, 0, 0, 360, 255, -1, cv2.LINE_8)
        support = candidate > 0
        full_area = int(np.count_nonzero(support))
        if full_area >= 12 and np.all(polygon_mask[support] > 0):
            ellipse = candidate
            local_radius = candidate_radius
            break
    if ellipse is None or local_radius is None:
        return None, None
    radius_x, radius_y = float(local_radius[0]), float(local_radius[1])
    iris_mask = ellipse

    inpaint_radius = int(clamp(round(0.06 * eye_width), 2, 6))
    inpaint_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    inpaint_mask = cv2.dilate((iris_mask >= 128).astype(np.uint8) * 255, inpaint_kernel)
    base_bgr = cv2.inpaint(crop, inpaint_mask, inpaint_radius, cv2.INPAINT_TELEA)
    texture = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
    texture[:, :, 3] = iris_mask
    base_eye = cv2.cvtColor(base_bgr, cv2.COLOR_BGR2BGRA)
    base_eye[:, :, 3] = 255
    retained_scale = (radius_x * radius_y) / max(1.0, target_radius_x * target_radius_y)
    segmentation_confidence = clamp(pupil_confidence * retained_scale, 0.0, 1.0)
    return {
        "method": "ellipse-cage-telea-v1",
        "texture": {
            "dataUrl": _rgba_data_url(texture, "iris texture"),
            "width": int(crop_width),
            "height": int(crop_height),
            "coverage": float(np.count_nonzero(iris_mask) / iris_mask.size),
            "method": "source-rgba-ellipse-v1",
        },
        "baseEye": {
            "dataUrl": _rgba_data_url(base_eye, "base-eye texture"),
            "width": int(crop_width),
            "height": int(crop_height),
            "coverage": 1.0,
            "method": "telea-inpaint-v1",
        },
        "centre": normalise_point((centre_x, centre_y), image_width, image_height),
        "radiusX": radius_x / image_width,
        "radiusY": radius_y / image_height,
        "inpaintRadius": inpaint_radius,
        "segmentationConfidence": segmentation_confidence,
    }, iris_mask


def ellipse_inside_polygon(
    polygon: np.ndarray,
    centre_x: float,
    centre_y: float,
    radius_x: float,
    radius_y: float,
    shift_x: float = 0.0,
    shift_y: float = 0.0,
) -> bool:
    """Sample a rigid ellipse boundary against one detected eye polygon."""

    contour = polygon.astype(np.float32)
    for angle in np.linspace(0.0, 2.0 * np.pi, 73, endpoint=False):
        point = (
            centre_x + shift_x + radius_x * float(np.cos(angle)),
            centre_y + shift_y + radius_y * float(np.sin(angle)),
        )
        if cv2.pointPolygonTest(contour, point, False) < 0:
            return False
    return True


def safe_symmetric_ellipse_shift(
    polygon: np.ndarray,
    centre_x: float,
    centre_y: float,
    radius_x: float,
    radius_y: float,
    requested: float,
    axis: str,
) -> float:
    """Bound a rigid gaze shift so the complete ellipse stays in the eye."""

    if requested <= 0:
        return 0.0
    def contained(distance: float) -> bool:
        for direction in (-1.0, 1.0):
            shift_x = direction * distance if axis == "x" else 0.0
            shift_y = direction * distance if axis == "y" else 0.0
            if not ellipse_inside_polygon(
                polygon,
                centre_x,
                centre_y,
                radius_x,
                radius_y,
                shift_x,
                shift_y,
            ):
                return False
        return True

    if contained(requested):
        return requested
    low, high = 0.0, requested
    for _ in range(20):
        middle = (low + high) * 0.5
        if contained(middle):
            low = middle
        else:
            high = middle
    # Preserve a small subpixel margin from the sampled landmark boundary.
    return max(0.0, low - 0.25)


def safe_diagonal_ellipse_shifts(
    polygon: np.ndarray,
    centre_x: float,
    centre_y: float,
    radius_x: float,
    radius_y: float,
    max_x: float,
    max_y: float,
) -> tuple[float, float]:
    """Jointly scale gaze axes until every diagonal endpoint is contained."""

    def contained(scale: float) -> bool:
        return all(
            ellipse_inside_polygon(
                polygon,
                centre_x,
                centre_y,
                radius_x,
                radius_y,
                direction_x * max_x * scale,
                direction_y * max_y * scale,
            )
            for direction_x in (-1.0, 1.0)
            for direction_y in (-1.0, 1.0)
        )

    if contained(1.0):
        return max_x, max_y
    low, high = 0.0, 1.0
    for _ in range(20):
        middle = (low + high) * 0.5
        if contained(middle):
            low = middle
        else:
            high = middle
    scale = max(0.0, low - 0.01)
    return max_x * scale, max_y * scale


def protected_line_art_mask(
    image: np.ndarray,
    polygon: np.ndarray,
    region: tuple[int, int, int, int],
    excluded_iris_mask: np.ndarray | None = None,
) -> tuple[dict[str, Any], np.ndarray]:
    """Protect strong unrelated strokes while leaving the eyelid corridor movable.

    The mask is generated once by the compiler. White alpha restores original
    pixels after the local warp; transparent pixels allow the intended eyelid
    deformation to remain visible.
    """

    x0, y0, x1, y1 = region
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        raise ValueError("eye protection region is empty")
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0.8)
    gradient_x = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gradient_x, gradient_y)
    nonzero = magnitude[magnitude > 0]
    high = float(np.quantile(nonzero, 0.85)) if nonzero.size else 64.0
    high = clamp(high, 24.0, 224.0)
    low = high * 0.4
    edges = cv2.Canny(blurred, low, high, L2gradient=True)

    local_polygon = np.rint(polygon - np.array([x0, y0])).astype(np.int32)
    eye_height = max(2.0, float(polygon[:, 1].max() - polygon[:, 1].min()))
    active_eye = np.zeros_like(edges)
    cv2.fillPoly(active_eye, [local_polygon], 255)
    active_padding = max(2, int(round(eye_height * 0.18)))
    active_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (active_padding * 2 + 1, active_padding * 2 + 1),
    )
    active_eye = cv2.dilate(active_eye, active_kernel)

    unrelated = cv2.bitwise_and(edges, cv2.bitwise_not(active_eye))
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(
        edges,
        connectivity=8,
    )
    boundary_components = np.zeros_like(edges)
    minimum_length = max(3, int(round((polygon[:, 0].max() - polygon[:, 0].min()) * 0.60)))
    crop_height, crop_width = edges.shape
    for component in range(1, component_count):
        component_mask = labels == component
        ys, xs = np.nonzero(component_mask)
        if not len(xs):
            continue
        touches_boundary = bool(
            np.any(xs == 0)
            or np.any(xs == crop_width - 1)
            or np.any(ys == 0)
            or np.any(ys == crop_height - 1)
        )
        if touches_boundary and int(stats[component, cv2.CC_STAT_AREA]) >= minimum_length:
            boundary_components[component_mask & (active_eye == 0)] = 255

    protected = cv2.bitwise_or(unrelated, boundary_components)
    dilation = int(clamp(round((polygon[:, 0].max() - polygon[:, 0].min()) * 0.02), 1, 3))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1))
    hard_core = cv2.dilate(protected, kernel)
    if excluded_iris_mask is not None:
        excluded = cv2.dilate((excluded_iris_mask > 0).astype(np.uint8) * 255, kernel)
        hard_core[excluded > 0] = 0
    feather = cv2.GaussianBlur(hard_core, (3, 3), 0.8)
    mask = np.maximum(hard_core, feather)
    return {
        "dataUrl": _alpha_mask_data_url(mask),
        "width": int(crop_width),
        "height": int(crop_height),
        "coverage": float(np.count_nonzero(mask) / mask.size),
        "method": "canny-active-aperture-v1",
        "cannyLow": low,
        "cannyHigh": high,
    }, mask


def closed_eye_corrective_layer(
    image: np.ndarray,
    polygon: np.ndarray,
    region: tuple[int, int, int, int],
    close_centre: float,
    protected_mask: np.ndarray | None = None,
) -> dict[str, Any] | None:
    """Author a deterministic high-blink affine skin fill and lid stroke.

    Collapsing an open-eye texture cannot create the missing skin and lid line
    at the endpoint. The fill is fitted from low-edge pixels outside the eye;
    sampling from the open aperture itself would propagate iris/eyelash colour.
    """

    x0, y0, x1, y1 = region
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    crop_height, crop_width = crop.shape[:2]
    local_polygon = np.rint(polygon - np.array([x0, y0])).astype(np.int32)
    eye_width = max(2.0, float(polygon[:, 0].max() - polygon[:, 0].min()))
    eye_height = max(2.0, float(polygon[:, 1].max() - polygon[:, 1].min()))

    eye_core = np.zeros((crop_height, crop_width), dtype=np.uint8)
    cv2.fillPoly(eye_core, [local_polygon], 255)
    dilation = int(clamp(round(eye_height * 0.08), 1, 4))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1))
    aperture = cv2.dilate(eye_core, kernel)

    sample_exclusion_radius = int(clamp(round(eye_height * 0.20), 2, 10))
    sample_exclusion_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (sample_exclusion_radius * 2 + 1, sample_exclusion_radius * 2 + 1),
    )
    sample_exclusion = cv2.dilate(eye_core, sample_exclusion_kernel)

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0.8)
    edges = cv2.Canny(blurred, 32, 96, L2gradient=True)
    edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))

    # A required corrective is never allowed to paint at the crop boundary.
    aperture[[0, -1], :] = 0
    aperture[:, [0, -1]] = 0
    opaque_pixels = int(np.count_nonzero(aperture))
    coverage = opaque_pixels / aperture.size
    if opaque_pixels < 12 or coverage > 0.45:
        return None

    yy, xx = np.mgrid[0:crop_height, 0:crop_width]
    local_eye_left = float(polygon[:, 0].min() - x0)
    local_eye_right = float(polygon[:, 0].max() - x0)
    local_eye_top = float(polygon[:, 1].min() - y0)
    local_eye_bottom = float(polygon[:, 1].max() - y0)
    horizontal = (
        (xx >= local_eye_left - 0.10 * eye_width)
        & (xx <= local_eye_right + 0.10 * eye_width)
    )
    upper = yy <= local_eye_top - 0.20 * eye_height
    lower = yy >= local_eye_bottom + 0.20 * eye_height
    valid_sample = horizontal & (sample_exclusion == 0) & (edges == 0)
    if protected_mask is not None:
        if protected_mask.shape != valid_sample.shape:
            return None
        valid_sample &= protected_mask < 128
    lower_mask = valid_sample & lower
    upper_mask = valid_sample & upper
    lower_y, lower_x = np.nonzero(lower_mask)
    minimum_samples = max(48, int(math.ceil(opaque_pixels * 0.20)))
    if len(lower_x) < minimum_samples:
        return None
    if float(lower_x.max() - lower_x.min()) < eye_width * 0.65:
        return None
    upper_samples_included = False
    upper_y, upper_x = np.nonzero(upper_mask)
    if len(upper_x) >= 12:
        lower_median = np.median(crop[lower_y, lower_x].astype(np.float64), axis=0)
        upper_median = np.median(crop[upper_y, upper_x].astype(np.float64), axis=0)
        upper_samples_included = float(np.linalg.norm(lower_median - upper_median)) <= 12.0
    sample_mask = lower_mask | upper_mask if upper_samples_included else lower_mask
    sample_y, sample_x = np.nonzero(sample_mask)
    if len(sample_x) < minimum_samples:
        return None
    if int(np.count_nonzero(lower & sample_mask)) < math.ceil(len(sample_x) * 0.25):
        return None
    if float(sample_x.max() - sample_x.min()) < eye_width * 0.65:
        return None

    def design_matrix(x_values: np.ndarray, y_values: np.ndarray) -> np.ndarray:
        normalised_x = (x_values.astype(np.float64) - crop_width * 0.5) / max(1.0, crop_width * 0.5)
        normalised_y = (y_values.astype(np.float64) - crop_height * 0.5) / max(1.0, crop_height * 0.5)
        return np.column_stack((np.ones_like(normalised_x), normalised_x, normalised_y))

    samples = crop[sample_y, sample_x].astype(np.float64)
    design = design_matrix(sample_x, sample_y)
    coefficients, _, _, _ = np.linalg.lstsq(design, samples, rcond=None)
    predicted_samples = design @ coefficients
    residuals = np.linalg.norm(samples - predicted_samples, axis=1)
    median_residual = float(np.median(residuals))
    mad = float(np.median(np.abs(residuals - median_residual)))
    retained = residuals <= median_residual + 3.0 * max(1.0, mad)
    if int(np.count_nonzero(retained)) < minimum_samples:
        return None
    retained_x = sample_x[retained]
    retained_y = sample_y[retained]
    if int(np.count_nonzero(lower[retained_y, retained_x])) < math.ceil(len(retained_x) * 0.25):
        return None
    if float(retained_x.max() - retained_x.min()) < eye_width * 0.65:
        return None
    retained_design = design_matrix(retained_x, retained_y)
    retained_samples = crop[retained_y, retained_x].astype(np.float64)
    coefficients, _, _, _ = np.linalg.lstsq(retained_design, retained_samples, rcond=None)
    retained_residuals = np.linalg.norm(retained_samples - retained_design @ coefficients, axis=1)
    median_residual = float(np.median(retained_residuals))
    full_design = design_matrix(xx.ravel(), yy.ravel())
    filled = np.clip(full_design @ coefficients, 0, 255).reshape(crop_height, crop_width, 3).astype(np.uint8)

    source_pixels = crop[aperture > 0]
    source_gray = gray[aperture > 0]
    if len(source_pixels) < 12:
        return None
    dark_threshold = float(np.quantile(source_gray, 0.08))
    dark_pixels = source_pixels[source_gray <= dark_threshold]
    if len(dark_pixels) == 0:
        dark_pixels = source_pixels
    line_colour = tuple(int(value) for value in np.median(dark_pixels, axis=0))

    left = polygon[int(np.argmin(polygon[:, 0]))] - np.array([x0, y0])
    right = polygon[int(np.argmax(polygon[:, 0]))] - np.array([x0, y0])
    endpoint_mean_y = (float(left[1]) + float(right[1])) * 0.5
    target_centre_y = float(close_centre - y0)
    control_y = 2.0 * target_centre_y - endpoint_mean_y
    control = np.array([(float(left[0]) + float(right[0])) * 0.5, control_y])
    points: list[list[int]] = []
    for t in np.linspace(0.0, 1.0, 25):
        point = (1.0 - t) ** 2 * left + 2.0 * (1.0 - t) * t * control + t**2 * right
        points.append([
            int(clamp(round(float(point[0])), 1, crop_width - 2)),
            int(clamp(round(float(point[1])), 1, crop_height - 2)),
        ])
    line_thickness = int(clamp(round(eye_height * 0.045), 1, 3))
    curve = np.asarray(points, dtype=np.int32)
    cv2.polylines(filled, [curve], False, line_colour, line_thickness, cv2.LINE_AA)

    alpha = np.maximum(aperture, cv2.GaussianBlur(aperture, (3, 3), 0.8))
    # Ensure the authored line is never clipped by a one-pixel aperture gap.
    cv2.polylines(alpha, [curve], False, 255, line_thickness + 2, cv2.LINE_AA)
    alpha[[0, -1], :] = 0
    alpha[:, [0, -1]] = 0
    layer = cv2.cvtColor(filled, cv2.COLOR_BGR2BGRA)
    layer[:, :, 3] = alpha
    return {
        "dataUrl": _rgba_data_url(layer, "closed-eye corrective"),
        "width": int(crop_width),
        "height": int(crop_height),
        "coverage": float(np.count_nonzero(alpha) / alpha.size),
        "method": "affine-skin-fill-curve-v3",
        "activationStart": 0.55,
        "lineThickness": line_thickness,
        "sampleExclusionRadius": sample_exclusion_radius,
        "retainedSamplePixels": int(len(retained_x)),
        "medianFitResidual": median_residual,
        "upperSamplesIncluded": upper_samples_included,
    }


def _triangle_signed_area(
    first: Sequence[float],
    second: Sequence[float],
    third: Sequence[float],
) -> float:
    return 0.5 * (
        (float(second[0]) - float(first[0])) * (float(third[1]) - float(first[1]))
        - (float(second[1]) - float(first[1])) * (float(third[0]) - float(first[0]))
    )


def _build_eye_semantic_mesh(
    polygon: np.ndarray,
    region: tuple[int, int, int, int],
    source_rows: Sequence[float],
    closed_rows: Sequence[float],
    protected_mask: np.ndarray,
    image_width: int,
    image_height: int,
) -> dict[str, Any] | None:
    """Build a deterministic blink-only mesh with an explicit mobility field.

    The regular topology intentionally isolates the semantic-field experiment
    from adaptive vertex placement. Its outer boundary is fixed, lid mobility
    peaks near the eye centre, and compiler-authored protected pixels suppress
    nearby vertex motion. The existing protected overlay remains the final
    pixel-preservation contract in the Runtime.
    """

    x0, y0, x1, _ = region
    eye_left = float(polygon[:, 0].min())
    eye_right = float(polygon[:, 0].max())
    inner_xs = np.linspace(eye_left, eye_right, 5, dtype=np.float64)
    source_xs = [float(x0), *(float(value) for value in inner_xs), float(x1)]
    horizontal_mobility = [0.0, 0.5, 0.82, 1.0, 0.82, 0.5, 0.0]
    columns = len(source_xs)
    rows = len(source_rows)
    vertices: list[dict[str, float]] = []
    weights: list[float] = []
    max_displacements: list[dict[str, float]] = []

    mask_height, mask_width = protected_mask.shape
    for row_index, source_y in enumerate(source_rows):
        row_displacement = float(closed_rows[row_index] - source_y)
        for column_index, source_x in enumerate(source_xs):
            local_x = int(clamp(round(source_x - x0), 0, mask_width - 1))
            local_y = int(clamp(round(float(source_y) - y0), 0, mask_height - 1))
            protection = float(protected_mask[local_y, local_x]) / 255.0
            mobility = horizontal_mobility[column_index] * (1.0 - protection)
            if row_index in (0, rows - 1) or column_index in (0, columns - 1):
                mobility = 0.0
            vertices.append(normalise_point((source_x, source_y), image_width, image_height))
            weights.append(clamp(mobility, 0.0, 1.0))
            max_displacements.append({"x": 0.0, "y": row_displacement / image_height})

    triangles: list[list[int]] = []
    for row_index in range(rows - 1):
        for column_index in range(columns - 1):
            top_left = row_index * columns + column_index
            top_right = top_left + 1
            bottom_left = (row_index + 1) * columns + column_index
            bottom_right = bottom_left + 1
            triangles.append([top_left, top_right, bottom_right])
            triangles.append([top_left, bottom_right, bottom_left])

    source_points = [
        (vertex["x"], vertex["y"])
        for vertex in vertices
    ]
    minimum_area_ratio = 1.0
    for blink in (0.0, 0.25, 0.5, 0.75, 1.0):
        destination = [
            (
                point[0] + blink * weights[index] * max_displacements[index]["x"],
                point[1] + blink * weights[index] * max_displacements[index]["y"],
            )
            for index, point in enumerate(source_points)
        ]
        for triangle in triangles:
            source_area = _triangle_signed_area(*(source_points[index] for index in triangle))
            destination_area = _triangle_signed_area(*(destination[index] for index in triangle))
            if abs(source_area) <= 1e-12 or source_area * destination_area <= 0:
                return None
            area_ratio = abs(destination_area / source_area)
            minimum_area_ratio = min(minimum_area_ratio, area_ratio)
            if area_ratio < 0.02:
                return None

    upper_row = 2
    lower_row = 3
    aperture = [
        *(upper_row * columns + column for column in range(1, columns - 1)),
        *(lower_row * columns + column for column in range(columns - 2, 0, -1)),
    ]
    return {
        "method": "semantic-weighted-triangle-mesh-v1",
        "vertices": vertices,
        "triangles": triangles,
        "fields": [{
            "control": "blink",
            "weights": weights,
            "maxDisplacements": max_displacements,
        }],
        "aperture": aperture,
        "minimumAreaRatio": minimum_area_ratio,
    }


def _eye_deformation(
    image: np.ndarray,
    polygon: np.ndarray,
    pupil: dict[str, float | Point],
    region: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
    blink_floor: float,
) -> dict[str, Any]:
    x0, y0, x1, y1 = region
    eye_top = float(polygon[:, 1].min())
    eye_bottom = float(polygon[:, 1].max())
    eye_height = max(2.0, eye_bottom - eye_top)
    guard_top = eye_top - max(1.0, (eye_top - y0) * 0.42)
    guard_bottom = eye_bottom + max(1.0, (y1 - eye_bottom) * 0.42)
    close_centre = eye_top + eye_height * 0.68
    closed_top = close_centre - blink_floor * 0.5
    closed_bottom = close_centre + blink_floor * 0.5
    source_rows = [float(y0), guard_top, eye_top, eye_bottom, guard_bottom, float(y1)]
    closed_rows = [
        float(y0),
        guard_top + (closed_top - eye_top) * 0.18,
        closed_top,
        closed_bottom,
        guard_bottom + (closed_bottom - eye_bottom) * 0.18,
        float(y1),
    ]
    iris, iris_mask = iris_base_eye_layers(
        image,
        polygon,
        pupil,
        region,
        image_width,
        image_height,
    )
    protection_definition, protection_mask = protected_line_art_mask(
        image,
        polygon,
        region,
        iris_mask,
    )
    semantic_mesh = _build_eye_semantic_mesh(
        polygon,
        region,
        source_rows,
        closed_rows,
        protection_mask,
        image_width,
        image_height,
    )
    closed_eye = closed_eye_corrective_layer(
        image,
        polygon,
        region,
        close_centre,
        protection_mask,
    )
    deformation = {
        "method": "fixed-boundary-piecewise-affine-v1",
        "sourceRows": [value / image_height for value in source_rows],
        "closedRows": [value / image_height for value in closed_rows],
        "gazeRowWeights": [0.0, 0.0, 1.0, 1.0, 0.0, 0.0],
        "protectedLineArtMask": protection_definition,
        "region": normalise_box(region, image_width, image_height),
    }
    if iris is not None:
        deformation["iris"] = iris
    if semantic_mesh is not None:
        deformation["semanticMesh"] = semantic_mesh
    if closed_eye is not None:
        deformation["closedEye"] = closed_eye
    return deformation


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
    blink_floor_pixels = max(0.8, eye_height * 0.035)
    deformation = _eye_deformation(
        image,
        polygon,
        pupil,
        (x0, y0, x1, y1),
        image_width,
        image_height,
        blink_floor_pixels,
    )
    max_gaze_x_pixels = eye_width * 0.075 * gaze_scale
    max_gaze_y_pixels = eye_height * 0.075 * gaze_scale
    iris = deformation.get("iris")
    if isinstance(iris, dict):
        centre = iris["centre"]
        iris_x = float(centre["x"]) * image_width
        iris_y = float(centre["y"]) * image_height
        radius_x = float(iris["radiusX"]) * image_width
        radius_y = float(iris["radiusY"]) * image_height
        max_gaze_x_pixels = safe_symmetric_ellipse_shift(
            polygon,
            iris_x,
            iris_y,
            radius_x,
            radius_y,
            max_gaze_x_pixels,
            "x",
        )
        max_gaze_y_pixels = safe_symmetric_ellipse_shift(
            polygon,
            iris_x,
            iris_y,
            radius_x,
            radius_y,
            max_gaze_y_pixels,
            "y",
        )
        max_gaze_x_pixels, max_gaze_y_pixels = safe_diagonal_ellipse_shifts(
            polygon,
            iris_x,
            iris_y,
            radius_x,
            radius_y,
            max_gaze_x_pixels,
            max_gaze_y_pixels,
        )
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
            "maxGazeX": max_gaze_x_pixels / image_width,
            "maxGazeY": max_gaze_y_pixels / image_height,
            "blinkFloor": blink_floor_pixels / image_height,
            "deformation": deformation,
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
    b, g, r = np.clip(np.median(selected, axis=0) * 0.55, 0, 255).astype(int)
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
    crop = image[y0:y1, x0:x1]
    focus_x0 = max(0, int(round(left - x0 - mouth_width * 0.08)))
    focus_x1 = min(crop.shape[1], int(round(right - x0 + mouth_width * 0.08)))
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    local_centre_y = int(round(centre_y - y0))
    search_radius = max(2, int(round(half_region_height * 0.45)))
    search_y0 = max(0, local_centre_y - search_radius)
    search_y1 = min(gray.shape[0], local_centre_y + search_radius + 1)
    focus = gray[search_y0:search_y1, focus_x0:focus_x1]
    if focus.size:
        darkness = 255.0 - np.quantile(focus, 0.18, axis=1)
        line_y = float(y0 + search_y0 + int(np.argmax(darkness)))
        line_contrast = float(np.max(darkness) - np.min(darkness))
    else:
        line_y = centre_y
        line_contrast = 0.0
    half_band = max(1.0, min(3.0, face_height * 0.004))
    band_x0 = max(float(x0), left - mouth_width * 0.10)
    band_x1 = min(float(x1), right + mouth_width * 0.10)
    upper_band = (band_x0, max(float(y0), line_y - half_band), band_x1, line_y + 0.5)
    lower_band = (band_x0, line_y - 0.5, band_x1, min(float(y1), line_y + half_band))
    deformation = {
        "method": "bounded-lip-bands-v1",
        "upperBand": normalise_box(upper_band, image_width, image_height),
        "lowerBand": normalise_box(lower_band, image_width, image_height),
        "cavity": {
            "centreX": centre_x / image_width,
            "centreY": line_y / image_height,
            "radiusX": (mouth_width * 0.40) / image_width,
            "maxRadiusY": (max_open * 0.62) / image_height,
        },
        "upperTravel": (max_open * 0.45) / image_height,
        "lowerTravel": (max_open * 0.55) / image_height,
        "lineContrast": line_contrast,
    }
    line_confidence = clamp(line_contrast / 32.0, 0.0, 1.0)
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
        "rig": {
            "maxOpen": max_open / image_height,
            "interiorColour": _dark_colour(image, (x0, y0, x1, y1)),
            "deformation": deformation,
        },
        "confidence": confidence,
        "landmarkConfidence": landmark_confidence,
        "lineConfidence": line_confidence,
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
    mouth_line_confidence = float(mouth.get("lineConfidence", 1.0))

    eye_widths = [float(eye["anchors"]["right"] - eye["anchors"]["left"]) for eye in eyes]
    eye_symmetry = min(eye_widths) / max(1e-6, max(eye_widths))
    pupil_confidence = min(float(eye["pupil"]["confidence"]) for eye in eyes)
    layered_eye_rigs: list[Any] = []
    for eye in eyes:
        rig = eye.get("rig")
        deformation = rig.get("deformation") if isinstance(rig, dict) else None
        layered_eye_rigs.append(deformation.get("iris") if isinstance(deformation, dict) else None)
    iris_segmentation_confidence = min(
        (
            float(iris.get("segmentationConfidence", 0.0))
            if isinstance(iris, dict)
            else 0.0
            for iris in layered_eye_rigs
        ),
        default=0.0,
    )

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
    if mouth_confidence < 0.48 or mouth_line_confidence < 0.25:
        disabled.append("mouth")
        warnings.append("mouth control disabled because its landmarks or source line are unreliable")
    if pupil_confidence < MIN_FULL_PUPIL_CONFIDENCE:
        disabled.append("gaze")
        warnings.append(
            f"gaze disabled because pupil confidence is below {MIN_FULL_PUPIL_CONFIDENCE:.2f}"
        )
    if not all(isinstance(iris, dict) for iris in layered_eye_rigs):
        disabled.extend(("blink", "gaze"))
        warnings.append("blink and gaze disabled because one or both iris/base-eye layers are unreliable")
    elif any(
        float(eye.get("rig", {}).get("maxGazeX", 0.0)) * image_width < 1.0
        or float(eye.get("rig", {}).get("maxGazeY", 0.0)) * image_height < 0.25
        for eye in eyes
    ):
        disabled.append("gaze")
        warnings.append(
            "gaze disabled because an iris lacks one horizontal or one quarter vertical pixel of safe clearance"
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
            "mouthLineConfidence": mouth_line_confidence,
            "pupilConfidence": pupil_confidence,
            "irisSegmentationConfidence": iris_segmentation_confidence,
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
    detector_runtime: DetectorRuntime | None = None,
) -> list[tuple[Path, dict[str, Any]]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    if overlay_dir:
        overlay_dir.mkdir(parents=True, exist_ok=True)

    runtime = detector_runtime or load_detector_runtime(offline, flip_test)
    results: list[tuple[Path, dict[str, Any]]] = []

    for input_path in input_paths:
        image = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"could not decode image: {input_path}")
        image_height, image_width = image.shape[:2]
        if (
            image_width > MAX_IMAGE_DIMENSION
            or image_height > MAX_IMAGE_DIMENSION
            or image_width * image_height > MAX_IMAGE_PIXELS
        ):
            raise ValueError(
                f"image dimensions exceed the portable runtime limit: {image_width}x{image_height}"
            )
        predictions = runtime.detector(image)
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

        manifest = build_manifest(input_path, image, predictions, runtime.digests)
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
