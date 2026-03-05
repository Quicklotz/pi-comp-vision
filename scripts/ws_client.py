"""Async WebSocket client for sending detection data to remote VPS server."""

import json
import time
import asyncio
import logging
import threading

try:
    import websockets
except ImportError:
    raise ImportError(
        "websockets is not installed. Install it with:\n"
        "  pip install websockets"
    )

logger = logging.getLogger(__name__)


class PiWebSocketClient:
    """WebSocket client that runs in a background thread.

    Sends detection results, video frames, and stats to a remote server.
    All public send methods are thread-safe and non-blocking.
    """

    def __init__(self, server_url, pi_id="PI-001", reconnect_interval=5):
        """Initialize the WebSocket client.

        Args:
            server_url: WebSocket URL, e.g. "ws://quickvisionz.quicklotzwms.com/ws/pi"
            pi_id: Unique identifier for this Pi unit
            reconnect_interval: Seconds to wait before reconnecting after disconnect
        """
        self.server_url = server_url
        self.pi_id = pi_id
        self.reconnect_interval = reconnect_interval

        self._ws = None
        self._connected = False
        self._stopping = False
        self._loop = None
        self._thread = None
        self._queue = None

        # Throttle state for frames and stats
        self._last_frame_time = 0.0
        self._last_stats_time = 0.0

    @property
    def is_connected(self):
        """Whether the WebSocket connection is currently active."""
        return self._connected

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        """Start the background event loop thread.

        Call this from the main thread. The WebSocket connection will be
        established asynchronously and will auto-reconnect on failure.
        """
        if self._thread is not None and self._thread.is_alive():
            logger.warning("WebSocket client is already running")
            return

        self._stopping = False
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("WebSocket client started (server=%s, pi_id=%s)",
                     self.server_url, self.pi_id)

    def stop(self):
        """Signal shutdown, close connection, and wait for the thread to finish."""
        self._stopping = True

        # Cancel the event loop tasks
        if self._loop is not None and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)

        if self._thread is not None:
            self._thread.join(timeout=10)
            self._thread = None

        self._connected = False
        logger.info("WebSocket client stopped")

    # ------------------------------------------------------------------
    # Background event loop
    # ------------------------------------------------------------------

    def _run_loop(self):
        """Create a new asyncio event loop and run the connect loop."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._queue = asyncio.Queue(maxsize=100)

        try:
            self._loop.run_until_complete(self._connect_loop())
        except Exception:
            logger.exception("WebSocket event loop crashed")
        finally:
            self._loop.close()
            self._loop = None

    async def _connect_loop(self):
        """Connect to server with automatic reconnect on failure."""
        while not self._stopping:
            try:
                logger.info("Connecting to %s ...", self.server_url)
                async with websockets.connect(
                    self.server_url,
                    ping_interval=None,  # we handle our own heartbeat
                    close_timeout=5,
                    max_size=10 * 1024 * 1024,  # 10 MB for base64 images
                ) as ws:
                    self._ws = ws
                    self._connected = True
                    logger.info("Connected to %s", self.server_url)

                    # Send hello / registration message
                    hello = {
                        "type": "hello",
                        "pi_id": self.pi_id,
                        "timestamp": time.time(),
                    }
                    await ws.send(json.dumps(hello))

                    # Run send, receive, and heartbeat concurrently
                    await asyncio.gather(
                        self._send_loop(),
                        self._receive_loop(),
                        self._heartbeat_loop(),
                    )

            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("WebSocket connection error")
            finally:
                self._ws = None
                self._connected = False

            if not self._stopping:
                logger.info("Reconnecting in %d seconds...",
                            self.reconnect_interval)
                await asyncio.sleep(self.reconnect_interval)

    # ------------------------------------------------------------------
    # Concurrent async tasks
    # ------------------------------------------------------------------

    async def _send_loop(self):
        """Pull messages from the queue and send them over the WebSocket."""
        MAX_RETRIES = 3
        try:
            while not self._stopping:
                try:
                    message = await asyncio.wait_for(
                        self._queue.get(), timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue

                retries = message.pop("_retries", 0)
                try:
                    await self._ws.send(json.dumps(message))
                except Exception:
                    retries += 1
                    if retries >= MAX_RETRIES:
                        logger.warning(
                            "Discarding message after %d failed attempts (type=%s)",
                            retries, message.get("type", "unknown"),
                        )
                    else:
                        logger.warning(
                            "Failed to send message (type=%s), retry %d/%d",
                            message.get("type", "unknown"), retries, MAX_RETRIES,
                        )
                        message["_retries"] = retries
                        try:
                            self._queue.put_nowait(message)
                        except asyncio.QueueFull:
                            logger.warning("Queue full, dropping retried message")
                    raise  # break out so _connect_loop can reconnect
        except asyncio.CancelledError:
            pass

    async def _receive_loop(self):
        """Listen for incoming server messages (control commands, etc.)."""
        try:
            async for raw in self._ws:
                try:
                    message = json.loads(raw)
                    msg_type = message.get("type", "unknown")
                    logger.info("Received server message: type=%s", msg_type)

                    if msg_type == "command":
                        action = message.get("action")
                        logger.info("Server command received: %s", action)
                    elif msg_type == "configure":
                        logger.info("Server configuration update: %s",
                                    json.dumps(message.get("config", {})))
                    else:
                        logger.debug("Server message payload: %s", raw[:200])

                except json.JSONDecodeError:
                    logger.warning("Received non-JSON message from server: %s",
                                   raw[:100])
        except websockets.ConnectionClosed:
            logger.info("Server closed the connection")
        except asyncio.CancelledError:
            pass

    async def _heartbeat_loop(self):
        """Send a ping every 30 seconds to keep the connection alive."""
        try:
            while not self._stopping:
                await asyncio.sleep(30)
                try:
                    pong = await self._ws.ping()
                    await asyncio.wait_for(pong, timeout=10)
                    logger.debug("Heartbeat pong received")
                except Exception:
                    logger.warning("Heartbeat failed, connection may be dead")
                    raise  # let _connect_loop handle reconnect
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------
    # Thread-safe public API
    # ------------------------------------------------------------------

    def _enqueue(self, message):
        """Thread-safe enqueue of a message dict to the async send queue.

        Called from GStreamer / main threads. Silently drops if the loop
        is not running or the queue is full to avoid crashing the detection
        pipeline.
        """
        if self._loop is None or self._queue is None:
            return
        try:
            self._queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning("Send queue full, dropping message (type=%s)",
                           message.get("type", "unknown"))
        except RuntimeError:
            # Event loop is closed or shutting down
            pass

    def send_detection(self, track_id, class_name, confidence, bbox,
                       barcode=None, ocr_fields=None, image_base64=None):
        """Queue a detection result for transmission.

        Args:
            track_id: Integer tracking ID from ConveyorTracker
            class_name: Detected object class (e.g. "bottle")
            confidence: Detection confidence 0-1
            bbox: Bounding box as [x1, y1, x2, y2] (normalized 0-1)
            barcode: Decoded barcode string or None
            ocr_fields: Dict of OCR results (e.g. {"asin": "B0EXAMPLE01"})
            image_base64: Base64-encoded JPEG of the cropped product
        """
        message = {
            "type": "detection",
            "pi_id": self.pi_id,
            "track_id": track_id,
            "class_name": class_name,
            "confidence": round(confidence, 4),
            "bbox": list(bbox),
            "barcode": barcode,
            "ocr_fields": ocr_fields or {},
            "image": image_base64,
            "timestamp": time.time(),
        }
        self._enqueue(message)

    def send_frame(self, image_base64):
        """Queue a video frame for live relay to the dashboard.

        Throttled to max 10 FPS — frames submitted faster than 100ms
        apart are silently dropped.

        Args:
            image_base64: Base64-encoded JPEG of the full frame
        """
        now = time.time()
        if now - self._last_frame_time < 0.1:
            return  # throttle: skip if < 100ms since last frame
        self._last_frame_time = now

        message = {
            "type": "frame",
            "pi_id": self.pi_id,
            "image": image_base64,
            "timestamp": now,
        }
        self._enqueue(message)

    def send_stats(self, fps, detection_count, processed_count):
        """Queue a stats update for the monitoring dashboard.

        Throttled to once per second.

        Args:
            fps: Current processing FPS
            detection_count: Number of active tracked objects
            processed_count: Total objects processed this session
        """
        now = time.time()
        if now - self._last_stats_time < 1.0:
            return  # throttle: once per second
        self._last_stats_time = now

        message = {
            "type": "stats",
            "pi_id": self.pi_id,
            "fps": round(fps, 1),
            "detection_count": detection_count,
            "processed_count": processed_count,
            "timestamp": now,
        }
        self._enqueue(message)
