export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OcrFields {
  asin?: string;
  upc?: string;
  ean?: string;
  fnsku?: string;
  lpn?: string;
}

export interface PiDetectionMessage {
  type: 'detection';
  pi_id: string;
  track_id: number;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number];
  barcode: string | null;
  ocr_fields: OcrFields;
  image: string; // base64 JPEG
  timestamp: number;
}

export interface PiFrameMessage {
  type: 'frame';
  pi_id: string;
  image: string;
  timestamp: number;
}

export interface PiStatsMessage {
  type: 'stats';
  pi_id: string;
  fps: number;
  detections: number;
  processed: number;
}

export type PiMessage = PiDetectionMessage | PiFrameMessage | PiStatsMessage;

export interface DashboardFrameMessage {
  type: 'frame';
  image: string;
  fps: number;
  active_detections: number;
}

export interface DashboardDetectionEvent {
  type: 'detection_event';
  detection: DetectionRecord;
  status: 'processing' | 'completed' | 'failed';
}

export interface DashboardProductResult {
  type: 'product_result';
  detection_id: string;
  product: ProductRecord;
  grade: string;
  route: string;
}

export interface DashboardStatsUpdate {
  type: 'stats_update';
  items_today: number;
  barcode_rate: number;
  avg_processing_ms: number;
}

export type DashboardMessage = DashboardFrameMessage | DashboardDetectionEvent | DashboardProductResult | DashboardStatsUpdate;

export interface DetectionRecord {
  id: string;
  pi_id: string;
  track_id: number;
  class_name: string;
  confidence: number;
  bbox: number[];
  barcode: string | null;
  ocr_fields: OcrFields;
  image_path: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: Date;
}

export interface ProductRecord {
  id: string;
  detection_id: string;
  title: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  upc: string | null;
  asin: string | null;
  ean: string | null;
  fnsku: string | null;
  lpn: string | null;
  description: string | null;
  image_url: string | null;
  estimated_value: number | null;
  marketplace_comps: MarketplaceComp[];
  resolution_path: string | null;
  resolution_confidence: number | null;
  grade: string | null;
  route: string | null;
  qlid: string | null;
  created_at: Date;
}

export interface MarketplaceComp {
  source: 'ebay' | 'amazon';
  title: string;
  price: number;
  url: string;
  condition: string;
  sold_date?: string;
}

export interface ResolutionStep {
  step: string;
  input: string;
  result: string | null;
  confidence: number;
  duration_ms: number;
  success: boolean;
}

export interface PiConnection {
  pi_id: string;
  connected_at: Date;
  last_heartbeat: Date;
  fps: number;
  detections: number;
  processed: number;
}
