# Shrimp Counter

Small OpenCV-based tool to estimate shrimp count from a bowl photo, transitioning into a robust field-ready web application.

## 🚀 Live Project Links
- **Backend API:** [https://shrimp-count.onrender.com/health](https://shrimp-count.onrender.com/health)
- **Frontend App:** [https://shrimpcount.wanakorn-k.workers.dev](https://shrimpcount.wanakorn-k.workers.dev)

## 📝 Deployment Lessons Learned (Week 3)

### Backend (Render.com)
- **OpenCV Version:** Use `opencv-python-headless` instead of `opencv-python` to avoid GUI/display driver errors on server-side environments.
- **Port Binding:** Ensure `uvicorn` or `gunicorn` binds to `0.0.0.0` to be accessible externally.

### Frontend (Cloudflare Workers/Pages)
- **Root Directory:** When the React app is in a subdirectory (e.g., `/frontend`), set the **Path/Root Directory** in the dashboard to `frontend` so `npm` finds `package.json`.
- **Wrangler Configuration:** For "Assets-only" deployments:
  - Keep `wrangler.json` simple. **Do not** add `assets.binding = "ASSETS"` as it causes a ✘ [ERROR] in simple frontend-only setups.
  - **_redirects:** Be careful with wildcard redirects like `/* /index.html 200` in Workers; they can trigger infinite loop errors (Code 10021) if not handled by a specific routing Worker.
- **Build Settings:** 
  - **Build Command:** `npm run build`
  - **Deploy Command:** `npx wrangler deploy` (if using Workers Assets)
  - **Output Directory:** `dist`

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
