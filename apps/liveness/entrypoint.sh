#!/bin/bash
# Don't use set -e so we can handle errors gracefully

echo "[Liveness] Warming up ML models..."

# Step 1: Load TensorFlow-based models first (DeepFace recognition + emotion)
python -c "
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # Reduce TF logging

import numpy as np
import cv2

# Create a proper test image
dummy = np.zeros((224, 224, 3), dtype=np.uint8)
cv2.circle(dummy, (112, 112), 50, (200, 200, 200), -1)

print('[Liveness] Step 1: Loading TensorFlow-based models...')
from deepface import DeepFace

# Load FACE RECOGNITION models
recognition_models = ['ArcFace', 'Facenet512']
for model_name in recognition_models:
    try:
        print(f'[Liveness] Loading recognition model: {model_name}')
        DeepFace.build_model(model_name)
        print(f'[Liveness] ✓ {model_name} loaded')
    except Exception as e:
        print(f'[Liveness] Warning: {model_name} load failed: {e}')

# Load EMOTION analysis model
print('[Liveness] Loading Emotion analysis model...')
try:
    DeepFace.analyze(
        dummy,
        actions=['emotion'],
        detector_backend='opencv',
        enforce_detection=False
    )
    print('[Liveness] ✓ Emotion model loaded')
except Exception as e:
    print(f'[Liveness] Emotion init note: {e}')

print('[Liveness] ✓ TensorFlow models loaded')
"

STEP1_STATUS=$?
if [ $STEP1_STATUS -ne 0 ]; then
    echo "[Liveness] Warning: TensorFlow model warmup had issues (exit code $STEP1_STATUS)"
fi

# Step 2: Load RetinaFace detector (separate process to avoid memory pressure)
python -c "
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

import numpy as np
import cv2

dummy = np.zeros((224, 224, 3), dtype=np.uint8)
cv2.circle(dummy, (112, 112), 50, (200, 200, 200), -1)

print('[Liveness] Step 2: Loading RetinaFace detector...')
from deepface import DeepFace

try:
    DeepFace.extract_faces(
        dummy,
        detector_backend='retinaface',
        enforce_detection=False,
        anti_spoofing=False  # Load without anti-spoofing first
    )
    print('[Liveness] ✓ RetinaFace detector loaded')
except Exception as e:
    print(f'[Liveness] RetinaFace init note: {e}')
"

STEP2_STATUS=$?
if [ $STEP2_STATUS -ne 0 ]; then
    echo "[Liveness] Warning: RetinaFace warmup had issues (exit code $STEP2_STATUS)"
fi

# Step 3: Load PyTorch-based anti-spoofing model (separate process)
python -c "
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

import numpy as np
import cv2

dummy = np.zeros((224, 224, 3), dtype=np.uint8)
cv2.circle(dummy, (112, 112), 50, (200, 200, 200), -1)

print('[Liveness] Step 3: Loading FasNet anti-spoofing model...')

try:
    # Import torch first to initialize it properly
    import torch
    print(f'[Liveness] PyTorch version: {torch.__version__}')

    from deepface import DeepFace
    DeepFace.extract_faces(
        dummy,
        detector_backend='opencv',  # Use lightweight detector
        enforce_detection=False,
        anti_spoofing=True
    )
    print('[Liveness] ✓ FasNet anti-spoofing loaded')
except ImportError:
    print('[Liveness] Note: PyTorch not available, anti-spoofing disabled')
except Exception as e:
    print(f'[Liveness] Anti-spoofing init note: {e}')
"

STEP3_STATUS=$?
if [ $STEP3_STATUS -ne 0 ]; then
    echo "[Liveness] Warning: Anti-spoofing warmup had issues (exit code $STEP3_STATUS)"
fi

# Step 4: Load UniFace models (separate process)
python -c "
import numpy as np
import cv2

dummy = np.zeros((224, 224, 3), dtype=np.uint8)
cv2.circle(dummy, (112, 112), 50, (200, 200, 200), -1)

print('[Liveness] Step 4: Loading UniFace models...')
from uniface import RetinaFace, Landmark106
detector = RetinaFace()
landmarker = Landmark106()
detector.detect(dummy)
print('[Liveness] ✓ UniFace models loaded')
"

STEP4_STATUS=$?
if [ $STEP4_STATUS -ne 0 ]; then
    echo "[Liveness] Warning: UniFace warmup had issues (exit code $STEP4_STATUS)"
fi

echo "[Liveness] Model warmup complete"

echo "[Liveness] Starting uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-5003}"
