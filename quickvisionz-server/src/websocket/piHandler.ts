import { WebSocket } from 'ws';
import { PiMessage, PiConnection, PiDetectionMessage } from '../types/detection.js';

type DetectionCallback = (detection: PiDetectionMessage) => void | Promise<void>;
type FrameCallback = (piId: string, image: string, fps: number, activeDetections: number) => void;

export class PiHandler {
  private connections = new Map<string, { ws: WebSocket; info: PiConnection }>();
  private onDetection: DetectionCallback | null = null;
  private onFrame: FrameCallback | null = null;

  handleConnection(ws: WebSocket): void {
    let piId: string | null = null;

    ws.on('message', (data) => {
      try {
        const msg: PiMessage = JSON.parse(data.toString());

        // Register on first message
        if (!piId && msg.pi_id) {
          piId = msg.pi_id;
          this.connections.set(piId, {
            ws,
            info: {
              pi_id: piId,
              connected_at: new Date(),
              last_heartbeat: new Date(),
              fps: 0,
              detections: 0,
              processed: 0,
            },
          });
          console.log(`[Pi] ${piId} connected`);
        }

        if (!piId) return;
        const conn = this.connections.get(piId);
        if (conn) conn.info.last_heartbeat = new Date();

        switch (msg.type) {
          case 'detection':
            if (conn) conn.info.detections++;
            Promise.resolve(this.onDetection?.(msg)).catch((err) => {
              console.error('[Pi] Detection callback error:', err);
            });
            break;
          case 'frame':
            this.onFrame?.(piId, msg.image, conn?.info.fps || 0, conn?.info.detections || 0);
            break;
          case 'stats':
            if (conn) {
              conn.info.fps = msg.fps;
              conn.info.detections = msg.detections;
              conn.info.processed = msg.processed;
            }
            break;
        }
      } catch (err) {
        console.error('[Pi] Invalid message:', err);
      }
    });

    ws.on('close', () => {
      if (piId) {
        this.connections.delete(piId);
        console.log(`[Pi] ${piId} disconnected`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[Pi] ${piId || 'unknown'} error:`, err.message);
    });
  }

  setDetectionCallback(cb: DetectionCallback): void {
    this.onDetection = cb;
  }

  setFrameCallback(cb: FrameCallback): void {
    this.onFrame = cb;
  }

  sendCommand(piId: string, command: object): void {
    const conn = this.connections.get(piId);
    if (conn?.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(command));
    }
  }

  getConnections(): PiConnection[] {
    return Array.from(this.connections.values()).map((c) => c.info);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
