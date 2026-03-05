import { Router } from 'express';
import * as db from '../db/queries.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
