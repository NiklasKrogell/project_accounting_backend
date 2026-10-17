import type { Request, Response } from 'express';
import { z } from 'zod';
import { supplierService, type SupplierWithDefaultAccount } from '../services/supplier.service';
import { bicSchema, ibanSchema, idParamsSchema, optionalSchema } from '../lib/apiSchemas';
import {
  finnishVatNumberOf,
  isValidFinnishBusinessId,
  isValidVatNumber,
  normalizeFinnishBusinessId,
  normalizeVatNumber,
} from '../lib/businessId';
import { VAT_RATES } from '../lib/vat';

const optionalText = (max: number) => optionalSchema(z.string().trim().max(max));

// Create and update share the schema, a full replace: an optional field left
// out is cleared. A Finnish supplier's business ID is a Y-tunnus, normalized
// and checked by its check digit, and its VAT number, when given, must be the
// one the business ID gives. Another country's business ID is free text.
const supplierBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    businessId: optionalText(50),
    vatNumber: optionalSchema(
      z.string().transform(normalizeVatNumber).refine(isValidVatNumber, 'Invalid VAT number'),
    ),
    email: optionalSchema(z.string().trim().email().max(254)),
    phone: optionalText(50),
    streetAddress: optionalText(200),
    postalCode: optionalText(20),
    city: optionalText(100),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code')
      .default('FI'),
    iban: optionalSchema(ibanSchema),
    bic: optionalSchema(bicSchema),
    defaultAccountId: optionalSchema(z.string().uuid()),
    // 0 is a default of its own, not the same as none.
    defaultVatRate: z
      .number()
      .refine((rate) => (VAT_RATES as readonly number[]).includes(rate), {
        message: `Must be one of ${VAT_RATES.join(', ')}`,
      })
      .nullish()
      .transform((v) => v ?? null),
  })
  .transform((s) => ({
    ...s,
    businessId:
      s.country === 'FI' && s.businessId ? normalizeFinnishBusinessId(s.businessId) : s.businessId,
  }))
  .superRefine((s, ctx) => {
    if (s.country !== 'FI' || !s.businessId) return;
    if (!isValidFinnishBusinessId(s.businessId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessId'],
        message: 'Invalid Finnish business ID',
      });
    } else if (s.vatNumber && s.vatNumber !== finnishVatNumberOf(s.businessId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vatNumber'],
        message: 'The VAT number does not match the business ID',
      });
    }
  });

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
});

export function serializeSupplier(supplier: SupplierWithDefaultAccount) {
  return {
    id: supplier.id,
    name: supplier.name,
    businessId: supplier.businessId,
    vatNumber: supplier.vatNumber,
    email: supplier.email,
    phone: supplier.phone,
    streetAddress: supplier.streetAddress,
    postalCode: supplier.postalCode,
    city: supplier.city,
    country: supplier.country,
    iban: supplier.iban,
    bic: supplier.bic,
    defaultAccountId: supplier.defaultAccountId,
    defaultAccount: supplier.defaultAccount,
    defaultVatRate: supplier.defaultVatRate,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export const supplierController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = listQuerySchema.parse(req.query);
    const suppliers = await supplierService.list(companyId, query);
    res.json({ data: suppliers.map(serializeSupplier) });
  },

  async create(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = supplierBodySchema.parse(req.body);
    const supplier = await supplierService.create(companyId, input);
    res.status(201).json({ data: serializeSupplier(supplier) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const supplier = await supplierService.getById(companyId, id);
    res.json({ data: serializeSupplier(supplier) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = supplierBodySchema.parse(req.body);
    const supplier = await supplierService.update(companyId, id, input);
    res.json({ data: serializeSupplier(supplier) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await supplierService.remove(companyId, id);
    res.status(204).send();
  },
};
