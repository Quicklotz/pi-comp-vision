"""Conveyor belt product tracker for Hailo-8L detection pipeline."""

from dataclasses import dataclass, field
from typing import Optional
import numpy as np
import cv2


# Animals and people — not products on a conveyor belt
IGNORED_CLASSES = {
    "person", "cat", "dog", "horse", "sheep",
    "cow", "elephant", "bear", "zebra", "giraffe", "bird",
}


@dataclass
class TrackedObject:
    track_id: int
    class_name: str
    confidence: float
    bbox: tuple  # (x1, y1, x2, y2) normalized 0-1
    first_seen_frame: int
    last_seen_frame: int
    stable_count: int
    processed: bool = False
    best_frame: Optional[np.ndarray] = field(default=None, repr=False)
    best_sharpness: float = 0.0


@dataclass
class CaptureReady:
    track_id: int
    class_name: str
    confidence: float
    bbox: tuple
    frame: np.ndarray


class ConveyorTracker:

    def __init__(self, stability_frames=8, capture_zone=(0.3, 0.7), iou_threshold=0.3):
        self.stability_frames = stability_frames
        self.capture_zone = capture_zone
        self.iou_threshold = iou_threshold
        self.tracks: dict[int, TrackedObject] = {}
        self.next_id = 0
        self.frame_count = 0
        self._total_tracked = 0

    def _iou(self, box_a, box_b):
        """Intersection over Union for two (x1, y1, x2, y2) boxes."""
        x1 = max(box_a[0], box_b[0])
        y1 = max(box_a[1], box_b[1])
        x2 = min(box_a[2], box_b[2])
        y2 = min(box_a[3], box_b[3])

        inter = max(0, x2 - x1) * max(0, y2 - y1)
        if inter == 0:
            return 0.0

        area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
        area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
        return inter / (area_a + area_b - inter)

    def _is_in_capture_zone(self, bbox):
        """Check if the bbox center-x falls within the capture zone."""
        center_x = (bbox[0] + bbox[2]) / 2
        return self.capture_zone[0] <= center_x <= self.capture_zone[1]

    def _compute_sharpness(self, frame, bbox):
        """Laplacian variance of the bbox region — higher means sharper."""
        h, w = frame.shape[:2]
        x1 = int(bbox[0] * w)
        y1 = int(bbox[1] * h)
        x2 = int(bbox[2] * w)
        y2 = int(bbox[3] * h)

        # Clamp to frame bounds
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        if x2 <= x1 or y2 <= y1:
            return 0.0

        roi = frame[y1:y2, x1:x2]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
        return cv2.Laplacian(gray, cv2.CV_64F).var()

    def update(self, detections, frame=None):
        """Process new detections and return any capture-ready objects.

        Args:
            detections: list of Hailo detection objects with get_label(),
                        get_confidence(), get_bbox() (normalized 0-1)
            frame: optional BGR numpy array for sharpness scoring

        Returns:
            list of CaptureReady for stable, in-zone, unprocessed objects
        """
        self.frame_count += 1

        # Convert Hailo detections to (label, confidence, bbox) tuples,
        # filtering out ignored classes
        parsed = []
        for det in detections:
            label = det.get_label()
            if label in IGNORED_CLASSES:
                continue
            conf = det.get_confidence()
            hbox = det.get_bbox()
            x1 = hbox.xmin()
            y1 = hbox.ymin()
            x2 = x1 + hbox.width()
            y2 = y1 + hbox.height()
            parsed.append((label, conf, (x1, y1, x2, y2)))

        # Match detections to existing tracks by IoU
        matched_track_ids = set()
        matched_det_indices = set()

        for det_idx, (label, conf, bbox) in enumerate(parsed):
            best_iou = 0.0
            best_tid = None

            for tid, track in self.tracks.items():
                if tid in matched_track_ids:
                    continue
                if track.class_name != label:
                    continue
                iou = self._iou(bbox, track.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_tid = tid

            if best_tid is not None and best_iou >= self.iou_threshold:
                # Update existing track
                track = self.tracks[best_tid]
                track.bbox = bbox
                track.confidence = conf
                track.last_seen_frame = self.frame_count
                track.stable_count += 1

                # Update best frame if this one is sharper
                if frame is not None:
                    sharpness = self._compute_sharpness(frame, bbox)
                    if sharpness > track.best_sharpness:
                        track.best_sharpness = sharpness
                        track.best_frame = frame.copy()

                matched_track_ids.add(best_tid)
                matched_det_indices.add(det_idx)

        # Create new tracks for unmatched detections
        for det_idx, (label, conf, bbox) in enumerate(parsed):
            if det_idx in matched_det_indices:
                continue

            tid = self.next_id
            self.next_id += 1
            self._total_tracked += 1

            new_track = TrackedObject(
                track_id=tid,
                class_name=label,
                confidence=conf,
                bbox=bbox,
                first_seen_frame=self.frame_count,
                last_seen_frame=self.frame_count,
                stable_count=1,
            )

            if frame is not None:
                sharpness = self._compute_sharpness(frame, bbox)
                new_track.best_sharpness = sharpness
                new_track.best_frame = frame.copy()

            self.tracks[tid] = new_track

        # Prune stale tracks (not seen for 15 frames)
        stale = [
            tid for tid, t in self.tracks.items()
            if self.frame_count - t.last_seen_frame > 15
        ]
        for tid in stale:
            del self.tracks[tid]

        # Collect capture-ready objects
        ready = []
        for track in self.tracks.values():
            if track.processed:
                continue
            if track.stable_count < self.stability_frames:
                continue
            if not self._is_in_capture_zone(track.bbox):
                continue

            capture_frame = track.best_frame if track.best_frame is not None else frame
            if capture_frame is None:
                continue

            ready.append(CaptureReady(
                track_id=track.track_id,
                class_name=track.class_name,
                confidence=track.confidence,
                bbox=track.bbox,
                frame=capture_frame,
            ))

        return ready

    def mark_processed(self, track_id):
        """Mark a track as processed so it won't trigger capture again."""
        if track_id in self.tracks:
            self.tracks[track_id].processed = True

    def get_active_count(self):
        """Number of active (non-processed) tracks."""
        return sum(1 for t in self.tracks.values() if not t.processed)

    def get_stats(self):
        """Summary counts for monitoring."""
        active = 0
        processed = 0
        for t in self.tracks.values():
            if t.processed:
                processed += 1
            else:
                active += 1

        return {
            "total_tracked": self._total_tracked,
            "active": active,
            "processed": processed,
        }
