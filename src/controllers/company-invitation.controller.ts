import type { Request, Response } from 'express';
import { idParamsSchema } from '../lib/apiSchemas';
import { companyInvitationService } from '../services/company-invitation.service';

// Always the active company's pending invitations: the company comes from the
// session's membership, never from the request. Sending one is part of adding
// a user (company-user.controller.ts).
export const companyInvitationController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    res.json({ data: await companyInvitationService.listForCompany(companyId) });
  },

  async cancel(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await companyInvitationService.cancel(companyId, id);
    res.status(204).send();
  },
};
