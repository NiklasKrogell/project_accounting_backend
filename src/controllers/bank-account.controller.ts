import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Account, BankAccount } from '../generated/prisma/client';
import { bankAccountService } from '../services/bank-account.service';
import { idParamsSchema } from '../lib/apiSchemas';

// IBAN: strip spaces, uppercase, then check the country-prefix shape loosely
// (real length varies by country; Finnish IBANs are 18 chars).
const ibanSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(value), 'Invalid IBAN');

const bankAccountBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  iban: ibanSchema,
  accountId: z.string().uuid(),
});

function serializeBankAccount(bankAccount: BankAccount & { account?: Account }) {
  return {
    id: bankAccount.id,
    name: bankAccount.name,
    iban: bankAccount.iban,
    accountId: bankAccount.accountId,
    ...(bankAccount.account
      ? { account: { id: bankAccount.account.id, number: bankAccount.account.number, name: bankAccount.account.name } }
      : {}),
    createdAt: bankAccount.createdAt,
    updatedAt: bankAccount.updatedAt,
  };
}

export const bankAccountController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const bankAccounts = await bankAccountService.list(companyId);
    res.json({ data: bankAccounts.map(serializeBankAccount) });
  },

  async create(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = bankAccountBodySchema.parse(req.body);
    const bankAccount = await bankAccountService.create(companyId, input);
    res.status(201).json({ data: serializeBankAccount(bankAccount) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const bankAccount = await bankAccountService.getById(companyId, id);
    res.json({ data: serializeBankAccount(bankAccount) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = bankAccountBodySchema.parse(req.body);
    const bankAccount = await bankAccountService.update(companyId, id, input);
    res.json({ data: serializeBankAccount(bankAccount) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await bankAccountService.remove(companyId, id);
    res.status(204).send();
  },
};
