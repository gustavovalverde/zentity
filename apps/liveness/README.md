# Liveness Service

Privacy-preserving face verification service for zkKYC using DeepFace, FasNet, and UniFace.

## Overview

This service provides face detection, liveness verification, and face matching. All biometric data is processed transiently and NEVER stored.

## Technology

- **Language**: Python 3.10+
- **Framework**: FastAPI
- **AI Models**: DeepFace, FasNet (anti-spoofing), UniFace (landmarks)
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

#### `POST /face-match-proof`
Face matching with ZK proof generation.

**Response:**
```json
{
  "matched": true,
  "confidence": 0.73,
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["60", "1"],
  "proofIsMatch": true,
  "proofThreshold": 0.6,
  "proofGenerationTimeMs": 120,
  "solidityCalldata": "0x..."
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

#### `POST /passive-monitor`
Analyze multiple frames for passive liveness indicators.

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
