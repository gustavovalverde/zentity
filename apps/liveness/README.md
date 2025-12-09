# Liveness Service

Privacy-preserving face verification service for zkKYC using DeepFace, FasNet, and UniFace.

## Overview

This service provides face detection, liveness verification, and face matching. All biometric data is processed transiently and NEVER stored.

## Technology

- **Language**: Python 3.11+
- **Framework**: FastAPI + Uvicorn
- **AI Models**:
  - DeepFace (ArcFace, Facenet512) - Face recognition
  - RetinaFace - Face detection
  - FasNet (MiniFASNet) - Anti-spoofing (requires PyTorch)
  - Emotion analysis - Smile/expression detection
  - UniFace - 106-point facial landmarks
- **Port**: 5003

## Privacy Guarantees

- All images processed in memory only
- Face embeddings extracted and immediately discarded
- No biometric templates stored
- Only boolean verification flags returned

## Endpoints

### Core Endpoints

#### `GET /health`
Service health check.

#### `POST /detect`
Detect faces in an image.

**Request:**
```json
{
  "image": "base64-encoded-image"
}
```

**Response:**
```json
{
  "face_count": 1,
  "faces": [{ "x": 100, "y": 50, "width": 200, "height": 200 }],
  "processing_time_ms": 45
}
```

#### `POST /liveness`
Full liveness check (detection + anti-spoofing).

**Response:**
```json
{
  "is_real": true,
  "antispoof_score": 0.85,
  "face_count": 1,
  "bounding_box": { "x": 100, "y": 50, "width": 200, "height": 200 },
  "processing_time_ms": 120
}
```

#### `POST /antispoof`
Anti-spoofing check only.

### Face Matching

#### `POST /face-match`
Compare faces between ID document and selfie.

**Request:**
```json
{
  "idImage": "base64-encoded-id",
  "selfieImage": "base64-encoded-selfie",
  "minConfidence": 0.6
}
```

**Response:**
```json
{
  "matched": true,
  "confidence": 0.73,
  "processing_time_ms": 250,
  "id_face_extracted": true
}
```

### Interactive Liveness

#### `POST /challenge/validate`
Validate liveness challenge (baseline vs challenge image).

**Request:**
```json
{
  "baselineImage": "base64-neutral-face",
  "challengeImage": "base64-smiling-face",
  "challengeType": "smile",
  "minEmotionChange": 20.0
}
```

#### `POST /smile-check`
Single-frame smile detection.

#### `POST /blink-check`
Eye blink detection using EAR (Eye Aspect Ratio).

### Head Pose Detection

#### `POST /head-pose`
Detect head orientation using 106-point facial landmarks.

**Request:**
```json
{
  "image": "base64-encoded-image",
  "resetSession": false
}
```

**Response:**
```json
{
  "yaw": 0.25,
  "pitch": -0.1,
  "direction": "right",
  "isTurningLeft": false,
  "isTurningRight": true,
  "leftTurnCompleted": false,
  "rightTurnCompleted": false,
  "faceDetected": true,
  "processingTimeMs": 45
}
```

#### `POST /head-turn-check`
Check if head is turned in a specific direction.

**Request:**
```json
{
  "image": "base64-encoded-image",
  "direction": "left",
  "threshold": 0.15
}
```

### Multi-Challenge Sessions

For multi-gesture liveness verification (smile + blink + head turns).

#### `POST /challenge/session`
Create a new multi-challenge session with randomized challenges.

**Request:**
```json
{
  "numChallenges": 2,
  "excludeChallenges": ["blink"],
  "requireHeadTurn": true
}
```

**Response:**
```json
{
  "sessionId": "abc123...",
  "challenges": ["turn_left", "smile"],
  "currentIndex": 0,
  "isComplete": false,
  "currentChallenge": {
    "challengeType": "turn_left",
    "index": 0,
    "total": 2,
    "title": "Turn Left",
    "instruction": "Turn your head to the left",
    "icon": "arrow-left",
    "timeoutSeconds": 8
  }
}
```

#### `POST /challenge/complete`
Mark a challenge as completed and get the next challenge.

**Request:**
```json
{
  "sessionId": "abc123...",
  "challengeType": "turn_left",
  "passed": true,
  "metadata": { "yaw": -0.25 }
}
```

#### `GET /challenge/session/{session_id}`
Get current state of a challenge session.

#### `POST /challenge/validate-multi`
Validate multiple challenges at once (batch mode).

**Request:**
```json
{
  "baselineImage": "base64-neutral-face",
  "challengeResults": [
    { "challenge_type": "smile", "image": "base64-smiling" },
    { "challenge_type": "turn_left", "image": "base64-turned-left" }
  ]
}
```

**Response:**
```json
{
  "allPassed": true,
  "totalChallenges": 2,
  "passedCount": 2,
  "results": [
    { "index": 0, "challengeType": "smile", "passed": true, "score": 75.5 },
    { "index": 1, "challengeType": "turn_left", "passed": true, "score": -0.28 }
  ],
  "processingTimeMs": 320
}
```

### Full Verification

#### `POST /verify`
Complete identity verification (liveness + face matching).

**Request:**
```json
{
  "idImage": "base64-encoded-id",
  "selfieImage": "base64-encoded-selfie",
  "antispoofThreshold": 0.3,
  "minFaceMatchConfidence": 0.4
}
```

**Response:**
```json
{
  "verified": true,
  "is_live": true,
  "antispoof_score": 0.85,
  "faces_match": true,
  "face_match_confidence": 0.73,
  "processing_time_ms": 500
}
```

## Development

### Prerequisites
- Python 3.10+
- pip

### Install
```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### Run
```bash
uvicorn app.main:app --port 5003 --reload
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5003 | Service port |
| `ANTISPOOF_THRESHOLD` | 0.3 | Default anti-spoofing threshold |
| `ZK_SERVICE_URL` | http://localhost:5002 | ZK service URL for proofs |

## Docker

```bash
docker build -t zentity-liveness-service .
docker run -p 5003:5003 zentity-liveness-service
```

## Anti-Spoofing

Uses FasNet to detect presentation attacks:
- Photos of photos
- Screen displays
- Printed masks
- Video replays

## Architecture

### Model Warmup Process

On container startup, the `entrypoint.sh` script warms up all ML models to avoid first-request latency. Due to TensorFlow/PyTorch compatibility issues, models are loaded in **separate Python processes**:

```
Step 1: TensorFlow models (ArcFace, Facenet512, Emotion)
Step 2: RetinaFace detector (TensorFlow)
Step 3: FasNet anti-spoofing (PyTorch CPU-only)
Step 4: UniFace models (ONNX)
```

This architecture prevents segmentation faults that occur when TensorFlow and PyTorch share memory in the same process.

### Docker Volumes

Model weights are persisted to avoid re-downloading on container restart:

```yaml
volumes:
  - deepface-weights:/root/.deepface/weights    # ~500MB
  - uniface-models:/root/.uniface/models        # ~50MB
```

### Dependencies

Key ML dependencies in `requirements.txt`:

| Package | Purpose |
|---------|---------|
| `deepface>=0.0.89` | Face recognition and analysis |
| `opencv-python-headless>=4.8.0` | Image processing |
| `tf-keras>=2.20.0` | TensorFlow backend for DeepFace |
| `torch` (CPU-only) | PyTorch for FasNet anti-spoofing |
| `uniface>=1.2.0` | 106-point facial landmarks |

### File Structure

```
apps/liveness/
├── app/
│   ├── main.py              # FastAPI endpoints
│   ├── blink_detection.py   # Eye Aspect Ratio (EAR) blink detection
│   ├── head_pose.py         # Head pose estimation (yaw/pitch)
│   ├── challenge_engine.py  # Multi-challenge session management
│   ├── facial_analysis.py   # Emotion detection (smile challenge)
│   ├── face_match.py        # Face comparison
│   ├── antispoof.py         # FasNet anti-spoofing
│   └── liveness.py          # Core liveness checks
├── entrypoint.sh            # Multi-step model warmup
├── requirements.txt
└── Dockerfile
```
