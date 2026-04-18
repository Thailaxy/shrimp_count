from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2
import base64
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

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/count")
async def count_shrimp(file: UploadFile = File(...)):
    # Read uploaded image
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        return {"error": "Invalid image file"}

    # Core engine logic
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

    return {
        "count": consensus,
        "spread": spread,
        "confidence": confidence,
        "confidence_flag": spread > consensus * 0.30,
        "methods": {r.name: r.count for r in results},
        "overlay": f"data:image/jpeg;base64,{overlay_base64}"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
