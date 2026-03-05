import { config } from '../config.js';

interface GradeResult {
  grade: string;
  route: string;
  confidence: number;
  notes: string;
}

export class WmsIntegration {
  async createIntakeItem(product: any): Promise<string | null> {
    try {
      const res = await fetch(`${config.wms.intakez}/api/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: product.title || 'Vision-Detected Item',
          brand: product.brand,
          model: product.model,
          category: product.category,
          upc: product.upc,
          asin: product.asin,
          condition: product.grade,
          source: 'quickvisionz',
          image_url: product.image_url,
          estimated_value: product.estimated_value,
        }),
      });

      if (!res.ok) {
        console.error('[WMS] IntakeZ error:', res.status, await res.text());
        return null;
      }

      const data = await res.json() as any;
      return data.qlid || data.id || null;
    } catch (err) {
      console.error('[WMS] IntakeZ unreachable:', err);
      return null;
    }
  }

  async submitGrade(itemId: string, grade: GradeResult): Promise<boolean> {
    try {
      const res = await fetch(`${config.wms.gradez}/api/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          grade: grade.grade,
          route: grade.route,
          confidence: grade.confidence,
          notes: grade.notes,
          source: 'quickvisionz-auto',
        }),
      });

      return res.ok;
    } catch (err) {
      console.error('[WMS] GradeZ unreachable:', err);
      return false;
    }
  }

  async createDraftListing(product: any): Promise<string | null> {
    try {
      const res = await fetch(`${config.wms.listz}/api/listings/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: product.title,
          description: product.description,
          brand: product.brand,
          category: product.category,
          upc: product.upc,
          asin: product.asin,
          price: product.estimated_value,
          condition: product.grade,
          images: product.image_url ? [product.image_url] : [],
          source: 'quickvisionz',
        }),
      });

      if (!res.ok) return null;
      const data = await res.json() as any;
      return data.listing_id || data.id || null;
    } catch (err) {
      console.error('[WMS] ListZ unreachable:', err);
      return null;
    }
  }
}
