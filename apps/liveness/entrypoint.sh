#!/bin/bash
set -e

echo "[Liveness] Warming up ML models..."

# Warm up DeepFace and UniFace models before starting the server
python -c "
import numpy as np

# Warm up DeepFace (face detection + anti-spoofing)
print('[Liveness] Loading DeepFace models...')
from deepface import DeepFace
dummy = np.zeros((100, 100, 3), dtype=np.uint8)
try:
    DeepFace.extract_faces(dummy, enforce_detection=False, anti_spoofing=True)
except:
    pass  # Expected to fail on dummy image, but models are loaded
print('[Liveness] DeepFace models loaded')

# Explicitly download key DeepFace backbones used later (avoids runtime downloads)
for model_name in ['RetinaFace', 'ArcFace', 'Facenet512', 'Emotion']:
    try:
        print(f'[Liveness] Preloading model: {model_name}')
        DeepFace.build_model(model_name)
    except Exception as e:
        print(f'[Liveness] Warning: could not preload {model_name}: {e}')

# Warm up UniFace models (face detection + landmarks)
print('[Liveness] Loading UniFace models...')
from uniface import RetinaFace, Landmark106
detector = RetinaFace()
landmarker = Landmark106()
detector.detect(dummy)
print('[Liveness] UniFace models loaded')

print('[Liveness] All models warmed up successfully')
"

echo "[Liveness] Starting uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-5003}"
