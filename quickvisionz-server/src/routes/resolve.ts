import { Router } from 'express';
import { OcrResolver } from '../services/ocrResolver.js';
import { ResolutionStep } from '../types/detection.js';

export function createResolveRouter(): Router {
  const router = Router();
  const resolver = new OcrResolver();

  router.post('/', async (req, res) => {
    try {
      const { barcode, ocr_fields } = req.body;
      if (!barcode && !ocr_fields) {
        return res.status(400).json({ error: 'Provide barcode or ocr_fields' });
      }
      if (ocr_fields && typeof ocr_fields !== 'object') {
        return res.status(400).json({ error: 'ocr_fields must be an object' });
      }
      const steps: ResolutionStep[] = [];
      const result = await resolver.resolve(barcode || null, ocr_fields || {}, steps);
      res.json({ result, steps });
    } catch (err) {
      res.status(500).json({ error: 'Resolution failed' });
    }
  });

  return router;
}
