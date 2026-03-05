import { WebSocket } from 'ws';
import { DashboardMessage } from '../types/detection.js';

export class DashboardHandler {
  private clients = new Set<WebSocket>();

  handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    console.log(`[Dashboard] Client connected (${this.clients.size} total)`);

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[Dashboard] Client disconnected (${this.clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[Dashboard] Client error:', err.message);
      this.clients.delete(ws);
    });
  }

  broadcast(message: DashboardMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  broadcastFrame(image: string, fps: number, activeDetections: number): void {
    this.broadcast({
      type: 'frame',
      image,
      fps,
      active_detections: activeDetections,
    });
  }

  broadcastDetectionEvent(detection: any, status: 'processing' | 'completed' | 'failed'): void {
    this.broadcast({
      type: 'detection_event',
      detection,
      status,
    });
  }

  broadcastProductResult(detectionId: string, product: any, grade: string, route: string): void {
    this.broadcast({
      type: 'product_result',
      detection_id: detectionId,
      product,
      grade,
      route,
    });
  }

  broadcastStats(itemsToday: number, barcodeRate: number, avgMs: number): void {
    this.broadcast({
      type: 'stats_update',
      items_today: itemsToday,
      barcode_rate: barcodeRate,
      avg_processing_ms: avgMs,
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
