import type { Request, Response } from 'express';
import { z } from 'zod';
import { companySettingsService } from '../services/company-settings.service';

// Partial update; unknown keys are rejected so a typo can't pass silently.
const companySettingsPatchSchema = z
  .object({
    vatRegistered: z.boolean(),
  })
  .partial()
  .strict();

// Always the active company's settings: the company comes from the session's
// membership, never from the request.
export const companySettingsController = {
  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    res.json({ data: await companySettingsService.get(companyId) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const patch = companySettingsPatchSchema.parse(req.body);
    res.json({ data: await companySettingsService.update(companyId, patch) });
  },
};
