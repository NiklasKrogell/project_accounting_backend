import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Account, BankAccount } from '../generated/prisma/client';
import { bankAccountService } from '../services/bank-account.service';
import { idParamsSchema } from '../lib/apiSchemas';
import { isValidIban, normalizeIban } from '../lib/iban';

// IBAN: strip spaces, uppercase, then check the shape and the checksum.
const ibanSchema = z.string().transform(normalizeIban).refine(isValidIban, 'Invalid IBAN');

// Create and update share the schema. `isActive` takes a bank account out of
// use or back into it on update; a new bank account is always in use.
const bankAccountBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  iban: ibanSchema,
  accountId: z.string().uuid(),
  isActive: z.boolean().optional(),
});

function serializeBankAccount(bankAccount: BankAccount & { account?: Account }) {
  return {
    id: bankAccount.id,
    name: bankAccount.name,
    iban: bankAccount.iban,
    accountId: bankAccount.accountId,
    isActive: bankAccount.isActive,
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
    const { name, iban, accountId } = bankAccountBodySchema.parse(req.body);
    const bankAccount = await bankAccountService.create(companyId, { name, iban, accountId });
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
};
