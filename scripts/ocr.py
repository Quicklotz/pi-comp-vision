"""Label OCR and identifier parsing for Pi conveyor belt scanning."""

import re
import logging
from dataclasses import dataclass, field

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Compiled regex patterns for Amazon-style product identifiers
IDENTIFIER_PATTERNS = {
    "asin": re.compile(r"\bB0[0-9A-Z]{8}\b"),
    "upc": re.compile(r"\b\d{12}\b"),
    "ean": re.compile(r"\b\d{13}\b"),
    "fnsku": re.compile(r"\bX00[0-9A-Z]{7,10}\b"),
    "lpn": re.compile(r"\bLPN\s*[:#-]?\s*([0-9A-Z]{8,20})\b", re.IGNORECASE),
}


@dataclass
class OcrResult:
    """Result of OCR processing on a label image."""

    raw_text: str = ""
    identifiers: dict = field(default_factory=dict)
    confidence: float = 0.0


class LabelReader:
    """Reads text from product labels using EasyOCR or pytesseract."""

    def __init__(self, use_easyocr=True):
        self._use_easyocr = use_easyocr
        self._engine = None
        self._reader = None
        self._available = False

        if use_easyocr:
            try:
                import easyocr  # noqa: F401
                self._engine = "easyocr"
                self._available = True
                logger.info("EasyOCR selected (lazy init on first use)")
            except ImportError:
                logger.info("EasyOCR not available, falling back to pytesseract")
                self._try_pytesseract()
        else:
            self._try_pytesseract()

        if not self._available:
            logger.warning(
                "No OCR engine available. Install easyocr or pytesseract. "
                "OCR calls will return empty results."
            )

    def _try_pytesseract(self):
        """Attempt to load pytesseract as fallback engine."""
        try:
            import pytesseract  # noqa: F401
            self._engine = "pytesseract"
            self._available = True
            logger.info("Using pytesseract OCR engine")
        except ImportError:
            self._engine = None
            self._available = False

    def _get_reader(self):
        """Return cached EasyOCR reader, initializing on first call."""
        if self._reader is None and self._engine == "easyocr":
            import easyocr
            logger.info("Initializing EasyOCR reader (this may take a moment)...")
            self._reader = easyocr.Reader(["en"], gpu=False)
        return self._reader

    @staticmethod
    def _preprocess(image):
        """Convert BGR image to enhanced grayscale for OCR.

        Args:
            image: BGR numpy array

        Returns:
            Grayscale numpy array with CLAHE enhancement
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        return enhanced

    def read_text(self, image):
        """Extract text from a BGR image using the active OCR engine.

        Args:
            image: BGR numpy array

        Returns:
            tuple: (raw_text, confidence) where confidence is 0.0-1.0
        """
        if not self._available:
            return "", 0.0

        enhanced = self._preprocess(image)

        if self._engine == "easyocr":
            reader = self._get_reader()
            results = reader.readtext(enhanced)
            if not results:
                return "", 0.0
            texts = [entry[1] for entry in results]
            confidences = [entry[2] for entry in results]
            raw_text = " ".join(texts)
            avg_confidence = sum(confidences) / len(confidences)
            return raw_text, avg_confidence

        if self._engine == "pytesseract":
            import pytesseract
            data = pytesseract.image_to_data(
                enhanced, output_type=pytesseract.Output.DICT
            )
            texts = []
            confidences = []
            for i, text in enumerate(data["text"]):
                text = text.strip()
                conf = int(data["conf"][i])
                if text and conf > 0:
                    texts.append(text)
                    confidences.append(conf / 100.0)
            raw_text = " ".join(texts)
            avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
            return raw_text, avg_confidence

        return "", 0.0

    @staticmethod
    def parse_identifiers(text):
        """Extract product identifiers from OCR text.

        Args:
            text: Raw OCR text string

        Returns:
            dict: Keys are identifier types, values are matched strings
        """
        found = {}
        for name, pattern in IDENTIFIER_PATTERNS.items():
            match = pattern.search(text)
            if match:
                if name == "lpn":
                    found[name] = match.group(1)
                else:
                    found[name] = match.group(0)
        return found

    def process(self, image):
        """Full OCR pipeline: read text, parse identifiers, return result.

        Args:
            image: BGR numpy array

        Returns:
            OcrResult with raw_text, identifiers, and confidence
        """
        raw_text, confidence = self.read_text(image)
        identifiers = self.parse_identifiers(raw_text)
        return OcrResult(
            raw_text=raw_text,
            identifiers=identifiers,
            confidence=confidence,
        )

    def process_region(self, frame, bbox, padding=0.1):
        """Extract and process a region of interest from a frame.

        Args:
            frame: Full BGR frame (numpy array)
            bbox: Normalized bounding box (x, y, w, h) with values 0.0-1.0
            padding: Fractional padding to add around the bbox

        Returns:
            OcrResult for the extracted region
        """
        h, w = frame.shape[:2]
        bx, by, bw, bh = bbox

        # Apply padding
        pad_x = bw * padding
        pad_y = bh * padding
        x1 = max(0, int((bx - pad_x) * w))
        y1 = max(0, int((by - pad_y) * h))
        x2 = min(w, int((bx + bw + pad_x) * w))
        y2 = min(h, int((by + bh + pad_y) * h))

        # Guard against degenerate regions
        if x2 <= x1 or y2 <= y1:
            return OcrResult()

        roi = frame[y1:y2, x1:x2]
        return self.process(roi)
