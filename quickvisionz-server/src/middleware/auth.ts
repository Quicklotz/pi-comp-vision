import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import { config } from '../config.js';

// API key for Pi devices
export function validatePiAuth(request: IncomingMessage): boolean {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const token = url.searchParams.get('token') || request.headers['x-pi-token'] as string;

  if (!config.auth.piToken) {
    // If no PI_AUTH_TOKEN configured, allow all (dev mode)
    console.warn('[Auth] PI_AUTH_TOKEN not set — Pi connections unprotected');
    return true;
  }

  return token === config.auth.piToken;
}

// Token auth for dashboard WebSocket
export function validateDashboardAuth(request: IncomingMessage): boolean {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const token = url.searchParams.get('token') || request.headers['authorization']?.replace('Bearer ', '');

  if (!config.auth.dashboardToken) {
    console.warn('[Auth] DASHBOARD_TOKEN not set — dashboard connections unprotected');
    return true;
  }

  return token === config.auth.dashboardToken;
}

// REST API auth middleware
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.auth.apiToken) {
    // Dev mode — no auth required
    next();
    return;
  }

  const token = req.headers['authorization']?.replace('Bearer ', '') ||
                req.query.token as string;

  if (!token || token !== config.auth.apiToken) {
    res.status(401).json({ error: 'Unauthorized — provide Bearer token in Authorization header' });
    return;
  }

  next();
}
