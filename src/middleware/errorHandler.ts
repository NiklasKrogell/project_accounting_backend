import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/AppError';
import { env } from '../config/env';

// Centralized error handler. Must be registered last (after routes) and keep all
// four arguments so Express recognizes it as an error handler.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Expected, operational errors.
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { message: err.message } });
    return;
  }

  // Request validation failures.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { message: 'Validation failed', details: err.flatten().fieldErrors },
    });
    return;
  }

  // Unique constraint violations from Prisma -> 409 Conflict.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: { message: 'A record with that value already exists' } });
    return;
  }

  // Anything else is unexpected: log it and return a generic 500.
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      ...(env.NODE_ENV === 'development' && err instanceof Error ? { detail: err.message } : {}),
    },
  });
}
