import type { Request, Response } from 'express';
import { z } from 'zod';
import type { CostCenter } from '../generated/prisma/client';
import { costCenterService } from '../services/cost-center.service';
import { idParamsSchema } from '../lib/apiSchemas';

const costCenterBodySchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
});

export function serializeCostCenter(costCenter: CostCenter) {
  return {
    id: costCenter.id,
    code: costCenter.code,
    name: costCenter.name,
    createdAt: costCenter.createdAt,
    updatedAt: costCenter.updatedAt,
  };
}

export const costCenterController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const costCenters = await costCenterService.list(companyId);
    res.json({ data: costCenters.map(serializeCostCenter) });
  },

  async create(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = costCenterBodySchema.parse(req.body);
    const costCenter = await costCenterService.create(companyId, input);
    res.status(201).json({ data: serializeCostCenter(costCenter) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const costCenter = await costCenterService.getById(companyId, id);
    res.json({ data: serializeCostCenter(costCenter) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = costCenterBodySchema.parse(req.body);
    const costCenter = await costCenterService.update(companyId, id, input);
    res.json({ data: serializeCostCenter(costCenter) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await costCenterService.remove(companyId, id);
    res.status(204).send();
  },
};
