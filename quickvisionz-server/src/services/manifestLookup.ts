import { pool } from '../db/queries.js';

interface ManifestEntry {
  title: string;
  brand?: string;
  model?: string;
  upc?: string;
  asin?: string;
  ean?: string;
  category?: string;
  wholesale_cost?: number;
  retail_price?: number;
}

export class ManifestLookup {
  async lookupByLpn(lpn: string): Promise<ManifestEntry | null> {
    try {
      const result = await pool.query(
        `SELECT title, brand, model, upc, asin, ean, category, wholesale_cost, retail_price
         FROM vision_manifests
         WHERE lpn = $1 AND active = true
         LIMIT 1`,
        [lpn.toUpperCase()]
      );
      return result.rows[0] || null;
    } catch (err) {
      console.error('[ManifestLookup] Error:', err);
      return null;
    }
  }

  async importManifest(rows: ManifestEntry[], source: string): Promise<number> {
    let imported = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        await client.query(
          `INSERT INTO vision_manifests (lpn, title, brand, model, upc, asin, ean, category, wholesale_cost, retail_price, source, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
           ON CONFLICT (lpn) DO UPDATE SET
             title = EXCLUDED.title, brand = EXCLUDED.brand, model = EXCLUDED.model,
             upc = EXCLUDED.upc, asin = EXCLUDED.asin, updated_at = NOW()`,
          [(row as any).lpn, row.title, row.brand, row.model, row.upc, row.asin, row.ean, row.category, row.wholesale_cost, row.retail_price, source]
        );
        imported++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return imported;
  }
}
