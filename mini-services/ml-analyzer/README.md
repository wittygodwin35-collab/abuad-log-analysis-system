# ML Analyzer Mini-Service

FastAPI service implementing the ABUAD methodology additions:

- Drain3 template parsing
- Isolation Forest anomaly scoring
- Training from a dedicated normal-log folder
- Unlabeled evaluation metrics for 300-500 samples

## Run locally

```bash
cd mini-services/ml-analyzer
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

### Environment variables

- `NORMAL_LOG_DIR` (default: `mini-services/ml-analyzer/data/normal`)
- `EVALUATION_DATASET_DIR` (used by the Next.js API before calling `/evaluate`)
- `ISOLATION_FOREST_CONTAMINATION` (default: `0.05`)

Training and evaluation require real log directories containing `.log`, `.txt`, or `.json` files. The files under `tests/fixtures` are intentionally small unit/smoke fixtures and should not be used as research evaluation data.
