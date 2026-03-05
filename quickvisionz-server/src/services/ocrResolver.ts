import { OcrFields, ResolutionStep } from '../types/detection.js';
import { ManifestLookup } from './manifestLookup.js';
import { ProductEnrichment } from './productEnrichment.js';

interface ResolvedProduct {
  title?: string;
  brand?: string;
  model?: string;
  upc?: string;
  asin?: string;
  ean?: string;
  category?: string;
  source: string;
}

export class OcrResolver {
  private manifest: ManifestLookup;
  private enrichment: ProductEnrichment;

  constructor() {
    this.manifest = new ManifestLookup();
    this.enrichment = new ProductEnrichment();
  }

  async resolve(
    barcode: string | null,
    ocrFields: OcrFields,
    steps: ResolutionStep[]
  ): Promise<ResolvedProduct | null> {
    // Step 1: LPN → manifest lookup
    if (ocrFields.lpn) {
      const start = Date.now();
      const result = await this.manifest.lookupByLpn(ocrFields.lpn);
      steps.push({
        step: 'manifest_by_lpn',
        input: ocrFields.lpn,
        result: result ? JSON.stringify(result) : null,
        confidence: result ? 0.95 : 0,
        duration_ms: Date.now() - start,
        success: !!result,
      });
      if (result) return { ...result, source: 'manifest_by_lpn' };
    }

    // Step 2: ASIN → Amazon catalog
    if (ocrFields.asin) {
      const start = Date.now();
      const result = await this.enrichment.lookupAsin(ocrFields.asin);
      steps.push({
        step: 'label_asin',
        input: ocrFields.asin,
        result: result ? JSON.stringify(result) : null,
        confidence: result ? 0.9 : 0,
        duration_ms: Date.now() - start,
        success: !!result,
      });
      if (result) return { ...result, asin: ocrFields.asin, source: 'label_asin' };
    }

    // Step 3: UPC/EAN → product database
    const upcOrEan = barcode || ocrFields.upc || ocrFields.ean;
    if (upcOrEan) {
      const start = Date.now();
      const result = await this.enrichment.lookupUpc(upcOrEan);
      steps.push({
        step: 'label_upc_or_ean',
        input: upcOrEan,
        result: result ? JSON.stringify(result) : null,
        confidence: result ? 0.85 : 0,
        duration_ms: Date.now() - start,
        success: !!result,
      });
      if (result) return { ...result, upc: upcOrEan, source: 'label_upc_or_ean' };
    }

    // Step 4: FNSKU → ASIN mapping
    if (ocrFields.fnsku) {
      const start = Date.now();
      const result = await this.enrichment.lookupFnsku(ocrFields.fnsku);
      steps.push({
        step: 'label_fnsku',
        input: ocrFields.fnsku,
        result: result ? JSON.stringify(result) : null,
        confidence: result ? 0.8 : 0,
        duration_ms: Date.now() - start,
        success: !!result,
      });
      if (result) return { ...result, source: 'label_fnsku' };
    }

    return null;
  }
}
