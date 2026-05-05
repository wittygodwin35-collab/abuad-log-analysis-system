from __future__ import annotations

import json
import os
import random
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from drain3 import TemplateMiner
from drain3.file_persistence import FilePersistence
from drain3.template_miner_config import TemplateMinerConfig
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.ensemble import IsolationForest
from sklearn.feature_extraction.text import TfidfVectorizer


BASE_DIR = Path(__file__).resolve().parent
STATE_DIR = BASE_DIR / "state"
STATE_DIR.mkdir(parents=True, exist_ok=True)

MODEL_PATH = STATE_DIR / "isolation_forest.joblib"
VECTORIZER_PATH = STATE_DIR / "vectorizer.joblib"
MODEL_META_PATH = STATE_DIR / "model_meta.json"
TEMPLATE_STATE_PATH = STATE_DIR / "drain3_state.bin"
TEMPLATE_CONFIG_PATH = BASE_DIR / "drain3.ini"

DEFAULT_NORMAL_LOG_DIR = os.getenv("NORMAL_LOG_DIR", str(BASE_DIR / "data" / "normal"))
DEFAULT_CONTAMINATION = float(os.getenv("ISOLATION_FOREST_CONTAMINATION", "0.05"))

SUPPORTED_DATASET_EXTENSIONS = {".log", ".txt", ".json"}

SYSLOG_TIMESTAMP_RE = re.compile(r"^(?P<ts>[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})")
APACHE_TIMESTAMP_RE = re.compile(r"\[(?P<ts>\d{1,2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4})\]")
ISO_TIMESTAMP_RE = re.compile(
    r"(?P<ts>\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)"
)


class AnalyzeRequest(BaseModel):
    content: str = Field(..., min_length=1)
    logType: str | None = None
    source: str = "upload"
    logFileId: str | None = None


class TrainRequest(BaseModel):
    normalLogDir: str | None = None
    maxSamples: int | None = Field(default=2000, gt=0)


class EvaluateRequest(BaseModel):
    datasetDir: str
    sampleMin: int = Field(default=300, gt=0)
    sampleMax: int = Field(default=500, gt=0)


def _load_template_miner() -> TemplateMiner:
    config = TemplateMinerConfig()
    config.load(str(TEMPLATE_CONFIG_PATH))
    persistence = FilePersistence(str(TEMPLATE_STATE_PATH))
    return TemplateMiner(config=config, persistence_handler=persistence)


template_miner = _load_template_miner()


def _read_model_meta() -> dict[str, Any]:
    if not MODEL_META_PATH.exists():
        return {}
    try:
        return json.loads(MODEL_META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_model_meta(meta: dict[str, Any]) -> None:
    MODEL_META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _load_model_bundle() -> tuple[IsolationForest | None, TfidfVectorizer | None]:
    if not MODEL_PATH.exists() or not VECTORIZER_PATH.exists():
        return None, None
    try:
        model = joblib.load(MODEL_PATH)
        vectorizer = joblib.load(VECTORIZER_PATH)
        return model, vectorizer
    except Exception:
        return None, None


def _normalize_text(text: str) -> str:
    normalized = text.strip()
    normalized = re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "<IP>", normalized)
    normalized = re.sub(r"\b[0-9a-fA-F]{8,}\b", "<HEX>", normalized)
    normalized = re.sub(r"\b\d+\b", "<NUM>", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.lower()


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9_./:-]+", text.lower())


def _parse_timestamp(raw_line: str) -> str | None:
    iso_match = ISO_TIMESTAMP_RE.search(raw_line)
    if iso_match:
        value = iso_match.group("ts").replace(" ", "T")
        if value.endswith("Z"):
            return value
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass

    apache_match = APACHE_TIMESTAMP_RE.search(raw_line)
    if apache_match:
        try:
            parsed = datetime.strptime(apache_match.group("ts"), "%d/%b/%Y:%H:%M:%S %z")
            return parsed.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass

    syslog_match = SYSLOG_TIMESTAMP_RE.search(raw_line)
    if syslog_match:
        try:
            year = datetime.now(tz=timezone.utc).year
            parsed = datetime.strptime(f"{year} {syslog_match.group('ts')}", "%Y %b %d %H:%M:%S")
            parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.isoformat()
        except ValueError:
            pass

    return None


def _severity_from_score(score: float) -> str:
    if score >= 0.22:
        return "critical"
    if score >= 0.14:
        return "high"
    if score >= 0.08:
        return "medium"
    return "low"


def _read_lines_from_dir(directory: str, max_samples: int | None = None) -> list[str]:
    root = Path(directory)
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Directory does not exist: {directory}")

    lines: list[str] = []
    for file in sorted(root.rglob("*")):
        if not file.is_file():
            continue
        if file.suffix.lower() not in SUPPORTED_DATASET_EXTENSIONS:
            continue
        try:
            content = file.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for line in content.splitlines():
            if line.strip():
                lines.append(line.strip())
                if max_samples is not None and len(lines) >= max_samples:
                    return lines
    return lines


def _train_isolation_forest(lines: list[str]) -> tuple[IsolationForest, TfidfVectorizer]:
    if len(lines) < 20:
        raise ValueError("At least 20 log lines are required to train the model.")

    normalized = [_normalize_text(line) for line in lines if line.strip()]
    vectorizer = TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=1)
    matrix = vectorizer.fit_transform(normalized)

    model = IsolationForest(
        contamination=DEFAULT_CONTAMINATION,
        n_estimators=200,
        random_state=42,
    )
    model.fit(matrix)
    return model, vectorizer


def _analyze_lines(
    lines: list[str],
    source: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    parsed_entries: list[dict[str, Any]] = []
    template_counter: Counter[tuple[str, str]] = Counter()

    for line_number, raw_line in enumerate(lines, start=1):
        if not raw_line.strip():
            continue

        normalized = _normalize_text(raw_line)
        tokens = _tokenize(normalized)
        timestamp = _parse_timestamp(raw_line)

        mined = template_miner.add_log_message(normalized)
        template_id = str(mined.get("cluster_id")) if mined.get("cluster_id") is not None else None
        template_text = mined.get("template_mined")
        if template_id or template_text:
            template_counter[(template_id or "", template_text or "")] += 1

        parsed_entries.append(
            {
                "lineNumber": line_number,
                "timestamp": timestamp,
                "source": source,
                "rawLine": raw_line,
                "normalizedText": normalized,
                "tokens": tokens,
                "templateId": template_id,
                "templateText": template_text,
                "anomalyScore": None,
                "anomalyFlag": False,
                "detector": None,
                "metadata": {
                    "changeType": mined.get("change_type"),
                    "clusterSize": mined.get("cluster_size"),
                },
            }
        )

    model, vectorizer = _load_model_bundle()
    ml_anomalies: list[dict[str, Any]] = []

    if model is not None and vectorizer is not None and parsed_entries:
        matrix = vectorizer.transform([entry["normalizedText"] for entry in parsed_entries])
        predictions = model.predict(matrix)
        decision_scores = model.decision_function(matrix)

        for idx, entry in enumerate(parsed_entries):
            anomaly_score = float(-decision_scores[idx])
            anomaly_flag = bool(predictions[idx] == -1)
            entry["anomalyScore"] = anomaly_score
            entry["anomalyFlag"] = anomaly_flag
            entry["detector"] = "isolation_forest"

            if anomaly_flag:
                ml_anomalies.append(
                    {
                        "lineNumber": entry["lineNumber"],
                        "timestamp": entry["timestamp"],
                        "source": source,
                        "rawLine": entry["rawLine"],
                        "templateId": entry["templateId"],
                        "templateText": entry["templateText"],
                        "anomalyScore": anomaly_score,
                        "anomalyFlag": anomaly_flag,
                        "detector": "isolation_forest",
                        "severity": _severity_from_score(anomaly_score),
                    }
                )

    templates_summary = [
        {
            "templateId": template_id or None,
            "templateText": template_text or None,
            "count": count,
        }
        for (template_id, template_text), count in template_counter.most_common()
    ]

    return parsed_entries, templates_summary, ml_anomalies


app = FastAPI(title="ABUAD ML Analyzer Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    model, vectorizer = _load_model_bundle()
    return {
        "status": "ok",
        "modelLoaded": model is not None and vectorizer is not None,
        "modelMeta": _read_model_meta(),
        "stateDir": str(STATE_DIR),
        "modelArtifactsPresent": MODEL_PATH.exists() and VECTORIZER_PATH.exists(),
        "drain3StatePresent": TEMPLATE_STATE_PATH.exists(),
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }


@app.post("/train")
def train(request: TrainRequest) -> dict[str, Any]:
    normal_dir = request.normalLogDir or DEFAULT_NORMAL_LOG_DIR
    max_samples = request.maxSamples if request.maxSamples and request.maxSamples > 0 else None

    try:
        lines = _read_lines_from_dir(normal_dir, max_samples=max_samples)
    except FileNotFoundError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if not lines:
        raise HTTPException(
            status_code=400,
            detail=f"No usable .log/.txt/.json lines found in normalLogDir: {normal_dir}",
        )

    try:
        model, vectorizer = _train_isolation_forest(lines)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    joblib.dump(model, MODEL_PATH)
    joblib.dump(vectorizer, VECTORIZER_PATH)

    trained_at = datetime.now(tz=timezone.utc).isoformat()
    model_version = f"iforest-{datetime.now(tz=timezone.utc).strftime('%Y%m%d%H%M%S')}"
    meta = {
        "modelVersion": model_version,
        "trainedAt": trained_at,
        "trainedSamples": len(lines),
        "normalLogDir": normal_dir,
        "contamination": DEFAULT_CONTAMINATION,
    }
    _write_model_meta(meta)

    return {
        "success": True,
        "trainedSamples": len(lines),
        "modelVersion": model_version,
        "trainedAt": trained_at,
    }


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    lines = [line for line in request.content.splitlines() if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="No usable log lines were provided for analysis.")

    parsed_entries, templates_summary, ml_anomalies = _analyze_lines(lines=lines, source=request.source)

    return {
        "logType": request.logType,
        "parsedEntries": parsed_entries,
        "templatesSummary": templates_summary,
        "mlAnomalies": ml_anomalies,
        "meta": {
            "modelMeta": _read_model_meta(),
            "processedLines": len(parsed_entries),
            "detector": "isolation_forest",
        },
    }


@app.post("/evaluate")
def evaluate(request: EvaluateRequest) -> dict[str, Any]:
    if request.sampleMin <= 0 or request.sampleMax <= 0 or request.sampleMin > request.sampleMax:
        raise HTTPException(status_code=400, detail="sampleMin/sampleMax values are invalid.")

    lines = _read_lines_from_dir(request.datasetDir)
    if not lines:
        raise HTTPException(
            status_code=400,
            detail=f"No usable .log/.txt/.json lines found in datasetDir: {request.datasetDir}",
        )
    if len(lines) < request.sampleMin:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Evaluation dataset has {len(lines)} usable log lines, "
                f"below the requested minimum of {request.sampleMin}."
            ),
        )

    random.seed(42)
    if len(lines) > request.sampleMax:
        sampled_lines = random.sample(lines, request.sampleMax)
    else:
        sampled_lines = lines

    parsed_entries, templates_summary, ml_anomalies = _analyze_lines(sampled_lines, source="evaluation")
    scores = [entry["anomalyScore"] for entry in parsed_entries if entry["anomalyScore"] is not None]

    quantiles: dict[str, float | None] = {
        "p25": None,
        "p50": None,
        "p75": None,
        "p95": None,
    }
    if scores:
        quantile_values = np.quantile(np.array(scores), [0.25, 0.5, 0.75, 0.95])
        quantiles = {
            "p25": float(quantile_values[0]),
            "p50": float(quantile_values[1]),
            "p75": float(quantile_values[2]),
            "p95": float(quantile_values[3]),
        }

    metrics = {
        "datasetDir": request.datasetDir,
        "availableSamples": len(lines),
        "sampleCount": len(sampled_lines),
        "sampleWindowTarget": {"min": request.sampleMin, "max": request.sampleMax},
        "templateCount": len(templates_summary),
        "anomalyCount": len(ml_anomalies),
        "anomalyRate": (len(ml_anomalies) / len(sampled_lines)) if sampled_lines else 0.0,
        "scoreQuantiles": quantiles,
    }

    return {
        "success": True,
        "metrics": metrics,
        "templatesSummary": templates_summary,
        "evaluatedAt": datetime.now(tz=timezone.utc).isoformat(),
    }
