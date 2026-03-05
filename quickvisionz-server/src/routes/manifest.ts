import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { ManifestLookup } from '../services/manifestLookup.js';
import fs from 'fs';

const upload = multer({
  dest: 'uploads/manifests/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

export function createManifestRouter(): Router {
  const router = Router();
  const manifest = new ManifestLookup();

  router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      let rows: any[];
      const ext = req.file.originalname.split('.').pop()?.toLowerCase();

      if (ext === 'csv') {
        const content = fs.readFileSync(req.file.path, 'utf-8');
        rows = parse(content, { columns: true, skip_empty_lines: true });
      } else if (ext === 'xlsx' || ext === 'xls') {
        const workbook = XLSX.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet);
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Use CSV or XLSX.' });
      }

      // Normalize column names
      const normalized = rows.map((row: any) => ({
        lpn: row.lpn || row.LPN || row['License Plate Number'] || '',
        title: row.title || row.Title || row['Product Name'] || row['Item Name'] || '',
        brand: row.brand || row.Brand || '',
        model: row.model || row.Model || '',
        upc: row.upc || row.UPC || row.Barcode || '',
        asin: row.asin || row.ASIN || '',
        ean: row.ean || row.EAN || '',
        category: row.category || row.Category || '',
        wholesale_cost: parseFloat(row.wholesale_cost || row['Wholesale Cost'] || row.Cost || '0') || undefined,
        retail_price: parseFloat(row.retail_price || row['Retail Price'] || row.MSRP || '0') || undefined,
      })).filter((r: any) => r.lpn);

      if (normalized.length > 50000) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Manifest too large. Maximum 50,000 rows.' });
      }

      const imported = await manifest.importManifest(normalized, req.file.originalname);

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      res.json({ imported, total_rows: rows.length, skipped: rows.length - imported });
    } catch (err) {
      // Clean up temp file on error
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      console.error('[Manifest] Import error:', err);
      res.status(500).json({ error: 'Failed to import manifest' });
    }
  });

  return router;
}
