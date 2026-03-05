import { v4 as uuidv4 } from 'uuid';
import { PiDetectionMessage, DetectionRecord, ResolutionStep } from '../types/detection.js';
import { OcrResolver } from './ocrResolver.js';
import { ProductEnrichment } from './productEnrichment.js';
import { AiVision } from './aiVision.js';
import { WmsIntegration } from './wmsIntegration.js';
import { GradeEngine } from './gradeEngine.js';
import { ImageStorage } from './imageStorage.js';
import * as db from '../db/queries.js';

export class DetectionProcessor {
  private resolver: OcrResolver;
  private enrichment: ProductEnrichment;
  private aiVision: AiVision;
  private wms: WmsIntegration;
  private grader: GradeEngine;
  private images: ImageStorage;
  private processing = false;

  constructor() {
    this.resolver = new OcrResolver();
    this.enrichment = new ProductEnrichment();
    this.aiVision = new AiVision();
    this.wms = new WmsIntegration();
    this.grader = new GradeEngine();
    this.images = new ImageStorage();
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  start(): void {
    this.processing = true;
    console.log('[Processor] Started');
  }

  stop(): void {
    this.processing = false;
    console.log('[Processor] Stopped');
  }

  async process(msg: PiDetectionMessage): Promise<{ detection: DetectionRecord; product: any } | null> {
    if (!this.processing) return null;

    const startTime = Date.now();
    const detectionId = uuidv4();
    const resolutionSteps: ResolutionStep[] = [];

    try {
      // 1. Save image
      const imagePath = await this.images.saveDetectionImage(detectionId, msg.image);

      // 2. Create detection record
      const detection: DetectionRecord = {
        id: detectionId,
        pi_id: msg.pi_id,
        track_id: msg.track_id,
        class_name: msg.class_name,
        confidence: msg.confidence,
        bbox: msg.bbox,
        barcode: msg.barcode,
        ocr_fields: msg.ocr_fields,
        image_path: imagePath,
        status: 'processing',
        created_at: new Date(),
      };

      await db.insertDetection(detection);

      // 3. Resolution chain — try to identify the product
      let resolution = await this.resolver.resolve(
        msg.barcode,
        msg.ocr_fields,
        resolutionSteps
      );

      // 4. If resolution failed and we have an image, try AI Vision
      if (!resolution && msg.image) {
        const aiResult = await this.aiVision.identify(msg.image);
        if (aiResult) {
          resolutionSteps.push({
            step: 'ai_vision',
            input: 'image',
            result: JSON.stringify(aiResult),
            confidence: aiResult.confidence || 0.5,
            duration_ms: Date.now() - startTime,
            success: true,
          });
          resolution = { ...aiResult, source: 'ai_vision' };
        }
      }

      // 5. Enrich with marketplace data
      const enriched = await this.enrichment.enrich(
        resolution?.upc || msg.barcode || null,
        resolution?.asin || msg.ocr_fields.asin || null,
        resolution?.title || null
      );

      // 6. Grade the item
      const gradeResult = this.grader.grade(
        msg.class_name,
        msg.confidence,
        enriched
      );

      // 7. Build product record
      const product = {
        id: uuidv4(),
        detection_id: detectionId,
        title: enriched?.title || resolution?.title || null,
        brand: enriched?.brand || resolution?.brand || null,
        model: enriched?.model || null,
        category: enriched?.category || msg.class_name,
        upc: resolution?.upc || msg.barcode || null,
        asin: resolution?.asin || msg.ocr_fields.asin || null,
        ean: resolution?.ean || msg.ocr_fields.ean || null,
        fnsku: msg.ocr_fields.fnsku || null,
        lpn: msg.ocr_fields.lpn || null,
        description: enriched?.description || null,
        image_url: imagePath,
        estimated_value: enriched?.estimatedValue || null,
        marketplace_comps: enriched?.comps || [],
        resolution_path: resolutionSteps.find((s) => s.success)?.step || 'unresolved',
        resolution_confidence: resolutionSteps.find((s) => s.success)?.confidence || 0,
        grade: gradeResult.grade,
        route: gradeResult.route,
        qlid: null as string | null,
        created_at: new Date(),
      };

      await db.insertProduct(product);
      await db.insertResolutionSteps(detectionId, resolutionSteps);

      // 8. WMS integration — create intake item
      try {
        const qlid = await this.wms.createIntakeItem(product);
        if (qlid) {
          product.qlid = qlid;
          await db.updateProductQlid(product.id, qlid);
        }
        await this.wms.submitGrade(qlid || product.id, gradeResult);
      } catch (wmsErr) {
        console.error('[Processor] WMS integration error:', wmsErr);
      }

      // 9. Update detection status
      await db.updateDetectionStatus(detectionId, 'completed');

      const elapsed = Date.now() - startTime;
      console.log(`[Processor] ${detectionId} completed in ${elapsed}ms — ${gradeResult.grade}/${gradeResult.route}`);

      return { detection, product };
    } catch (err) {
      console.error(`[Processor] ${detectionId} failed:`, err);
      await db.updateDetectionStatus(detectionId, 'failed').catch(() => {});
      return null;
    }
  }
}
