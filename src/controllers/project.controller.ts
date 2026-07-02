import type { Request, Response } from 'express';
import { z } from 'zod';
import { projectService } from '../services/project.service';

const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  code: z.string().trim().min(1, 'code is required'),
});

export const projectController = {
  async list(_req: Request, res: Response) {
    const projects = await projectService.list();
    res.json({ data: projects });
  },

  async getById(req: Request, res: Response) {
    const project = await projectService.getById(req.params.id as string);
    res.json({ data: project });
  },

  async create(req: Request, res: Response) {
    const input = createProjectSchema.parse(req.body);
    const project = await projectService.create(input);
    res.status(201).json({ data: project });
  },
};
