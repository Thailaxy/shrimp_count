# Shrimp Counter

Small OpenCV-based tool to estimate shrimp count from a bowl photo, transitioning into a robust field-ready web application.

## 🚀 Live Project Links
- **Backend API:** [https://shrimp-count.onrender.com/health](https://shrimp-count.onrender.com/health)
- **Frontend App:** [Cloudflare Pages URL will go here after success]

## Current Progress (Week 3: Deployment)
- **Backend (FastAPI):** Live on Render.com with `/health` and `/count` endpoints.
- **Frontend (React):** Prepared for Cloudflare Pages.

### Cloudflare Pages Settings (IMPORTANT)
If your build fails, check these settings in the Cloudflare Dashboard (**Settings > Build & deployments**):
- **Framework preset:** `Vite`
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** `frontend`
- **Environment Variable:** `VITE_API_URL` should be `https://shrimp-count.onrender.com`

## Roadmap

### Week 4: Cloudflare R2 Integration
- Integrate storage to automatically save field photos and detection metrics.
- Begin the systematic collection of training data for the YOLO model.

### Month 2: AI Upgrade (Phase 2)
- Label collected images in **Roboflow**.
- Train **YOLOv8** on Google Colab and export to ONNX/PyTorch.
- Swap YOLO into the backend as the primary detector.

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
