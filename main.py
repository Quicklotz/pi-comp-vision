"""
Auto-tracking camera system with person detection using Hailo AI accelerator.

Supports two modes:
  - tracking: Streams video with smooth zoom that follows detected persons.
  - conveyor: Detects products on a conveyor belt, captures them in a
              configurable zone, runs barcode + OCR, and optionally relays
              results to a remote server via WebSocket.
"""

import argparse
import logging
import threading
import time
import os
from concurrent.futures import ThreadPoolExecutor
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib, GObject
import hailo
from flask import Response
import numpy as np
import cv2

from scripts import TrackingState, build_pipeline, create_app, generate_frames
from scripts.conveyor import ConveyorTracker, IGNORED_CLASSES
from scripts.barcode import decode_barcode_region
from scripts.ocr import LabelReader
from scripts.capture import extract_roi, encode_base64, save_capture
from scripts.ws_client import PiWebSocketClient

logger = logging.getLogger(__name__)

Gst.init(None)


class DetectionStream:
    """Real-time person detection and auto-tracking camera stream."""

    def __init__(self, port=8080, video_source=None, smooth_factor=0.1,
                 zoom_out_delay=30, confidence_threshold=0.5, padding=0.3,
                 show_boxes=True, zoom_mode=True, show_fps=False,
                 mode="tracking", server_url=None, pi_id="PI-001",
                 capture_zone=(0.3, 0.7), stability_frames=8):
        self.port = port
        self.video_source = video_source
        self.latest_frame = None
        self.frame_lock = threading.Lock()
        self.pipeline = None
        self.loop = None
        self.mode = mode

        # Flask setup
        self.app = create_app()
        self._setup_stream_route()

        # Common settings
        self.confidence_threshold = confidence_threshold
        self.show_boxes = show_boxes
        self.zoom_mode = zoom_mode
        self.show_fps = show_fps
        self.fps = 0
        self.frame_count = 0
        self.last_fps_time = time.time()

        # Tracking state (used in tracking mode)
        self.tracking = TrackingState(
            smooth_factor=smooth_factor,
            zoom_out_delay=zoom_out_delay,
            confidence_threshold=confidence_threshold,
            padding=padding
        )

        # Conveyor mode resources
        self.conveyor_tracker = None
        self.label_reader = None
        self.ws_client = None
        self.processed_count = 0
        self._processed_count_lock = threading.Lock()
        self._pending_detections = []
        self._detection_lock = threading.Lock()
        self._capture_executor = ThreadPoolExecutor(max_workers=2)
        self.capture_zone = capture_zone

        if mode == "conveyor":
            self.conveyor_tracker = ConveyorTracker(
                stability_frames=stability_frames,
                capture_zone=capture_zone
            )
            self.label_reader = LabelReader(use_easyocr=True)
            if server_url:
                self.ws_client = PiWebSocketClient(server_url, pi_id)
            logger.info(
                "Conveyor mode: stability_frames=%d, capture_zone=%s, "
                "server_url=%s, pi_id=%s",
                stability_frames, capture_zone, server_url, pi_id
            )

    def _setup_stream_route(self):
        @self.app.route('/stream')
        def stream():
            return Response(
                generate_frames(self.frame_lock, lambda: self.latest_frame),
                mimetype='multipart/x-mixed-replace; boundary=frame'
            )

    # ------------------------------------------------------------------
    # GStreamer callbacks
    # ------------------------------------------------------------------

    def _on_sample(self, sink):
        sample = sink.emit('pull-sample')
        if sample:
            caps = sample.get_caps()
            buf = sample.get_buffer()
            ok, info = buf.map(Gst.MapFlags.READ)
            if ok:
                # Calculate FPS
                self.frame_count += 1
                current_time = time.time()
                if current_time - self.last_fps_time >= 1.0:
                    self.fps = self.frame_count
                    self.frame_count = 0
                    self.last_fps_time = current_time

                # Get frame dimensions from caps
                height = caps.get_structure(0).get_value("height")
                width = caps.get_structure(0).get_value("width")
                frame = np.ndarray((height, width, 3), buffer=info.data, dtype=np.uint8)

                if frame is not None:
                    if self.mode == "tracking":
                        self._process_tracking_frame(frame)
                    elif self.mode == "conveyor":
                        self._process_conveyor_frame(frame)

                buf.unmap(info)
        return Gst.FlowReturn.OK

    def _process_tracking_frame(self, frame):
        """Render the tracking-mode frame (existing behavior)."""
        # Smooth interpolation toward target
        self.tracking.interpolate()

        h, w = frame.shape[:2]
        x, y, cw, ch = self.tracking.get_crop_pixels(w, h)

        if self.zoom_mode:
            # Crop and resize back to original size
            cropped = frame[y:y+ch, x:x+cw]
            if cropped.size > 0:
                zoomed = cv2.resize(cropped, (w, h))
                if self.show_fps:
                    cv2.putText(zoomed, f"{self.fps} FPS", (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                _, jpeg = cv2.imencode('.jpg', zoomed, [cv2.IMWRITE_JPEG_QUALITY, 80])
                with self.frame_lock:
                    self.latest_frame = jpeg.tobytes()
        else:
            # Draw virtual camera frame (copy since we're modifying)
            frame = frame.copy()
            cv2.rectangle(frame, (x, y), (x + cw, y + ch), (0, 255, 255), 3)
            if self.show_fps:
                cv2.putText(frame, f"{self.fps} FPS", (10, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            with self.frame_lock:
                self.latest_frame = jpeg.tobytes()

    def _process_capture(self, cap):
        """Run barcode, OCR, save, and WS send for a single capture (runs in executor thread)."""
        try:
            roi_img = extract_roi(cap.frame, cap.bbox)

            barcode_result = decode_barcode_region(cap.frame, cap.bbox)
            barcode_str = barcode_result["barcode"] if barcode_result else None

            # OCR expects (x, y, w, h) normalised bbox
            ocr_bbox = (
                cap.bbox[0],
                cap.bbox[1],
                cap.bbox[2] - cap.bbox[0],
                cap.bbox[3] - cap.bbox[1],
            )
            ocr_result = self.label_reader.process_region(cap.frame, ocr_bbox)

            # Save capture to disk
            item_id = f"track{cap.track_id}_{int(time.time())}"
            save_capture(cap.frame, item_id, roi=roi_img)

            # Send via WebSocket if connected
            if self.ws_client is not None:
                roi_b64 = encode_base64(roi_img) if roi_img.size > 0 else None
                self.ws_client.send_detection(
                    track_id=cap.track_id,
                    class_name=cap.class_name,
                    confidence=cap.confidence,
                    bbox=cap.bbox,
                    barcode=barcode_str,
                    ocr_fields=ocr_result.identifiers if ocr_result else {},
                    image_base64=roi_b64,
                )

            self.conveyor_tracker.mark_processed(cap.track_id)
            with self._processed_count_lock:
                self.processed_count += 1
            logger.info(
                "Processed track %d (%s): barcode=%s, ocr_ids=%s",
                cap.track_id, cap.class_name, barcode_str,
                ocr_result.identifiers if ocr_result else {},
            )
        except Exception:
            logger.exception(
                "Error processing capture for track %d", cap.track_id
            )

    def _process_conveyor_frame(self, frame):
        """Process a frame in conveyor mode: track, capture, decode, stream."""
        h, w = frame.shape[:2]

        # Grab pending detections from _on_buffer and run the tracker
        with self._detection_lock:
            pending = self._pending_detections
            self._pending_detections = []

        captures = self.conveyor_tracker.update(pending, frame)

        # Submit each capture to the background executor for heavy processing
        for cap in captures:
            self._capture_executor.submit(self._process_capture, cap)

        # ---- Draw annotated frame for the MJPEG stream ----
        display = frame.copy()

        # Draw capture zone lines (vertical yellow lines)
        zone_x1 = int(self.capture_zone[0] * w)
        zone_x2 = int(self.capture_zone[1] * w)
        cv2.line(display, (zone_x1, 0), (zone_x1, h), (0, 255, 255), 2)
        cv2.line(display, (zone_x2, 0), (zone_x2, h), (0, 255, 255), 2)

        # Draw detection boxes for all active tracks
        for track in self.conveyor_tracker.tracks.values():
            x1 = int(track.bbox[0] * w)
            y1 = int(track.bbox[1] * h)
            x2 = int(track.bbox[2] * w)
            y2 = int(track.bbox[3] * h)

            if track.processed:
                color = (255, 0, 0)    # blue for processed
            else:
                color = (0, 255, 0)    # green for unprocessed

            cv2.rectangle(display, (x1, y1), (x2, y2), color, 2)
            label_text = f"{track.class_name} #{track.track_id}"
            cv2.putText(display, label_text, (x1, max(y1 - 8, 12)),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        # Overlay FPS + stats
        stats = self.conveyor_tracker.get_stats()
        overlay_lines = [
            f"{self.fps} FPS",
            f"Active: {stats['active']}  Processed: {self.processed_count}",
            f"Total tracked: {stats['total_tracked']}",
        ]
        y_offset = 25
        for line in overlay_lines:
            cv2.putText(display, line, (10, y_offset),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            y_offset += 22

        # Encode for MJPEG stream
        _, jpeg = cv2.imencode('.jpg', display, [cv2.IMWRITE_JPEG_QUALITY, 80])
        with self.frame_lock:
            self.latest_frame = jpeg.tobytes()

        # Send frame and stats via WebSocket
        if self.ws_client is not None:
            frame_b64 = encode_base64(display, quality=60)
            self.ws_client.send_frame(frame_b64)
            self.ws_client.send_stats(
                fps=self.fps,
                detection_count=stats["active"],
                processed_count=self.processed_count,
            )

    # ------------------------------------------------------------------
    # Hailo detection buffer probe
    # ------------------------------------------------------------------

    def _on_buffer(self, pad, info):
        buf = info.get_buffer()
        if buf:
            roi = hailo.get_roi_from_buffer(buf)
            detections = roi.get_objects_typed(hailo.HAILO_DETECTION)

            if self.mode == "tracking":
                persons = []
                for det in detections:
                    if det.get_label() != "person" or det.get_confidence() < self.confidence_threshold:
                        roi.remove_object(det)
                    else:
                        persons.append(det)
                        if not self.show_boxes:
                            roi.remove_object(det)
                # Update target crop based on all detected persons
                self.tracking.update_target(persons)

            elif self.mode == "conveyor":
                kept = []
                for det in detections:
                    label = det.get_label()
                    conf = det.get_confidence()
                    if label in IGNORED_CLASSES or conf < self.confidence_threshold:
                        roi.remove_object(det)
                    else:
                        kept.append(det)
                # Store for processing in _on_sample where we have the frame
                with self._detection_lock:
                    self._pending_detections.extend(kept)

        return Gst.PadProbeReturn.OK

    # ------------------------------------------------------------------
    # Pipeline lifecycle
    # ------------------------------------------------------------------

    def run(self):
        # Start WebSocket client before pipeline (conveyor mode)
        if self.mode == "conveyor" and self.ws_client is not None:
            self.ws_client.start()

        self.pipeline = build_pipeline(self.video_source)

        # Detection callback
        cb = self.pipeline.get_by_name("cb")
        cb.get_static_pad("src").add_probe(Gst.PadProbeType.BUFFER, self._on_buffer)

        # Frame capture
        sink = self.pipeline.get_by_name("sink")
        sink.connect("new-sample", self._on_sample)

        self.pipeline.set_state(Gst.State.PLAYING)

        # Start Flask
        threading.Thread(
            target=lambda: self.app.run(host='0.0.0.0', port=self.port, threaded=True, use_reloader=False),
            daemon=True
        ).start()

        print(f"Stream available at http://0.0.0.0:{self.port}")
        if self.mode == "conveyor":
            print(f"Mode: CONVEYOR  |  Capture zone: {self.capture_zone}")

        self.loop = GLib.MainLoop()
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", lambda bus, msg: self._on_message(bus, msg))

        # Handle Ctrl+C via GLib
        def shutdown():
            print("\nShutting down...")
            self._capture_executor.shutdown(wait=False)
            if self.mode == "conveyor" and self.ws_client is not None:
                self.ws_client.stop()
            self.pipeline.send_event(Gst.Event.new_eos())

        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, shutdown)  # 2 = SIGINT

        self.loop.run()

    def _on_message(self, bus, msg):
        if msg.type == Gst.MessageType.EOS:
            if self.video_source:
                # Loop video file by seeking back to start
                self.pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0)
            else:
                # Live camera -- EOS means camera disconnected
                logger.error("Camera disconnected (EOS)")
                self.loop.quit()
        elif msg.type == Gst.MessageType.ERROR:
            err, debug = msg.parse_error()
            print(f"Error: {err.message}")
            if self.mode == "conveyor" and self.ws_client is not None:
                self.ws_client.stop()
            self.loop.quit()

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(
        description="Auto-tracking camera with person detection",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    # Shared arguments
    parser.add_argument("-i", "--input", help="Video file path (default: camera)")
    parser.add_argument("-p", "--port", type=int, default=8080, help="Web server port")
    parser.add_argument("-c", "--confidence", type=float, default=0.5, help="Minimum detection confidence")
    parser.add_argument("--no-boxes", action="store_true", help="Hide detection boxes")
    parser.add_argument("--fps", action="store_true", help="Show FPS counter")

    # Mode selection
    parser.add_argument("--mode", choices=["tracking", "conveyor"], default="tracking",
                        help="Operating mode")

    # Tracking-mode arguments
    parser.add_argument("-s", "--smooth", type=float, default=0.1, help="Smooth factor (lower = smoother)")
    parser.add_argument("-d", "--delay", type=int, default=30, help="Frames to wait before zooming out")
    parser.add_argument("--padding", type=float, default=0.3, help="Padding around detected person")
    parser.add_argument("--frame-mode", action="store_true", help="Show virtual frame instead of zooming")

    # Conveyor-mode arguments
    parser.add_argument("--server-url", help="WebSocket server URL for conveyor mode")
    parser.add_argument("--pi-id", default="PI-001", help="Unique Pi identifier for conveyor mode")
    parser.add_argument("--capture-zone", type=float, nargs=2, default=[0.3, 0.7],
                        help="Normalised x-range for the capture zone (two floats)")
    parser.add_argument("--stability-frames", type=int, default=8,
                        help="Frames a detection must be stable before capture")

    args = parser.parse_args()

    DetectionStream(
        port=args.port,
        video_source=args.input,
        smooth_factor=args.smooth,
        zoom_out_delay=args.delay,
        confidence_threshold=args.confidence,
        padding=args.padding,
        show_boxes=not args.no_boxes,
        zoom_mode=not args.frame_mode,
        show_fps=args.fps,
        mode=args.mode,
        server_url=args.server_url,
        pi_id=args.pi_id,
        capture_zone=tuple(args.capture_zone),
        stability_frames=args.stability_frames,
    ).run()
