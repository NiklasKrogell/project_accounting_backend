import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { projectRoutes } from './project.routes';

export const routes = Router();

routes.use('/health', healthRoutes);
routes.use('/api/projects', projectRoutes);
