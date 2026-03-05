import { Router } from 'express';
import * as db from '../db/queries.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const detections = await db.getDetections(limit, offset);
    res.json({ detections, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch detections' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.getDetection(req.params.id);
    if (!result.detection) return res.status(404).json({ error: 'Detection not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch detection' });
  }
});

export default router;
