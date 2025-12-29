"""
OCR Engine using RapidOCR with PPOCRv5.

Provides fast, CPU-optimized text extraction using ONNX runtime.
Supports Latin character recognition for Spanish text.
"""

from __future__ import annotations

import base64
import functools
import io
import logging
import re
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image
from rapidocr import RapidOCR

logger = logging.getLogger(__name__)

PASSPORT_MRZ_HINT_PATTERN = re.compile(r"P<[A-Z0-9]{3}", re.IGNORECASE)

# Fast engine settings for the MRZ region (trade accuracy for speed).
# For full-document OCR, keep RapidOCR defaults for better recall on small text.
_FAST_OCR_ENGINE_PARAMS = {
    "Global.use_cls": False,
    "Global.max_side_len": 1280,
    "Det.limit_side_len": 384,
}


@dataclass(frozen=True)
class TextBlock:
    text: str
    confidence: float
    bbox: list


@dataclass(frozen=True)
class OCRResult:
    text_blocks: list[TextBlock]
    full_text: str
    processing_time_ms: int
    error: str | None = None


@functools.lru_cache(maxsize=1)
def get_engine() -> RapidOCR:
    """Get or create the RapidOCR engine singleton."""
    return RapidOCR()


@functools.lru_cache(maxsize=1)
def get_fast_engine() -> RapidOCR:
    """Get or create a tuned RapidOCR engine for MRZ-region OCR."""
    return RapidOCR(params=_FAST_OCR_ENGINE_PARAMS)


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
        except Exception as exc:
            logger.warning("OCR warmup failed: %s: %s", type(exc).__name__, exc)


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
        base64_string = base64_string.split(",", 1)[1]

    image_bytes = base64.b64decode(base64_string)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(image)


def _build_result(text_blocks: list[TextBlock], full_text: str, elapsed_ms: int) -> OCRResult:
    return OCRResult(
        text_blocks=text_blocks,
        full_text=full_text,
        processing_time_ms=elapsed_ms,
    )


def _extract_text(image: np.ndarray, engine: RapidOCR) -> OCRResult:
    """
    Extract text from image using RapidOCR.

    Returns:
        OCRResult with text blocks, concatenated text, and processing time.
    """
    start_time = time.time()

    try:
        result = engine(image)
        processing_time_ms = int((time.time() - start_time) * 1000)

        if result is None:
            return _build_result([], "", processing_time_ms)

        boxes = getattr(result, "boxes", None)
        txts = getattr(result, "txts", None)
        scores = getattr(result, "scores", None)

        if hasattr(boxes, "tolist"):
            boxes_list = boxes.tolist()
        else:
            boxes_list = boxes if boxes is not None else []
        txts_list = list(txts) if txts is not None else []
        if hasattr(scores, "tolist"):
            scores_list = scores.tolist()
        else:
            scores_list = list(scores) if scores is not None else []

        if not txts_list:
            return _build_result([], "", processing_time_ms)

        text_blocks: list[TextBlock] = []
        for i, text in enumerate(txts_list):
            bbox = boxes_list[i] if i < len(boxes_list) else []
            confidence = scores_list[i] if i < len(scores_list) else 0.0
            text_blocks.append(
                TextBlock(
                    text=text,
                    confidence=float(confidence) if confidence is not None else 0.0,
                    bbox=bbox if isinstance(bbox, list) else [],
                )
            )

        full_text = " ".join(txts_list)

        return _build_result(text_blocks, full_text, processing_time_ms)

    except Exception as exc:
        logger.error("OCR extraction failed: %s: %s", type(exc).__name__, exc)
        processing_time_ms = int((time.time() - start_time) * 1000)
        return OCRResult(
            text_blocks=[],
            full_text="",
            processing_time_ms=processing_time_ms,
            error=str(exc),
        )


def extract_text(image: np.ndarray) -> OCRResult:
    """Extract text from image using the default OCR engine."""
    return _extract_text(image, get_engine())


def extract_text_fast(image: np.ndarray) -> OCRResult:
    """Extract text from image using a tuned OCR engine (MRZ fast path)."""
    return _extract_text(image, get_fast_engine())


def extract_text_from_base64(base64_image: str) -> OCRResult:
    """Extract text from base64-encoded image."""
    try:
        image = decode_base64_image(base64_image)
        return extract_text(image)
    except Exception as exc:
        return OCRResult(
            text_blocks=[],
            full_text="",
            processing_time_ms=0,
            error=f"Failed to decode image: {exc}",
        )


def extract_document_text_from_base64(base64_image: str) -> OCRResult:
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
    except Exception as exc:
        return OCRResult(
            text_blocks=[],
            full_text="",
            processing_time_ms=0,
            error=f"Failed to decode image: {exc}",
        )

    height, width = image.shape[:2]
    portrait_like = height / max(width, 1) > 1.1

    if portrait_like and height >= 500 and width >= 400:
        mrz_result = extract_text_fast(crop_mrz_region(image))
        mrz_text = (mrz_result.full_text or "").strip()
        looks_like_mrz = (
            bool(PASSPORT_MRZ_HINT_PATTERN.search(mrz_text))
            and mrz_text.count("<") >= 10
            and len(mrz_text) >= 60
        )
        if mrz_text and not mrz_result.error and looks_like_mrz:
            return mrz_result

    return extract_text(image)
