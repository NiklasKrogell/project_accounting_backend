import type { Request, Response } from 'express';
import { z } from 'zod';
import { companyService } from '../services/company.service';

// The upper bounds are those of changing the details afterwards
// (company-info.controller.ts); keep the two in step.
const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  businessId: z.string().trim().min(1).max(50),
  billingEmail: z.string().trim().email().max(254),
  billingAddress: z.string().trim().min(1).max(200),
  billingCity: z.string().trim().min(1).max(100),
  billingPostalCode: z.string().trim().min(1).max(20),
  billingCountry: z.string().trim().min(1).max(100),
});

export const companyController = {
  async listMine(req: Request, res: Response) {
    const companies = await companyService.listForUser(req.auth!.user.id);
    res.json({ data: companies });
  },

  async create(req: Request, res: Response) {
    const input = createCompanySchema.parse(req.body);
    const { user, session } = req.auth!;
    const company = await companyService.create(user.id, session.id, input);
    res.status(201).json({
      data: { id: company.id, name: company.name, subscriptionStatus: company.subscriptionStatus },
    });
  },
};
