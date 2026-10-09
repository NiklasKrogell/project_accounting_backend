import type { Request, Response } from 'express';
import { z } from 'zod';
import { companyUserService } from '../services/company-user.service';

// Mirrors the Role Prisma enum.
const roleSchema = z.enum(['VIEWER', 'LEDGER', 'ACCOUNTANT', 'ADMIN']);

const createSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: roleSchema,
  isAdmin: z.boolean().optional(),
});

// Partial update; unknown keys are rejected so a typo can't pass silently.
const patchSchema = z.object({ role: roleSchema, isAdmin: z.boolean() }).partial().strict();

const userIdParamsSchema = z.object({ userId: z.string().uuid() });

// Always the active company's members: the company comes from the session's
// membership, never from the request.
export const companyUserController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    res.json({ data: await companyUserService.list(companyId) });
  },

  async create(req: Request, res: Response) {
    const { companyId, userId: actorUserId } = req.auth!.membership!;
    const input = createSchema.parse(req.body);
    res.status(201).json({ data: await companyUserService.create(companyId, actorUserId, input) });
  },

  async update(req: Request, res: Response) {
    const { companyId, userId: actorUserId } = req.auth!.membership!;
    const { userId } = userIdParamsSchema.parse(req.params);
    const patch = patchSchema.parse(req.body);
    res.json({ data: await companyUserService.update(companyId, actorUserId, userId, patch) });
  },

  async remove(req: Request, res: Response) {
    const { companyId, userId: actorUserId } = req.auth!.membership!;
    const { userId } = userIdParamsSchema.parse(req.params);
    await companyUserService.remove(companyId, actorUserId, userId);
    res.status(204).send();
  },

  async resetTemporaryPassword(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { userId } = userIdParamsSchema.parse(req.params);
    res.json({ data: await companyUserService.resetTemporaryPassword(companyId, userId) });
  },
};
