# Shrimp Counter

Small OpenCV-based tool to estimate shrimp count from a bowl photo.

## Files

- `count_shrimp.py`: main counting script
- `requirements.txt`: Python dependencies
- `outputs/`: generated overlays and metrics

## What It Does

The script:

1. Detects the bowl area.
2. Masks the inside water region.
3. Tries several shrimp-head counting methods.
4. Uses the median of those methods as the final estimate.
5. Saves an overlay image and a JSON metrics file.

## Setup

Use Python 3.11+ or newer.

### Windows PowerShell

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

If `python` is not on `PATH`, use the full interpreter path instead.

## Run

```powershell
python count_shrimp.py "Image (4).jpg"
```

Optional:

```powershell
python count_shrimp.py "Image (4).jpg" --target-size 1600 --mask-shrink 0.88
```

## Output

The script writes:

- `outputs/<image>_overlay.jpg`
- `outputs/<image>_metrics.json`

## How To Share With A Co-Worker

Recommended:

1. Put these files in a Git repository.
2. Commit `count_shrimp.py`, `requirements.txt`, and this `README.md`.
3. Do not commit `outputs/` or `.venv/`.
4. Ask your co-worker to clone the repo and run the setup commands above.

Simple manual transfer:

1. Zip the project folder.
2. Send the zip file.
3. Your co-worker extracts it.
4. They create a virtual environment and install from `requirements.txt`.

## Development Notes

- The current estimator is approximate, not exact.
- Best results come from top-down photos with even lighting.
- The easiest next improvement is tuning the detector with a few manually counted sample images.
