# Shrimp Counter

Small OpenCV-based tool to estimate shrimp count from a bowl photo, transitioning into a robust field-ready web application.

## Overview
This project is evolving from a standalone Python script into a client-server architecture designed for outdoor shrimp farm environments. We use a **Consensus Method** (4 independent classical CV algorithms) as the Phase 1 engine, with plans to integrate a fine-tuned **YOLOv8** model in Phase 2.

## Current Progress (Week 2 Complete)
- **Backend (FastAPI):** Core counting engine wrapped in an API with confidence flagging and `/health` monitoring.
- **Frontend (React + Vite + Tailwind v4):** Modern, mobile-first UI with:
  - Manual camera trigger and SVG framing guide.
  - Client-side image compression (<500KB).
  - High-impact results screen with color-coded confidence badges.
  - Quick tap-to-correct (-1 / +1) functionality.
  - Base64 overlay image delivery for instant feedback.

## Deployment Notes

### Render.com Cold Start Prevention
The `api.py` includes a `/health` endpoint. Use [cron-job.org](https://cron-job.org) (free) to ping this endpoint every 14 minutes. This prevents Render's free tier from sleeping between sessions, ensuring a fast response for field users.

### Cloudflare R2 Setup
Use Wrangler CLI to create an R2 bucket for storing field images and JSON results. Images are compressed client-side to <500KB before upload to maximize free storage and minimize upload time on farm cellular networks.

## Field Data Collection (Critical for Phase 2)
To move from classical CV to a robust AI model, we need a custom dataset. Ask your test user to capture photos covering:
- **Lighting:** Direct sunlight, deep shade, overcast, and high-glare surfaces.
- **Containers:** Different colors (white, blue, black, grey) and sizes.
- **Density:** Dense shrimp piles where overlaps occur vs. spread out arrangements.
- **Surface:** Wet shrimp vs. drier surfaces.

**Target:** 200+ photos before starting YOLOv8 fine-tuning.

## Implementation Roadmap

### Week 3: Deployment (Current Goal)
- **Backend:** Deploy `shrimp_engine.py` and `api.py` to **Render.com**.
- **Frontend:** Deploy the React app to **Cloudflare Pages**.
- **Result:** A public URL your friend can use on their phone without requiring your local machine to be running.

### Week 4: Cloudflare R2 Integration
- Integrate storage to automatically save field photos and detection metrics.
- Begin the systematic collection of training data for the YOLO model.

### Month 2: AI Upgrade (Phase 2)
- Label collected images in **Roboflow**.
- Train **YOLOv8** on Google Colab and export to ONNX/PyTorch.
- Swap YOLO into the backend as the primary detector.

## Future Improvements
- **Manual Circle Adjustment:** Allow users to drag/resize the detection circle if the automated HoughCircles detector fails in harsh lighting.
- **Offline Mode:** Explore PWA caching strategies to allow image capture in areas with poor connectivity, syncing when back in range.
- **Batch Export:** Generate PDF or CSV reports for pond management tracking.

## Setup (Local Development)

### Backend
```bash
cd shrimp_count
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python api.py
```

### Frontend
```bash
cd shrimp_count/frontend
npm install
npm run dev
```
