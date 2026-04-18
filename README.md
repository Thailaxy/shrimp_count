# Shrimp Counter

Small OpenCV-based tool to estimate shrimp count from a bowl photo, transitioning into a robust field-ready web application.

## 🚀 Live Project Links
- **Backend API:** [https://shrimp-count.onrender.com/health](https://shrimp-count.onrender.com/health)
- **Frontend App:** [https://shrimpcount.wanakorn-k.workers.dev](https://shrimpcount.wanakorn-k.workers.dev)

## 📊 Current Status
**POC Live | Data Collection Active**
The consensus-based counting engine is operational in the field. Every processed image and its corresponding metrics are automatically archived for the next phase of development.

## 📝 Deployment Lessons Learned (Week 3)

### Backend (Render.com)
- **OpenCV Version:** Use `opencv-python-headless` instead of `opencv-python` to avoid GUI/display driver errors on server-side environments.
- **Port Binding:** Ensure `uvicorn` or `gunicorn` binds to `0.0.0.0` to be accessible externally.

### Frontend (Cloudflare Workers/Pages)
- **Root Directory:** When the React app is in a subdirectory (e.g., `/frontend`), set the **Path/Root Directory** in the dashboard to `frontend`.
- **Wrangler Configuration:** For "Assets-only" deployments, keep `wrangler.json` simple. Do not add `assets.binding` as it causes conflicts in simple frontend setups.

## 📂 Data Collection (Phase 2 Preparation)
All field data is being systematically collected in the **Cloudflare R2 bucket: `shrimpcount-images`**.
- **Images:** Stored in `images/` folder with `{timestamp}_{uuid}.jpg`.
- **Metrics:** Stored in `metrics/` folder with `{timestamp}_{uuid}.json`.
This dataset will be used to fine-tune the YOLOv8 model for production-grade accuracy in varying outdoor conditions.

## Roadmap

### ✅ Week 4: Cloudflare R2 Integration (Complete)
- [x] Integrate `boto3` into the backend.
- [x] Automated upload of original photos and JSON metrics.
- [x] Graceful fallback if storage credentials are missing.

### 🔜 Month 2: AI Upgrade (Phase 2)
- Label collected images from R2 in **Roboflow**.
- Train **YOLOv8** on Google Colab and export to ONNX/PyTorch.
- Swap YOLO into the backend as the primary detector, keeping classical CV as a fallback.

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
