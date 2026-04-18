# 🦐 ShrimpCount: Technical Handover Document

## 1. Project Vision
ShrimpCount is a field-ready tool designed for shrimp farmers to estimate populations from a bowl photo. It solves the unreliability of outdoor lighting by using a **Consensus Method** (Classical CV) while simultaneously building a dataset for a **Phase 2 AI upgrade** (YOLOv8).

## 2. System Architecture

### 🔵 Backend (Python / FastAPI)
- **Host:** Render.com (Free Tier)
- **Engine (`shrimp_engine.py`):**
  - **The Consensus Algorithm:** Runs 4 independent detection methods:
    1. `blob`: Uses OpenCV SimpleBlobDetector.
    2. `components_p97`: Connected components at 97th percentile threshold.
    3. `components_p98`: Connected components at 98th percentile threshold.
    4. `peaks`: Local maxima detection after Gaussian blurring.
  - **Final Logic:** Returns the **Median** of these 4 to cancel out noise from reflections or shadows.
  - **Confidence Flagging:** If the "spread" (max - min) is > 30% of the median, the result is flagged as **LOW confidence**.

### 🟠 Frontend (React / Vite / Tailwind v4)
- **Host:** Cloudflare Workers (Assets-only)
- **Key Logic:**
  - **Coordinate Math (Critical):** Since images use `object-fit: contain`, we calculate coordinates relative to the **rendered image boundaries**, not the container. This ensures that the circle you drag in the browser matches the pixels the Python backend sees.
  - **3-Step Flow:** `Input` -> `Detection Preview` -> `Manual Adjustment (Optional)` -> `Final Count`.

### ⚪️ Storage (Cloudflare R2)
- **Bucket:** `shrimpcount-images`
- **Logic:** Every POST to `/count` automatically backs up the compressed image and its JSON metrics. This is your "Gold Mine" for Phase 2 training.

---

## 3. The "Confirm Circle" Flow (Step-by-Step)
For a junior engineer, this is the most complex part of the code:
1. **`/detect`**: Fast pass to find the bowl using HoughCircles. Returns coordinates as percentages (0.0 to 1.0).
2. **Interactive SVG**: We draw a yellow circle over the image. If the user drags it, we update the state in the React app.
3. **`/count`**: We send the original file + the finalized coordinates. The backend skips its own detection and counts only within the user's circle.

---

## 4. Maintenance & Operations

### Deployment Gotchas
- **Render Cold Starts:** The free tier sleeps. Use a cron-job to ping `/health` every 14 mins.
- **OpenCV on Server:** Always use `opencv-python-headless`. The standard version requires GUI libraries that don't exist on Render/Docker.
- **Cloudflare Build:** The **Root Directory** must be set to `frontend`. The **Deploy Command** must be `npx wrangler deploy`.

### Environment Variables
**Backend (Render):**
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

**Frontend (Local):**
- `VITE_API_URL` (Points to `localhost:8000` for dev, Render for prod).

---

## 5. Junior Engineer Task List (Phase 2)
1. **Rectangle Mode:** The UI has a toggle for "Rectangle" mode. Currently, the backend ignores this. Your first task is to update `shrimp_engine.py` to support rectangular masking.
2. **Data Labeling:** Once the R2 bucket has 200+ images, download them and use **Roboflow** to label the shrimp heads.
3. **YOLO Integration:** Train a YOLOv8-nano model and create a new `/count_v2` endpoint that uses the `.pt` or `.onnx` model instead of classical CV.

---

## 6. Local Setup

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
