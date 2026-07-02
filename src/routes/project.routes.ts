import { Router } from 'express';
import { projectController } from '../controllers/project.controller';
import { asyncHandler } from '../lib/asyncHandler';

export const projectRoutes = Router();

projectRoutes.get('/', asyncHandler(projectController.list));
projectRoutes.post('/', asyncHandler(projectController.create));
projectRoutes.get('/:id', asyncHandler(projectController.getById));
