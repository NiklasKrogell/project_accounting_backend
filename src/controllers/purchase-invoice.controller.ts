import type { Request, Response } from 'express';
import { z } from 'zod';
import type { StoredFile } from '../generated/prisma/client';
import {
  purchaseInvoiceService,
  type PurchaseInvoiceSummary,
} from '../services/purchase-invoice.service';
import { serializeFile } from './stored-file.controller';
import { AppError } from '../lib/AppError';
import {
  bicSchema,
  dateOnlySchema,
  ibanSchema,
  idParamsSchema,
  optionalSchema,
} from '../lib/apiSchemas';
import { formatDateOnly } from '../lib/dateOnly';
import { isValidPaymentReference, normalizePaymentReference } from '../lib/paymentReference';
import { invoiceTotals } from '../lib/purchaseInvoice';

const statusSchema = z.enum(['NEW', 'APPROVED', 'PAID', 'REJECTED']);

// A row as entered: its amount net of VAT or including it according to the
// invoice's vatBasis. The service derives the stored net amount and the VAT,
// so a vatAmount in the body is stripped.
const lineSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  vatRate: z.number().min(0).max(100),
  description: z.string().trim().max(500).default(''),
  costCenterId: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

// Create and update share the schema, a full replace. A new invoice may come
// without rows; approving it needs some.
const invoiceBodySchema = z
  .object({
    supplierId: z.string().uuid(),
    invoiceNumber: z.string().trim().min(1).max(50),
    paymentReference: optionalSchema(
      z
        .string()
        .transform(normalizePaymentReference)
        .refine(isValidPaymentReference, 'Invalid payment reference'),
    ),
    invoiceDate: dateOnlySchema,
    entryDate: dateOnlySchema,
    dueDate: dateOnlySchema,
    iban: optionalSchema(ibanSchema),
    bic: optionalSchema(bicSchema),
    description: z.string().trim().max(500).default(''),
    vatBasis: z.enum(['net', 'gross']).default('net'),
    lines: z.array(lineSchema).max(100).default([]),
  })
  .refine((body) => body.dueDate.getTime() >= body.invoiceDate.getTime(), {
    path: ['dueDate'],
    message: 'The due date cannot be before the invoice date',
  });

// What each status takes along: a reason for rejecting, the day it was paid.
const statusChangeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('APPROVED') }).strict(),
  z
    .object({ status: z.literal('REJECTED'), reason: optionalSchema(z.string().trim().max(500)) })
    .strict(),
  z.object({ status: z.literal('PAID'), paymentDate: dateOnlySchema }).strict(),
  z.object({ status: z.literal('NEW') }).strict(),
]);

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  supplierId: z.string().uuid().optional(),
  dueTo: dateOnlySchema.optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

const dateOrNull = (d: Date | null) => (d ? formatDateOnly(d) : null);

// The invoice with its totals and rows, and its files when read on its own (a
// list row has only their count). The files' bytes are read through the file
// API (GET /api/files/:id/content).
function serializeInvoice(invoice: PurchaseInvoiceSummary & { files?: StoredFile[] }) {
  const totals = invoiceTotals(invoice.lines);
  return {
    id: invoice.id,
    supplierId: invoice.supplierId,
    supplier: invoice.supplier,
    invoiceNumber: invoice.invoiceNumber,
    paymentReference: invoice.paymentReference,
    invoiceDate: formatDateOnly(invoice.invoiceDate),
    entryDate: formatDateOnly(invoice.entryDate),
    dueDate: formatDateOnly(invoice.dueDate),
    iban: invoice.iban,
    bic: invoice.bic,
    description: invoice.description,
    vatBasis: invoice.vatBasis,
    status: invoice.status,
    netTotal: totals.net,
    vatTotal: totals.vat,
    grossTotal: totals.gross,
    journalEntryId: invoice.journalEntryId,
    createdById: invoice.createdById,
    approvedById: invoice.approvedById,
    approvedAt: invoice.approvedAt,
    rejectedById: invoice.rejectedById,
    rejectedAt: invoice.rejectedAt,
    rejectionReason: invoice.rejectionReason,
    paidById: invoice.paidById,
    paidAt: invoice.paidAt,
    paymentDate: dateOrNull(invoice.paymentDate),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      amount: line.amount,
      vatRate: line.vatRate,
      vatAmount: line.vatAmount,
      description: line.description,
      costCenterId: line.costCenterId,
    })),
    fileCount: invoice._count.files,
    ...(invoice.files ? { files: invoice.files.map(serializeFile) } : {}),
  };
}

export const purchaseInvoiceController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = listQuerySchema.parse(req.query);
    const { invoices, total } = await purchaseInvoiceService.list(companyId, query);
    res.json({
      data: invoices.map(serializeInvoice),
      meta: { total, take: query.take, skip: query.skip },
    });
  },

  async create(req: Request, res: Response) {
    const { membership, user } = req.auth!;
    const input = invoiceBodySchema.parse(req.body);
    const invoice = await purchaseInvoiceService.create(membership!.companyId, user.id, input);
    res.status(201).json({ data: serializeInvoice(invoice) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const invoice = await purchaseInvoiceService.getById(companyId, id);
    res.json({ data: serializeInvoice(invoice) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = invoiceBodySchema.parse(req.body);
    const invoice = await purchaseInvoiceService.update(companyId, id, input);
    res.json({ data: serializeInvoice(invoice) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await purchaseInvoiceService.remove(companyId, id);
    res.status(204).send();
  },

  async setStatus(req: Request, res: Response) {
    const { membership, user } = req.auth!;
    const { id } = idParamsSchema.parse(req.params);
    const change = statusChangeSchema.parse(req.body);
    const invoice = await purchaseInvoiceService.setStatus(
      membership!.companyId,
      user.id,
      id,
      change,
    );
    res.json({ data: serializeInvoice(invoice) });
  },

  async attachFile(req: Request, res: Response) {
    const { membership, user } = req.auth!;
    const { id } = idParamsSchema.parse(req.params);
    if (!req.file) {
      throw AppError.badRequest('A file is required, as the multipart form field "file"');
    }
    const file = await purchaseInvoiceService.attachFile(membership!.companyId, user.id, id, {
      content: req.file.buffer,
      originalName: req.file.originalname,
    });
    res.status(201).json({ data: serializeFile(file) });
  },
};
