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
from shrimp_engine import (
    Circle,
    resize_for_counting,
    build_mask,
    preprocess,
    blob_method,
    connected_component_method,
    peak_method,
    choose_consensus,
    create_overlay,
    detect_bowl_circle # Keep for default behavior
)

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

@app.post("/detect")
async def detect_bowl(file: UploadFile = File(...), attempt: int = Form(default=1)):
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
        h, w = image.shape[:2]
        
        # Draw preview
        preview_img = image.copy()
        cv2.circle(preview_img, (bowl.x, bowl.y), bowl.r, (0, 255, 255), 5)
        _, buffer = cv2.imencode(".jpg", preview_img)
        preview_base64 = base64.b64encode(buffer).decode("utf-8")

        return {
            "circle": {
                "x_pct": bowl.x / w,
                "y_pct": bowl.y / h,
                "r_pct": bowl.r / max(h, w) # Use max edge for consistent radius pct
            },
            "preview": f"data:image/jpeg;base64,{preview_base64}"
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/count")
async def count_shrimp(
    file: UploadFile = File(...),
    cx_pct: Optional[float] = Form(None),
    cy_pct: Optional[float] = Form(None),
    r_pct: Optional[float] = Form(None),
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
        if cx_pct is not None and cy_pct is not None and r_pct is not None:
            bowl = Circle(
                x=int(cx_pct * w),
                y=int(cy_pct * h),
                r=int(r_pct * max(h, w))
            )
        else:
            bowl = detect_bowl_circle(image)

        target_size = 1400
        resized, resized_circle = resize_for_counting(image, bowl, target_size)
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        mask = build_mask(gray.shape, resized_circle, 0.88)
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

        overlay = create_overlay(resized, resized_circle, mask, overlay_result, consensus)
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
            "mask_circle": {"x": resized_circle.x, "y": resized_circle.y, "r": resized_circle.r},
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
