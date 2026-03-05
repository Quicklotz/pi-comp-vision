import { Router } from 'express';
import { DetectionProcessor } from '../services/detectionProcessor.js';
import { PiHandler } from '../websocket/piHandler.js';

export function createControlsRouter(processor: DetectionProcessor, piHandler: PiHandler): Router {
  const router = Router();

  router.post('/start', (req, res) => {
    processor.start();
    // Notify all connected Pis
    for (const conn of piHandler.getConnections()) {
      piHandler.sendCommand(conn.pi_id, { type: 'command', action: 'start' });
    }
    res.json({ status: 'started' });
  });

  router.post('/stop', (req, res) => {
    processor.stop();
    for (const conn of piHandler.getConnections()) {
      piHandler.sendCommand(conn.pi_id, { type: 'command', action: 'stop' });
    }
    res.json({ status: 'stopped' });
  });

  router.post('/configure', (req, res) => {
    const { sensitivity, capture_zone } = req.body;

    // Validate inputs
    if (sensitivity !== undefined && (typeof sensitivity !== 'number' || sensitivity < 0 || sensitivity > 1)) {
      return res.status(400).json({ error: 'sensitivity must be a number between 0 and 1' });
    }
    if (capture_zone !== undefined) {
      if (!Array.isArray(capture_zone) || capture_zone.length !== 2 ||
          capture_zone.some((v: any) => typeof v !== 'number' || v < 0 || v > 1)) {
        return res.status(400).json({ error: 'capture_zone must be [number, number] between 0 and 1' });
      }
    }

    // Forward configuration to Pis
    for (const conn of piHandler.getConnections()) {
      piHandler.sendCommand(conn.pi_id, {
        type: 'configure',
        sensitivity,
        capture_zone,
      });
    }
    res.json({ status: 'configured', sensitivity, capture_zone });
  });

  router.get('/pi/connections', (req, res) => {
    res.json({ connections: piHandler.getConnections() });
  });

  return router;
}
