from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class Circle:
    x: int
    y: int
    r: int


@dataclass
class CountMethodResult:
    name: str
    count: int
    points: np.ndarray


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate the number of shrimp in a bowl image."
    )
    parser.add_argument("image", type=Path, help="Path to an input image")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs"),
        help="Directory for metrics and overlay output",
    )
    parser.add_argument(
        "--mask-shrink",
        type=float,
        default=0.88,
        help="Shrink factor applied to the detected bowl circle",
    )
    parser.add_argument(
        "--target-size",
        type=int,
        default=1400,
        help="Resize the longest image edge to this many pixels for counting",
    )
    return parser.parse_args()


def load_image(path: Path) -> np.ndarray:
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    return image


def detect_bowl_circle(image: np.ndarray) -> Circle:
    max_edge = max(image.shape[:2])
    scale = 1200.0 / max_edge
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 5)

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=150,
        param1=100,
        param2=30,
        minRadius=int(min(small.shape[:2]) * 0.25),
        maxRadius=int(min(small.shape[:2]) * 0.7),
    )

    if circles is None:
        raise RuntimeError("Failed to detect the bowl. Try a clearer image.")

    candidates = np.round(circles[0]).astype(int)
    image_center = np.array([small.shape[1] / 2.0, small.shape[0] / 2.0])

    def score(candidate: np.ndarray) -> float:
        center_distance = np.linalg.norm(candidate[:2] - image_center)
        return float(candidate[2] - 0.6 * center_distance)

    x, y, r = max(candidates, key=score)
    return Circle(int(x / scale), int(y / scale), int(r / scale))


def resize_for_counting(image: np.ndarray, circle: Circle, target_size: int) -> tuple[np.ndarray, Circle]:
    scale = target_size / max(image.shape[:2])
    resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    scaled_circle = Circle(
        x=int(round(circle.x * scale)),
        y=int(round(circle.y * scale)),
        r=int(round(circle.r * scale)),
    )
    return resized, scaled_circle


def build_mask(shape: tuple[int, int], circle: Circle, shrink: float) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    cv2.circle(mask, (circle.x, circle.y), int(circle.r * shrink), 255, -1)
    return mask


def preprocess(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    blackhat = cv2.morphologyEx(
        gray,
        cv2.MORPH_BLACKHAT,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
    )
    return clahe, blackhat


def blob_method(clahe: np.ndarray, mask: np.ndarray, scale_factor: float) -> CountMethodResult:
    inverted = 255 - clahe
    inverted[mask == 0] = 0

    params = cv2.SimpleBlobDetector_Params()
    params.filterByColor = True
    params.blobColor = 255
    params.minThreshold = 120
    params.maxThreshold = 255
    params.thresholdStep = 10
    params.filterByArea = True
    params.minArea = 2.0 * (scale_factor ** 2)
    params.maxArea = 40.0 * (scale_factor ** 2)
    params.filterByCircularity = False
    params.filterByConvexity = False
    params.filterByInertia = False
    params.minDistBetweenBlobs = max(2.0, 2.0 * scale_factor)

    detector = cv2.SimpleBlobDetector_create(params)
    keypoints = detector.detect(inverted)
    points = np.array([[kp.pt[0], kp.pt[1]] for kp in keypoints], dtype=np.float32)
    return CountMethodResult("blob", len(keypoints), points)


def connected_component_method(
    blackhat: np.ndarray,
    mask: np.ndarray,
    percentile: float,
    scale_factor: float,
) -> CountMethodResult:
    masked_values = blackhat[mask > 0]
    threshold = np.percentile(masked_values, percentile)
    binary = ((blackhat >= threshold) & (mask > 0)).astype(np.uint8)

    count, _, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    area_min = max(2, int(round(2 * (scale_factor ** 2))))
    area_max = max(area_min + 1, int(round(40 * (scale_factor ** 2))))
    keep = (areas >= area_min) & (areas <= area_max)
    points = centroids[1:][keep].astype(np.float32)

    return CountMethodResult(
        f"components_p{int(percentile)}",
        int(np.count_nonzero(keep)),
        points,
    )


def peak_method(blackhat: np.ndarray, mask: np.ndarray) -> CountMethodResult:
    blurred = cv2.GaussianBlur(blackhat, (0, 0), 1.2)
    dilated = cv2.dilate(blurred, np.ones((3, 3), np.uint8))
    threshold = np.percentile(blurred[mask > 0], 97)
    peaks = ((blurred == dilated) & (blurred >= threshold) & (mask > 0)).astype(np.uint8)

    _, _, stats, centroids = cv2.connectedComponentsWithStats(peaks, 8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = (areas >= 1) & (areas <= 20)
    points = centroids[1:][keep].astype(np.float32)

    return CountMethodResult("peaks", int(np.count_nonzero(keep)), points)


def choose_consensus(results: list[CountMethodResult]) -> tuple[int, CountMethodResult]:
    counts = np.array([result.count for result in results], dtype=np.int32)
    consensus = int(np.median(counts))
    best = min(results, key=lambda result: abs(result.count - consensus))
    return consensus, best


def create_overlay(
    image: np.ndarray,
    circle: Circle,
    mask: np.ndarray,
    result: CountMethodResult,
    consensus: int,
) -> np.ndarray:
    overlay = image.copy()

    masked = overlay.copy()
    masked[mask == 0] = (masked[mask == 0] * 0.35).astype(np.uint8)
    overlay = cv2.addWeighted(overlay, 0.55, masked, 0.45, 0)

    cv2.circle(overlay, (circle.x, circle.y), circle.r, (0, 255, 255), 2)
    for point in result.points:
        cv2.circle(overlay, (int(round(point[0])), int(round(point[1]))), 3, (0, 0, 255), -1)

    cv2.putText(
        overlay,
        f"Estimated shrimp count: {consensus}",
        (30, 45),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.1,
        (20, 20, 20),
        4,
        cv2.LINE_AA,
    )
    cv2.putText(
        overlay,
        f"Estimated shrimp count: {consensus}",
        (30, 45),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.1,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        overlay,
        f"Overlay points from: {result.name} ({result.count})",
        (30, 85),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return overlay


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    image = load_image(args.image)
    bowl = detect_bowl_circle(image)
    resized, resized_circle = resize_for_counting(image, bowl, args.target_size)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    mask = build_mask(gray.shape, resized_circle, args.mask_shrink)
    clahe, blackhat = preprocess(gray)

    scale_factor = args.target_size / 1200.0
    results = [
        blob_method(clahe, mask, scale_factor),
        connected_component_method(blackhat, mask, percentile=97, scale_factor=scale_factor),
        connected_component_method(blackhat, mask, percentile=98, scale_factor=scale_factor),
        peak_method(blackhat, mask),
    ]

    consensus, overlay_result = choose_consensus(results)
    spread = int(max(result.count for result in results) - min(result.count for result in results))

    # Confidence flag (new for outdoor use)
    confidence = "HIGH"
    if spread > consensus * 0.30:
        confidence = "LOW"
    elif spread > consensus * 0.15:
        confidence = "MEDIUM"

    overlay = create_overlay(resized, resized_circle, mask, overlay_result, consensus)
    overlay_path = args.output_dir / f"{args.image.stem}_overlay.jpg"
    metrics_path = args.output_dir / f"{args.image.stem}_metrics.json"

    cv2.imwrite(str(overlay_path), overlay)

    payload = {
        "image": str(args.image),
        "consensus_count": consensus,
        "count_spread": spread,
        "confidence": confidence,
        "confidence_flag": spread > consensus * 0.30,
        "methods": {result.name: result.count for result in results},
        "mask_circle": {"x": resized_circle.x, "y": resized_circle.y, "r": resized_circle.r},
        "mask_shrink": args.mask_shrink,
        "overlay_points_from": overlay_result.name,
        "overlay_path": str(overlay_path),
    }
    metrics_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
