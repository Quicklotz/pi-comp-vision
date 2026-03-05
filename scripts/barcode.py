"""Barcode reader for conveyor belt scanning system.
Uses pyzbar with a 7-variant image enhancement pipeline.
"""

import cv2
import numpy as np

try:
    from pyzbar import pyzbar
except ImportError:
    raise ImportError(
        "pyzbar is not installed. Install it with:\n"
        "  pip install pyzbar\n"
        "On Raspberry Pi you also need the system library:\n"
        "  sudo apt-get install libzbar0"
    )


def enhance_variants(image):
    """Takes a BGR numpy array, returns list of up to 7 enhanced grayscale versions."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    variants = []

    # 1. Original grayscale
    variants.append(gray)

    # 2. CLAHE enhanced
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    variants.append(clahe.apply(gray))

    # 3. Adaptive threshold (gaussian)
    variants.append(
        cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                              cv2.THRESH_BINARY, 11, 2)
    )

    # 4. Otsu threshold
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(otsu)

    # 5. Sharpened (unsharp mask)
    blurred = cv2.GaussianBlur(gray, (0, 0), 3)
    sharpened = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)
    variants.append(sharpened)

    # 6. High contrast
    high_contrast = cv2.convertScaleAbs(gray, alpha=1.5, beta=0)
    variants.append(high_contrast)

    # 7. Inverted
    variants.append(255 - gray)

    return variants


def decode_barcode(image):
    """Decode a barcode from a BGR product ROI image.
    Returns dict with barcode, type, confidence or None.
    """
    variants = enhance_variants(image)

    for variant in variants:
        results = pyzbar.decode(variant)
        if results:
            result = results[0]
            return {
                "barcode": result.data.decode("utf-8", errors="replace"),
                "type": result.type,
                "confidence": 1.0,
            }

    return None


def decode_barcode_region(frame, bbox, padding=0.15):
    """Extract a padded ROI from frame using normalized bbox and decode.
    bbox: (x1, y1, x2, y2) normalized 0-1.
    Returns decode result dict or None.
    """
    h, w = frame.shape[:2]

    x1, y1, x2, y2 = bbox
    bw = x2 - x1
    bh = y2 - y1

    # Apply padding
    x1 = max(0.0, x1 - bw * padding)
    y1 = max(0.0, y1 - bh * padding)
    x2 = min(1.0, x2 + bw * padding)
    y2 = min(1.0, y2 + bh * padding)

    # Convert to pixel coordinates
    px1 = int(x1 * w)
    py1 = int(y1 * h)
    px2 = int(x2 * w)
    py2 = int(y2 * h)

    roi = frame[py1:py2, px1:px2]
    if roi.size == 0:
        return None

    return decode_barcode(roi)
