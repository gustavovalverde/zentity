"""
OCR Engine using RapidOCR with PPOCRv5.

Provides fast, CPU-optimized text extraction using ONNX runtime.
Supports Latin character recognition for Spanish text.
"""

import time
import base64
import io
import re
from typing import Optional

import numpy as np
from PIL import Image

from rapidocr import RapidOCR

# Global engine instance (singleton for performance)
_engine: Optional[RapidOCR] = None
_fast_engine: Optional[RapidOCR] = None

PASSPORT_MRZ_HINT_PATTERN = re.compile(r"P<[A-Z0-9]{3}", re.IGNORECASE)

# Fast engine settings for the MRZ region (trade accuracy for speed).
# For full-document OCR, keep RapidOCR defaults for better recall on small text.
FAST_OCR_ENGINE_PARAMS = {
    "Global.use_cls": False,
    "Global.max_side_len": 1280,
    "Det.limit_side_len": 384,
}


def get_engine() -> RapidOCR:
    """Get or create the RapidOCR engine singleton."""
    global _engine
    if _engine is None:
        _engine = RapidOCR()
    return _engine


def get_fast_engine() -> RapidOCR:
    """Get or create a tuned RapidOCR engine for MRZ-region OCR."""
    global _fast_engine
    if _fast_engine is None:
        _fast_engine = RapidOCR(params=FAST_OCR_ENGINE_PARAMS)
    return _fast_engine


def warmup_engine() -> None:
    """Warm up the OCR engine with a realistic document-sized image."""
    engine = get_engine()
    fast_engine = get_fast_engine()

    # Create document-sized image (passport-like aspect ratio ~1000x1400)
    # This ensures ONNX compiles kernels for real document sizes
    height, width = 1400, 1000
    dummy = np.ones((height, width, 3), dtype=np.uint8) * 255

    # Add text-like patterns (horizontal lines simulating text rows)
    for y in range(100, height - 100, 40):
        dummy[y : y + 8, 100 : width - 100] = 50  # Dark gray lines

    for ocr_engine in (engine, fast_engine):
        try:
            ocr_engine(dummy)
        except Exception:
            pass  # Ignore warmup errors


def crop_mrz_region(image: np.ndarray, *, start_ratio: float = 0.65) -> np.ndarray:
    """
    Crop the bottom portion of the image where passport MRZ lines typically are.

    Notes:
    - This is a heuristic fast path for passports (TD3 MRZ at the bottom).
    - For non-passports or rotated images, this may not contain MRZ; callers should
      fall back to full-image OCR when MRZ isn't detected.
    """
    height, width = image.shape[:2]
    if height < 200 or width < 200:
        return image

    start_y = int(height * start_ratio)
    if start_y <= 0 or start_y >= height:
        return image

    return image[start_y:, :, :]


def decode_base64_image(base64_string: str) -> np.ndarray:
    """Decode base64 image to numpy array (RGB)."""
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]

    image_bytes = base64.b64decode(base64_string)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(image)


def _extract_text(image: np.ndarray, engine: RapidOCR) -> dict:
    """
    Extract text from image using RapidOCR.

    Returns:
        dict with:
        - text_blocks: list of {text, confidence, bbox}
        - full_text: concatenated text
        - processing_time_ms: extraction time
    """
    start_time = time.time()

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


def extract_text(image: np.ndarray) -> dict:
    """Extract text from image using the default OCR engine."""
    return _extract_text(image, get_engine())


def extract_text_fast(image: np.ndarray) -> dict:
    """Extract text from image using a tuned OCR engine (MRZ fast path)."""
    return _extract_text(image, get_fast_engine())


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


def extract_document_text_from_base64(base64_image: str) -> dict:
    """
    Extract OCR text optimized for *document parsing* (not full-text extraction).

    Fast path:
    - Try OCR on a bottom-cropped region and short-circuit if it looks like a
      passport MRZ (saves substantial compute for passports).

    Fallback:
    - Run full-image OCR.

    This is intended for endpoints that extract structured fields (/ocr, /process),
    not the raw /extract endpoint.
    """
    try:
        image = decode_base64_image(base64_image)
    except Exception as e:
        return {
            "text_blocks": [],
            "full_text": "",
            "processing_time_ms": 0,
            "error": f"Failed to decode image: {str(e)}",
        }

    height, width = image.shape[:2]
    portrait_like = height / max(width, 1) > 1.1

    if portrait_like and height >= 500 and width >= 400:
        mrz_result = extract_text_fast(crop_mrz_region(image))
        mrz_text = (mrz_result.get("full_text") or "").strip()
        looks_like_mrz = (
            bool(PASSPORT_MRZ_HINT_PATTERN.search(mrz_text))
            and mrz_text.count("<") >= 10
            and len(mrz_text) >= 60
        )
        if mrz_text and not mrz_result.get("error") and looks_like_mrz:
            return mrz_result

    return extract_text(image)
