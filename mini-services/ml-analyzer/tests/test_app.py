from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import joblib
from fastapi import HTTPException

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

import app as ml_app  # noqa: E402


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


class MlAnalyzerTests(unittest.TestCase):
    def test_normalization_tokenization_and_timestamp(self) -> None:
        line = "Jan 15 08:23:45 server sshd[12345]: Failed password from 192.168.1.50 port 22"

        normalized = ml_app._normalize_text(line)
        tokens = ml_app._tokenize(normalized)
        timestamp = ml_app._parse_timestamp(line)

        self.assertIn("<ip>", normalized)
        self.assertIn("<num>", normalized)
        self.assertIn("failed", tokens)
        self.assertIsNotNone(timestamp)
        self.assertTrue(timestamp.endswith("+00:00"))

    def test_training_requires_enough_lines(self) -> None:
        with self.assertRaisesRegex(ValueError, "At least 20 log lines"):
            ml_app._train_isolation_forest(["one", "two"])

    def test_training_and_anomaly_scoring_with_fixture_data(self) -> None:
        lines = ml_app._read_lines_from_dir(str(FIXTURE_DIR / "normal"))
        model, vectorizer = ml_app._train_isolation_forest(lines)

        with tempfile.TemporaryDirectory() as tmp:
            original_model_path = ml_app.MODEL_PATH
            original_vectorizer_path = ml_app.VECTORIZER_PATH
            try:
                ml_app.MODEL_PATH = Path(tmp) / "model.joblib"
                ml_app.VECTORIZER_PATH = Path(tmp) / "vectorizer.joblib"
                joblib.dump(model, ml_app.MODEL_PATH)
                joblib.dump(vectorizer, ml_app.VECTORIZER_PATH)

                parsed_entries, templates, _ = ml_app._analyze_lines(
                    [
                        "Jan 15 10:00:00 server sshd[9999]: Accepted password for alice from 10.0.0.10 port 22",
                        "Jan 15 10:01:00 server nginx[9999]: 203.0.113.99 - - \"GET /../../../etc/passwd HTTP/1.1\" 403",
                    ],
                    source="test",
                )
            finally:
                ml_app.MODEL_PATH = original_model_path
                ml_app.VECTORIZER_PATH = original_vectorizer_path

        self.assertEqual(len(parsed_entries), 2)
        self.assertGreaterEqual(len(templates), 1)
        self.assertTrue(all(entry["detector"] == "isolation_forest" for entry in parsed_entries))
        self.assertTrue(all(entry["anomalyScore"] is not None for entry in parsed_entries))

    def test_evaluation_enforces_requested_sample_minimum(self) -> None:
        with self.assertRaises(HTTPException) as context:
            ml_app.evaluate(
                ml_app.EvaluateRequest(
                    datasetDir=str(FIXTURE_DIR / "evaluation"),
                    sampleMin=300,
                    sampleMax=500,
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("below the requested minimum", context.exception.detail)

    def test_evaluation_runs_for_explicit_smoke_sample_window(self) -> None:
        result = ml_app.evaluate(
            ml_app.EvaluateRequest(
                datasetDir=str(FIXTURE_DIR / "evaluation"),
                sampleMin=5,
                sampleMax=8,
            )
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["metrics"]["sampleCount"], 8)
        self.assertEqual(result["metrics"]["sampleWindowTarget"], {"min": 5, "max": 8})


if __name__ == "__main__":
    unittest.main()
