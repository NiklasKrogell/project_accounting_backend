import type { Request, Response } from 'express';
import { z } from 'zod';
import { companyService } from '../services/company.service';

const createCompanySchema = z.object({ name: z.string().trim().min(1) });

export const companyController = {
  async listMine(req: Request, res: Response) {
    const companies = await companyService.listForUser(req.auth!.user.id);
    res.json({ data: companies });
  },

  async create(req: Request, res: Response) {
    const { name } = createCompanySchema.parse(req.body);
    const company = await companyService.create(req.auth!.user.id, name);
    res.status(201).json({
      data: { id: company.id, name: company.name, subscriptionStatus: company.subscriptionStatus },
    });
  },
};
