"""
OCR Engine using RapidOCR with PPOCRv5.

Provides fast, CPU-optimized text extraction using ONNX runtime.
Supports Latin character recognition for Spanish text.
"""

import time
import base64
import io
from typing import Optional

import numpy as np
from PIL import Image

from rapidocr import RapidOCR

# Global engine instance (singleton for performance)
_engine: Optional[RapidOCR] = None


def get_engine() -> RapidOCR:
    """Get or create the RapidOCR engine singleton."""
    global _engine
    if _engine is None:
        _engine = RapidOCR()
    return _engine


def warmup_engine() -> None:
    """Warm up the OCR engine with a dummy image."""
    engine = get_engine()
    # Create a small dummy image
    dummy = np.zeros((100, 100, 3), dtype=np.uint8)
    dummy.fill(255)  # White image
    try:
        engine(dummy)
    except Exception:
        pass  # Ignore warmup errors


def decode_base64_image(base64_string: str) -> np.ndarray:
    """Decode base64 image to numpy array (RGB)."""
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]

    image_bytes = base64.b64decode(base64_string)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(image)


def extract_text(image: np.ndarray) -> dict:
    """
    Extract text from image using RapidOCR.

    Returns:
        dict with:
        - text_blocks: list of {text, confidence, bbox}
        - full_text: concatenated text
        - processing_time_ms: extraction time
    """
    start_time = time.time()
    engine = get_engine()

    try:
        result = engine(image)
        processing_time_ms = int((time.time() - start_time) * 1000)

        # RapidOCR 3.x returns RapidOCROutput object with .boxes, .txts, .scores
        if result is None:
            return {
                "text_blocks": [],
                "full_text": "",
                "processing_time_ms": processing_time_ms,
            }

        # Access attributes from RapidOCROutput
        boxes = getattr(result, "boxes", None)
        txts = getattr(result, "txts", None)
        scores = getattr(result, "scores", None)

        # Convert to lists, handling None and numpy arrays
        boxes_list = boxes.tolist() if hasattr(boxes, "tolist") else (boxes if boxes is not None else [])
        txts_list = list(txts) if txts is not None else []
        scores_list = scores.tolist() if hasattr(scores, "tolist") else (list(scores) if scores is not None else [])

        if not txts_list:
            return {
                "text_blocks": [],
                "full_text": "",
                "processing_time_ms": processing_time_ms,
            }

        text_blocks = []
        for i, text in enumerate(txts_list):
            bbox = boxes_list[i] if i < len(boxes_list) else []
            confidence = scores_list[i] if i < len(scores_list) else 0.0
            text_blocks.append(
                {
                    "text": text,
                    "confidence": float(confidence) if confidence is not None else 0.0,
                    "bbox": bbox if isinstance(bbox, list) else [],
                }
            )

        full_text = " ".join(txts_list)

        return {
            "text_blocks": text_blocks,
            "full_text": full_text,
            "processing_time_ms": processing_time_ms,
        }

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "text_blocks": [],
            "full_text": "",
            "processing_time_ms": processing_time_ms,
            "error": str(e),
        }


def extract_text_from_base64(base64_image: str) -> dict:
    """Extract text from base64-encoded image."""
    try:
        image = decode_base64_image(base64_image)
        return extract_text(image)
    except Exception as e:
        return {
            "text_blocks": [],
            "full_text": "",
            "processing_time_ms": 0,
            "error": f"Failed to decode image: {str(e)}",
        }
