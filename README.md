# 🦐 ShrimpCount: Technical Handover Document

## 1. Project Vision
ShrimpCount is a field-ready tool designed for shrimp farmers to estimate populations from a bowl photo. It solves the unreliability of outdoor lighting by using a **Consensus Method** (Classical CV) while simultaneously building a dataset for a **Phase 2 AI upgrade** (YOLOv8).

---

## 2. Current Status (As of April 19, 2026)

| Component | Status | Notes |
|---|---|---|
| Backend API | ✅ Live | https://shrimp-count.onrender.com |
| Frontend | ✅ Live | https://shrimpcount.wanakorn-k.workers.dev |
| R2 Storage | ✅ Active | Saving every count to `shrimpcount-images` bucket |
| Keep-Alive | ✅ Active | cron-job.org pinging `/health` every 10 minutes |
| Friend Testing | ✅ Started | Real field photos being collected |

---

## 3. System Architecture

### 🔵 Backend (Python / FastAPI)
- **Host:** Render.com (Free Tier)
- **Engine (`shrimp_engine.py`):**
  - **The Consensus Algorithm:** Runs 4 independent detection methods:
    1. `blob`: Uses OpenCV SimpleBlobDetector.
    2. `components_p97`: Connected components at 97th percentile threshold.
    3. `components_p98`: Connected components at 98th percentile threshold.
    4. `peaks`: Local maxima detection after Gaussian blurring.
  - **Final Logic:** Returns the **Median** of these 4 to cancel out noise from reflections or shadows.
  - **Confidence Flagging:** If the "spread" (max - min) is > 30% of the median → **LOW**, > 15% → **MEDIUM**, else → **HIGH**.

### 🟠 Frontend (React / Vite / Tailwind)
- **Host:** Cloudflare Workers (Static Assets)
- **3-Step Counting Flow:**
  1. `Input` → Camera capture or file upload
  2. `Detection Preview` → `/detect` endpoint finds bowl, shows yellow circle
  3. `Confirm` → User picks: **Looks Good** / **Adjust** / **Try Again**
  4. `Manual Adjust` (optional) → Drag to move, +/- buttons to resize
  5. `Final Count` → Result with confidence badge + method breakdown

- **Known Issue — Letterboxing Coordinates:** The manual adjust circle coordinates use `imageRef.current.getBoundingClientRect()` to account for `object-fit: contain` letterboxing. This fix was attempted but caused the result screen to go blank (Gemini accidentally deleted `getConfidenceStyles`). **Reverted to commit `78b5e95`**. The coordinate precision fix should be retried carefully — only modify `handleAdjustStart`, do not touch any other functions.

### ⚪️ Storage (Cloudflare R2)
- **Bucket:** `shrimpcount-images`
- **Structure:**
  - `images/{timestamp}_{uuid}.jpg` — compressed input photo
  - `metrics/{timestamp}_{uuid}.json` — count results + method breakdown
- **Purpose:** Every count automatically builds the YOLO training dataset.

---

## 4. The "Confirm Circle" Flow (Step-by-Step)
For a junior engineer, this is the most complex part of the code:
1. **`/detect`**: Fast pass to find the bowl using `HoughCircles`. Supports 3 sensitivity attempts (`param2`: 30, 22, 15). Returns coordinates as percentages (0.0 to 1.0).
2. **Interactive SVG**: Yellow circle drawn over preview image. User can drag to reposition or use +/- buttons to resize.
3. **`/count`**: Receives original file + finalized coordinates (`cx_pct`, `cy_pct`, `r_pct`). If coordinates provided, skips auto-detection and counts only within user-defined area.

---

## 5. Maintenance & Operations

### Deployment Gotchas
- **Render Cold Starts:** Prevented by cron-job.org pinging `/health` every 10 minutes.
- **OpenCV on Server:** Always use `opencv-python-headless`. Standard version requires GUI libraries unavailable on Render.
- **Cloudflare Build:** Root Directory = `frontend`. Deploy Command = `npx wrangler deploy`.
- **R2 Credentials:** Use **Account API Token** (not User API Token) for production. Account ID is the hex string in the Cloudflare dashboard URL — do NOT include `https://`.

### Environment Variables
**Backend (Render):**
- `R2_ACCOUNT_ID` — hex string only, e.g. `a13c9f6aa929...`
- `R2_ACCESS_KEY_ID` — from Cloudflare R2 Account API Token
- `R2_SECRET_ACCESS_KEY` — shown only once at creation
- `R2_BUCKET_NAME` — `shrimpcount-images`

**Frontend (Local `.env`):**
- `VITE_API_URL=http://localhost:8000`

**Frontend (Production `.env.production`):**
- `VITE_API_URL=https://shrimp-count.onrender.com`

---

## 6. Known Limitations (Classical CV Phase)

These are expected weaknesses until YOLO Phase 2:

- **Post-Larvae (PL) Shrimp:** Very small, translucent shrimp consistently return LOW confidence. The engine detects dark eye/body spots, not whole shrimp bodies.
- **Circle Detection Failures:** `HoughCircles` sometimes detects the outer tub instead of the inner bowl. The 3-attempt retry helps but is not 100% reliable.
- **Outdoor Lighting:** Harsh sunlight or deep shadows increase spread between methods → LOW confidence. Best results in shade.
- **Watermarks/Text:** Thai text watermarks in photos are counted as dark blobs. Tell users to keep watermarks outside the counting circle.

---

## 7. Phase 2 Roadmap (Next Steps)

### Immediate (Next Session)
- [ ] Retry letterboxing coordinate fix — only modify `handleAdjustStart` in `App.jsx`, preserve all other functions
- [ ] Remove debug display (`X:% Y:% R:%`) from Manual Adjust screen once coordinate fix is confirmed working
- [ ] Ask friend to take 200+ varied photos (different lighting, bowl colors, shrimp density)

### When 200+ Photos in R2
- [ ] Download all images from R2 bucket
- [ ] Label shrimp in **Roboflow** (free tier, web-based tool)
- [ ] Train YOLOv8-nano on **Google Colab** (free GPU)
- [ ] Add `/count_v2` endpoint to `api.py` using trained ONNX model
- [ ] Keep classical CV as fallback if YOLO confidence < 0.6

### Future Features
- [ ] **Rectangle Mode:** UI toggle exists, backend ignores it. Add rectangular masking to `shrimp_engine.py`
- [ ] **PDF Report:** Generate downloadable count report with GPS, timestamp, and overlay image
- [ ] **Recount with Adjusted Circle:** After seeing result, allow user to go back and adjust circle without re-uploading

---

## 8. Local Setup

### Backend
```bash
cd shrimp_count
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn api:app --reload --port 8000
```

### Frontend
```bash
cd shrimp_count/frontend
npm install
npm run dev
```

### Both Running Together
- Backend: http://localhost:8000
- Frontend: http://localhost:5173
- Test health: http://localhost:8000/health → should return `{"status":"ok"}`

---

## 9. Git History Reference

| Commit | Description | Status |
|---|---|---|
| `78b5e95` | Working version with manual adjust + R2 | ✅ Use this as stable base |
| Latest | Letterboxing fix attempt | ⚠️ Broke result screen, reverted |

To revert to stable base if needed:
```bash
git checkout 78b5e95 -- frontend/src/App.jsx
git commit -m "Revert to stable version"
git push origin main
```