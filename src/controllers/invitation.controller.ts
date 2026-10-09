import type { Request, Response } from 'express';
import { idParamsSchema } from '../lib/apiSchemas';
import { companyInvitationService } from '../services/company-invitation.service';

// The logged-in user's inbox: always req.auth.user's own invitations, whatever
// company the session is working in (or none).
export const invitationController = {
  async list(req: Request, res: Response) {
    res.json({ data: await companyInvitationService.listForUser(req.auth!.user.id) });
  },

  async accept(req: Request, res: Response) {
    const { id } = idParamsSchema.parse(req.params);
    const { user, session } = req.auth!;
    res.json({ data: await companyInvitationService.accept(user.id, session.id, id) });
  },

  async decline(req: Request, res: Response) {
    const { id } = idParamsSchema.parse(req.params);
    await companyInvitationService.decline(req.auth!.user.id, id);
    res.status(204).send();
  },
};
