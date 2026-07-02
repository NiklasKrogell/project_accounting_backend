import express, { type Express } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { routes } from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

// Builds the Express application. Kept separate from server startup so it can be
// imported directly by tests without opening a network port.
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());
  app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));

  app.use(routes);

  // 404 and error handling must come after all routes.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
