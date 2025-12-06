#!/bin/bash
set -e

echo "[OCR] Warming up RapidOCR engine..."

# Warm up RapidOCR before starting the server
python -c "
from app.ocr import warmup_engine
warmup_engine()
print('[OCR] RapidOCR engine warmed up successfully')
"

echo "[OCR] Starting uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-5004}"
