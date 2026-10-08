import type { Request, Response } from 'express';
import { z } from 'zod';
import { SUPPORTED_LANGUAGES, userSettingsService } from '../services/user-settings.service';

// Partial update; unknown keys are rejected so a typo can't pass silently.
const userSettingsPatchSchema = z
  .object({
    language: z.enum(SUPPORTED_LANGUAGES),
  })
  .partial()
  .strict();

// Always the caller's own settings: the user comes from the session, never
// from the request, and the active company plays no part.
export const userSettingsController = {
  async get(req: Request, res: Response) {
    res.json({ data: await userSettingsService.get(req.auth!.user.id) });
  },

  async update(req: Request, res: Response) {
    const patch = userSettingsPatchSchema.parse(req.body);
    res.json({ data: await userSettingsService.update(req.auth!.user.id, patch) });
  },
};
