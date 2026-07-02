import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';

export const healthRoutes = Router();

// Liveness + database connectivity probe.
healthRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    let db: 'up' | 'down' = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }

    res.status(db === 'up' ? 200 : 503).json({
      status: db === 'up' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      db,
    });
  }),
);
