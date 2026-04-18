import os
import json
import uuid
import base64
import boto3
from datetime import datetime
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from botocore.exceptions import ClientError
import numpy as np
import cv2
from shrimp_engine import (
    detect_bowl_circle,
    resize_for_counting,
    build_mask,
    preprocess,
    blob_method,
    connected_component_method,
    peak_method,
    choose_consensus,
    create_overlay
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

# R2 Configuration from Environment Variables
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

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.post("/count")
async def count_shrimp(file: UploadFile = File(...)):
    # Read uploaded image
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        return {"error": "Invalid image file"}

    # Core engine logic
    try:
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

        # Confidence flag (essential for outdoor use)
        confidence = "HIGH"
        if spread > consensus * 0.30:
            confidence = "LOW"
        elif spread > consensus * 0.15:
            confidence = "MEDIUM"

        # Generate overlay for frontend display
        overlay = create_overlay(resized, resized_circle, mask, overlay_result, consensus)
        _, buffer = cv2.imencode(".jpg", overlay)
        overlay_base64 = base64.b64encode(buffer).decode("utf-8")

        # --- Week 4: Cloudflare R2 Data Collection ---
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        
        payload = {
            "count": consensus,
            "spread": spread,
            "confidence": confidence,
            "confidence_flag": spread > consensus * 0.30,
            "methods": {r.name: r.count for r in results},
            "timestamp": timestamp,
            "mask_circle": {"x": resized_circle.x, "y": resized_circle.y, "r": resized_circle.r}
        }

        # Async-style upload (fire and forget for this POC)
        image_key = f"images/{timestamp}_{unique_id}.jpg"
        json_key = f"metrics/{timestamp}_{unique_id}.json"
        
        upload_to_r2(contents, image_key, "image/jpeg")
        upload_to_r2(json.dumps(payload, indent=2), json_key, "application/json")

        return {
            **payload,
            "overlay": f"data:image/jpeg;base64,{overlay_base64}"
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
