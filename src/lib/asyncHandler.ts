import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Wraps an async route handler so any rejected promise is forwarded to Express's
// error handling chain via next(), instead of becoming an unhandled rejection.
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };
