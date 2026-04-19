import os
import json
import uuid
import base64
import boto3
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from botocore.exceptions import ClientError
import numpy as np
import cv2
from typing import Optional
from dotenv import load_dotenv
from shrimp_engine import (
    Circle,
    Rectangle,
    rectangle_from_circle,
    resize_selection_for_counting,
    build_selection_mask,
    preprocess,
    blob_method,
    connected_component_method,
    peak_method,
    choose_consensus,
    create_overlay,
    detect_bowl_circle # Keep for default behavior
)

load_dotenv()

app = FastAPI()

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# R2 Configuration
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "shrimpcount-images")

def get_r2_client():
    if not all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY]):
        return None
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto"
    )

def upload_to_r2(data, key, content_type):
    client = get_r2_client()
    if client:
        try:
            client.put_object(
                Bucket=R2_BUCKET_NAME,
                Key=key,
                Body=data,
                ContentType=content_type
            )
            return True
        except ClientError as e:
            print(f"R2 Upload Error: {e}")
    return False


def download_from_r2(key: str) -> bytes | None:
    client = get_r2_client()
    if client is None:
        return None

    try:
        response = client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return response["Body"].read()
    except ClientError as e:
        print(f"R2 Download Error: {e}")
        return None


def draw_selection_preview(image: np.ndarray, selection: Circle | Rectangle) -> str:
    preview_img = image.copy()
    if isinstance(selection, Circle):
        cv2.circle(preview_img, (selection.x, selection.y), selection.r, (0, 255, 255), 5)
    else:
        top_left = (selection.x, selection.y)
        bottom_right = (selection.x + selection.w, selection.y + selection.h)
        cv2.rectangle(preview_img, top_left, bottom_right, (0, 255, 255), 5)

    _, buffer = cv2.imencode(".jpg", preview_img)
    return base64.b64encode(buffer).decode("utf-8")


def serialize_selection(selection: Circle | Rectangle, image_shape: tuple[int, int, int]) -> dict:
    h, w = image_shape[:2]
    if isinstance(selection, Circle):
        return {
            "type": "circle",
            "x_pct": selection.x / w,
            "y_pct": selection.y / h,
            "r_pct": selection.r / max(h, w),
        }

    return {
        "type": "rectangle",
        "x_pct": selection.x / w,
        "y_pct": selection.y / h,
        "w_pct": selection.w / w,
        "h_pct": selection.h / h,
    }


def serialize_mask_shape(selection: Circle | Rectangle) -> dict:
    if isinstance(selection, Circle):
        return {"type": "circle", "x": selection.x, "y": selection.y, "r": selection.r}
    return {"type": "rectangle", "x": selection.x, "y": selection.y, "w": selection.w, "h": selection.h}


def deserialize_rectangle(
    image_width: int,
    image_height: int,
    x_pct: float,
    y_pct: float,
    w_pct: float,
    h_pct: float,
) -> Rectangle:
    x = max(0, int(x_pct * image_width))
    y = max(0, int(y_pct * image_height))
    width = max(1, min(int(w_pct * image_width), max(1, image_width - x)))
    height = max(1, min(int(h_pct * image_height), max(1, image_height - y)))
    return Rectangle(x=x, y=y, w=width, h=height)


def encode_history_image(image_bytes: bytes) -> str | None:
    image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None

    max_edge = max(image.shape[:2])
    scale = min(1.0, 480.0 / max_edge)
    if scale < 1.0:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        return None

    return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"

# Custom detect logic for parameter tuning
def detect_bowl_with_params(image: np.ndarray, param2: int = 30) -> Circle:
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
        param2=param2,
        minRadius=int(min(small.shape[:2]) * 0.25),
        maxRadius=int(min(small.shape[:2]) * 0.7),
    )

    if circles is None:
        raise RuntimeError("Failed to detect the bowl.")

    candidates = np.round(circles[0]).astype(int)
    image_center = np.array([small.shape[1] / 2.0, small.shape[0] / 2.0])

    def score(candidate: np.ndarray) -> float:
        center_distance = np.linalg.norm(candidate[:2] - image_center)
        return float(candidate[2] - 0.6 * center_distance)

    x, y, r = max(candidates, key=score)
    return Circle(int(x / scale), int(y / scale), int(r / scale))

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/history")
async def get_history(limit: int = 15):
    client = get_r2_client()
    if client is None:
        return {"items": [], "error": "History is unavailable because R2 is not configured."}

    limit = max(1, min(limit, 30))

    try:
        response = client.list_objects_v2(Bucket=R2_BUCKET_NAME, Prefix="metrics/")
        contents = response.get("Contents", [])
        metric_keys = sorted(
            (item["Key"] for item in contents if item["Key"].endswith(".json")),
            reverse=True,
        )[:limit]

        items = []
        for metric_key in metric_keys:
            metric_bytes = download_from_r2(metric_key)
            if metric_bytes is None:
                continue

            try:
                metric = json.loads(metric_bytes.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue

            stem = metric_key.removeprefix("metrics/").removesuffix(".json")
            image_bytes = download_from_r2(f"images/{stem}.jpg")
            if image_bytes is None:
                continue

            preview = encode_history_image(image_bytes)
            if preview is None:
                continue

            items.append({
                "id": stem,
                "timestamp": metric.get("timestamp"),
                "count": metric.get("count"),
                "confidence": metric.get("confidence"),
                "detection_mode": metric.get("detection_mode", "circle"),
                "methods": metric.get("methods", {}),
                "image": preview,
            })

        return {"items": items}
    except ClientError as e:
        return {"items": [], "error": f"Failed to load history: {e}"}

@app.post("/detect")
async def detect_bowl(
    file: UploadFile = File(...),
    attempt: int = Form(default=1),
    detection_mode: str = Form(default="circle"),
):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if image is None:
        return {"error": "Invalid image"}

    # Attempt logic: 1=30, 2=22, 3=15
    param2_map = {1: 30, 2: 22, 3: 15}
    p2 = param2_map.get(attempt, 30)

    try:
        bowl = detect_bowl_with_params(image, p2)
        selection: Circle | Rectangle = bowl
        if detection_mode == "rectangle":
            selection = rectangle_from_circle(bowl, image.shape[:2])

        return {
            "selection": serialize_selection(selection, image.shape),
            "preview": f"data:image/jpeg;base64,{draw_selection_preview(image, selection)}"
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/count")
async def count_shrimp(
    file: UploadFile = File(...),
    cx_pct: Optional[float] = Form(None),
    cy_pct: Optional[float] = Form(None),
    r_pct: Optional[float] = Form(None),
    rect_x_pct: Optional[float] = Form(None),
    rect_y_pct: Optional[float] = Form(None),
    rect_w_pct: Optional[float] = Form(None),
    rect_h_pct: Optional[float] = Form(None),
    detection_mode: Optional[str] = Form("circle")
):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        return {"error": "Invalid image file"}

    try:
        h, w = image.shape[:2]
        
        # Step 3: Use provided coords or detect
        if detection_mode == "rectangle" and None not in (rect_x_pct, rect_y_pct, rect_w_pct, rect_h_pct):
            selection: Circle | Rectangle = deserialize_rectangle(
                image_width=w,
                image_height=h,
                x_pct=rect_x_pct,
                y_pct=rect_y_pct,
                w_pct=rect_w_pct,
                h_pct=rect_h_pct,
            )
        elif cx_pct is not None and cy_pct is not None and r_pct is not None:
            selection = Circle(
                x=int(cx_pct * w),
                y=int(cy_pct * h),
                r=int(r_pct * max(h, w))
            )
        else:
            bowl = detect_bowl_circle(image)
            if detection_mode == "rectangle":
                selection = rectangle_from_circle(bowl, image.shape[:2])
            else:
                selection = bowl

        target_size = 1400
        resized, resized_selection = resize_selection_for_counting(image, selection, target_size)
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        mask = build_selection_mask(gray.shape, resized_selection, 0.88)
        clahe, blackhat = preprocess(gray)

        scale_factor = target_size / 1200.0
        results = [
            blob_method(clahe, mask, scale_factor),
            connected_component_method(blackhat, mask, 97, scale_factor),
            connected_component_method(blackhat, mask, 98, scale_factor),
            peak_method(blackhat, mask),
        ]

        consensus, overlay_result = choose_consensus(results)
        spread = int(max(r.count for r in results) - min(r.count for r in results))

        confidence = "HIGH"
        if spread > consensus * 0.30:
            confidence = "LOW"
        elif spread > consensus * 0.15:
            confidence = "MEDIUM"

        overlay = create_overlay(resized, resized_selection, mask, overlay_result, consensus)
        _, buffer = cv2.imencode(".jpg", overlay)
        overlay_base64 = base64.b64encode(buffer).decode("utf-8")

        # R2 Upload
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        payload = {
            "count": consensus,
            "spread": spread,
            "confidence": confidence,
            "confidence_flag": spread > consensus * 0.30,
            "methods": {r.name: r.count for r in results},
            "timestamp": timestamp,
            "mask_shape": serialize_mask_shape(resized_selection),
            "detection_mode": detection_mode
        }
        
        upload_to_r2(contents, f"images/{timestamp}_{unique_id}.jpg", "image/jpeg")
        upload_to_r2(json.dumps(payload, indent=2), f"metrics/{timestamp}_{unique_id}.json", "application/json")

        return {
            **payload,
            "overlay": f"data:image/jpeg;base64,{overlay_base64}"
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
