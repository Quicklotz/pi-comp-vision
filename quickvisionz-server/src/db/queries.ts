import pg from 'pg';
import { config } from '../config.js';
import { DetectionRecord, ProductRecord, ResolutionStep } from '../types/detection.js';

export const pool = new pg.Pool({
  connectionString: config.database.url,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function insertDetection(det: DetectionRecord): Promise<void> {
  await pool.query(
    `INSERT INTO vision_detections (id, pi_id, track_id, class_name, confidence, bbox, barcode, ocr_asin, ocr_upc, ocr_ean, ocr_fnsku, ocr_lpn, image_path, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [det.id, det.pi_id, det.track_id, det.class_name, det.confidence, det.bbox,
     det.barcode, det.ocr_fields.asin, det.ocr_fields.upc, det.ocr_fields.ean,
     det.ocr_fields.fnsku, det.ocr_fields.lpn, det.image_path, det.status]
  );
}

export async function insertProduct(prod: any): Promise<void> {
  await pool.query(
    `INSERT INTO vision_products (id, detection_id, title, brand, model, category, upc, asin, ean, fnsku, lpn, description, image_url, estimated_value, marketplace_comps, resolution_path, resolution_confidence, grade, route, qlid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [prod.id, prod.detection_id, prod.title, prod.brand, prod.model, prod.category,
     prod.upc, prod.asin, prod.ean, prod.fnsku, prod.lpn, prod.description,
     prod.image_url, prod.estimated_value, JSON.stringify(prod.marketplace_comps),
     prod.resolution_path, prod.resolution_confidence, prod.grade, prod.route, prod.qlid]
  );
}

export async function insertResolutionSteps(detectionId: string, steps: ResolutionStep[]): Promise<void> {
  for (const step of steps) {
    await pool.query(
      `INSERT INTO vision_unit_resolutions (detection_id, step, input, result, confidence, duration_ms, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [detectionId, step.step, step.input, step.result, step.confidence, step.duration_ms, step.success]
    );
  }
}

export async function updateDetectionStatus(id: string, status: string): Promise<void> {
  await pool.query('UPDATE vision_detections SET status = $2 WHERE id = $1', [id, status]);
}

export async function updateProductQlid(id: string, qlid: string): Promise<void> {
  await pool.query('UPDATE vision_products SET qlid = $2 WHERE id = $1', [id, qlid]);
}

export async function getDetections(limit = 50, offset = 0): Promise<any[]> {
  const result = await pool.query(
    'SELECT * FROM vision_detections ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return result.rows;
}

export async function getDetection(id: string): Promise<any> {
  const det = await pool.query('SELECT * FROM vision_detections WHERE id = $1', [id]);
  const prod = await pool.query('SELECT * FROM vision_products WHERE detection_id = $1', [id]);
  const steps = await pool.query('SELECT * FROM vision_unit_resolutions WHERE detection_id = $1 ORDER BY id', [id]);
  return { detection: det.rows[0], product: prod.rows[0], resolution_steps: steps.rows };
}

export async function getProducts(limit = 50, offset = 0): Promise<any[]> {
  const result = await pool.query(
    'SELECT p.*, d.pi_id, d.class_name, d.confidence as detection_confidence FROM vision_products p LEFT JOIN vision_detections d ON p.detection_id = d.id ORDER BY p.created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return result.rows;
}

export async function getProduct(id: string): Promise<any> {
  const result = await pool.query(
    `SELECT p.*, d.pi_id, d.class_name, d.confidence as detection_confidence,
            d.barcode, d.ocr_asin, d.ocr_upc, d.ocr_lpn
     FROM vision_products p
     LEFT JOIN vision_detections d ON p.detection_id = d.id
     WHERE p.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function getStats(): Promise<any> {
  const today = await pool.query(
    "SELECT COUNT(*) as items_today FROM vision_detections WHERE created_at >= CURRENT_DATE"
  );
  const barcodeRate = await pool.query(
    "SELECT COUNT(*) FILTER (WHERE barcode IS NOT NULL)::float / NULLIF(COUNT(*), 0) as rate FROM vision_detections WHERE created_at >= CURRENT_DATE"
  );
  const avgMs = await pool.query(
    "SELECT AVG(duration_ms) as avg_ms FROM vision_unit_resolutions WHERE created_at >= CURRENT_DATE"
  );
  const gradeDistribution = await pool.query(
    "SELECT grade, COUNT(*) as count FROM vision_products WHERE created_at >= CURRENT_DATE GROUP BY grade"
  );

  return {
    items_today: parseInt(today.rows[0]?.items_today || '0'),
    barcode_rate: parseFloat(barcodeRate.rows[0]?.rate || '0'),
    avg_processing_ms: parseInt(avgMs.rows[0]?.avg_ms || '0'),
    grade_distribution: Object.fromEntries(gradeDistribution.rows.map((r: any) => [r.grade, parseInt(r.count)])),
  };
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
