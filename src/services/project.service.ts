import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

export interface CreateProjectInput {
  name: string;
  code: string;
}

export const projectService = {
  list() {
    return prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async getById(id: string) {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw AppError.notFound(`Project ${id} not found`);
    }
    return project;
  },

  create(input: CreateProjectInput) {
    return prisma.project.create({ data: input });
  },
};
