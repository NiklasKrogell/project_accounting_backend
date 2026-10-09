import type { Request, Response } from 'express';
import { z } from 'zod';
import { companyService } from '../services/company.service';

// Partial update; unknown keys are rejected so a typo can't pass silently. The
// business ID is not here on purpose: it identifies the company and can't be
// changed through the API. The rules match those of creating a company.
const companyInfoPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    billingEmail: z.string().trim().email().max(254),
    billingAddress: z.string().trim().min(1).max(200),
    billingCity: z.string().trim().min(1).max(100),
    billingPostalCode: z.string().trim().min(1).max(20),
    billingCountry: z.string().trim().min(1).max(100),
  })
  .partial()
  .strict();

// Always the active company's details: the company comes from the session's
// membership, never from the request.
export const companyInfoController = {
  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    res.json({ data: await companyService.getInfo(companyId) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const patch = companyInfoPatchSchema.parse(req.body);
    res.json({ data: await companyService.updateInfo(companyId, patch) });
  },
};
