"""Image capture utility for conveyor belt scanning system.

Handles ROI extraction, sharpness scoring, and saving captured product images.
"""

import os
import base64

import cv2
import numpy as np


# Default captures directory relative to project root
CAPTURES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "captures")


def sharpness_score(image):
    """Compute sharpness score using Laplacian variance.

    Args:
        image: BGR numpy array

    Returns:
        float: Laplacian variance. Higher values indicate sharper images.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def extract_roi(frame, bbox, padding=0.15):
    """Extract region of interest from frame using normalized bounding box.

    Args:
        frame: BGR numpy array
        bbox: Tuple (x1, y1, x2, y2) with values normalized 0-1
        padding: Proportional padding to expand each side (default 0.15)

    Returns:
        numpy array: Cropped BGR image
    """
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = bbox

    # Calculate box dimensions for proportional padding
    box_w = x2 - x1
    box_h = y2 - y1
    pad_x = box_w * padding
    pad_y = box_h * padding

    # Apply padding and convert to pixel coordinates
    px1 = int(max(0, (x1 - pad_x) * w))
    py1 = int(max(0, (y1 - pad_y) * h))
    px2 = int(min(w, (x2 + pad_x) * w))
    py2 = int(min(h, (y2 + pad_y) * h))

    return frame[py1:py2, px1:px2]


def save_capture(frame, item_id, roi=None, captures_dir=None):
    """Save captured images to disk.

    Args:
        frame: Full BGR frame
        item_id: Unique identifier for the captured item
        roi: Optional cropped ROI image (BGR numpy array)
        captures_dir: Directory to save captures (default CAPTURES_DIR)

    Returns:
        dict: Paths to saved files {"full": path, "roi": path_or_None}
    """
    if captures_dir is None:
        captures_dir = CAPTURES_DIR

    os.makedirs(captures_dir, exist_ok=True)

    full_path = os.path.join(captures_dir, f"{item_id}_full.jpg")
    cv2.imwrite(full_path, frame)

    roi_path = None
    if roi is not None:
        roi_path = os.path.join(captures_dir, f"{item_id}_roi.jpg")
        cv2.imwrite(roi_path, roi)

    return {"full": full_path, "roi": roi_path}


def encode_jpeg(image, quality=85):
    """Encode numpy image to JPEG bytes.

    Args:
        image: BGR numpy array
        quality: JPEG quality 0-100 (default 85)

    Returns:
        bytes: JPEG-encoded image data
    """
    params = [cv2.IMWRITE_JPEG_QUALITY, quality]
    _, buf = cv2.imencode(".jpg", image, params)
    return buf.tobytes()


def encode_base64(image, quality=85):
    """Encode image to base64 string for WebSocket transmission.

    Args:
        image: BGR numpy array
        quality: JPEG quality 0-100 (default 85)

    Returns:
        str: Base64-encoded JPEG string
    """
    jpeg_bytes = encode_jpeg(image, quality)
    return base64.b64encode(jpeg_bytes).decode("utf-8")
