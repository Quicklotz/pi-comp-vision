import { Request, Response, NextFunction } from 'express';

const requests = new Map<string, { count: number; resetTime: number }>();

export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const key = req.ip || 'unknown';
        const now = Date.now();

        let entry = requests.get(key);
        if (!entry || now > entry.resetTime) {
            entry = { count: 0, resetTime: now + windowMs };
            requests.set(key, entry);
        }

        entry.count++;

        if (entry.count > maxRequests) {
            res.status(429).json({ error: 'Too many requests' });
            return;
        }

        next();
    };
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of requests) {
        if (now > entry.resetTime) requests.delete(key);
    }
}, 300000);
