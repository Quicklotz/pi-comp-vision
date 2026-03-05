import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { validatePiAuth, validateDashboardAuth, requireAuth } from './middleware/auth.js';
import { PiHandler } from './websocket/piHandler.js';
import { DashboardHandler } from './websocket/dashboardHandler.js';
import { DetectionProcessor } from './services/detectionProcessor.js';
import { ImageStorage } from './services/imageStorage.js';
import * as db from './db/queries.js';
import { pool } from './db/queries.js';

import detectionsRouter from './routes/detections.js';
import productsRouter from './routes/products.js';
import statsRouter from './routes/stats.js';
import { createControlsRouter } from './routes/controls.js';
import { createResolveRouter } from './routes/resolve.js';
import { createManifestRouter } from './routes/manifest.js';
import { rateLimit } from './middleware/rateLimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize components
const app = express();
const server = createServer(app);
const piHandler = new PiHandler();
const dashboardHandler = new DashboardHandler();
const processor = new DetectionProcessor();
const imageStorage = new ImageStorage();

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3040'],
    credentials: true,
}));
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});
app.use(express.json({ limit: '15mb' }));

// Rate limiting
app.use('/api/', rateLimit(100, 60000)); // 100 requests per minute
app.use('/api/manifest', rateLimit(5, 60000)); // 5 uploads per minute
app.use('/api/resolve', rateLimit(30, 60000)); // 30 resolves per minute

// Static files — serve dashboard
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard/dist')));

// Serve uploaded images
app.use('/api/images', express.static(config.uploads.dir));

// REST routes
app.get('/api/health', async (_req, res) => {
  const dbOk = await db.healthCheck();
  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    service: 'quickvisionz-server',
    port: config.port,
    database: dbOk ? 'connected' : 'disconnected',
    pi_connections: piHandler.getConnectionCount(),
    dashboard_clients: dashboardHandler.getClientCount(),
    processing: processor.isProcessing,
    uptime: process.uptime(),
  });
});

app.use('/api/detections', requireAuth, detectionsRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/controls', requireAuth, createControlsRouter(processor, piHandler));
app.use('/api/resolve', requireAuth, createResolveRouter());
app.use('/api/manifest', requireAuth, createManifestRouter());

// Dashboard SPA fallback
app.get('/dashboard/*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/dist/index.html'));
});

// Root redirect
app.get('/', (_req, res) => {
  res.redirect('/dashboard');
});

// WebSocket upgrade handling
const wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 }); // 5MB max

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws/pi') {
    if (!validatePiAuth(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      piHandler.handleConnection(ws);
    });
  } else if (pathname === '/ws/dashboard') {
    if (!validateDashboardAuth(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      dashboardHandler.handleConnection(ws);
    });
  } else {
    socket.destroy();
  }
});

// Wire Pi detections to processor + dashboard
piHandler.setDetectionCallback(async (msg) => {
  try {
    // Notify dashboard immediately
    dashboardHandler.broadcastDetectionEvent(
      { id: '', pi_id: msg.pi_id, track_id: msg.track_id, class_name: msg.class_name,
        confidence: msg.confidence, bbox: msg.bbox, barcode: msg.barcode,
        ocr_fields: msg.ocr_fields, image_path: null, status: 'processing', created_at: new Date() },
      'processing'
    );

    // Process detection
    const result = await processor.process(msg);
    if (result) {
      dashboardHandler.broadcastProductResult(
        result.detection.id,
        result.product,
        result.product.grade,
        result.product.route
      );

      // Update stats
      const stats = await db.getStats();
      dashboardHandler.broadcastStats(
        stats.items_today,
        stats.barcode_rate,
        stats.avg_processing_ms
      );
    }
  } catch (err) {
    console.error('[Detection] Processing failed:', err);
    // Broadcast failure to dashboard
    dashboardHandler.broadcastDetectionEvent(
      { ...msg, id: '', image_path: null, status: 'failed', created_at: new Date() },
      'failed'
    );
  }
});

// Wire Pi frames to dashboard
piHandler.setFrameCallback((piId, image, fps, activeDetections) => {
  dashboardHandler.broadcastFrame(image, fps, activeDetections);
});

// Start
async function start() {
  await imageStorage.init();
  processor.start();

  server.listen(config.port, () => {
    console.log(`QuickVisionz Server running on port ${config.port}`);
    console.log(`  Dashboard: http://localhost:${config.port}/dashboard`);
    console.log(`  API:       http://localhost:${config.port}/api/health`);
    console.log(`  Pi WS:     ws://localhost:${config.port}/ws/pi`);
    console.log(`  Dash WS:   ws://localhost:${config.port}/ws/dashboard`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  processor.stop();

  // Close HTTP server (stop accepting new connections)
  server.close();

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  // Close database pool
  await pool.end();

  console.log('Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException').catch(() => process.exit(1));
});
