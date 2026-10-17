import type { Prisma, PurchaseInvoiceStatus } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { normalizeToUtcDate } from '../lib/dateOnly';
import { centsFromText, toCents } from '../lib/money';
import { normalizePaymentReference } from '../lib/paymentReference';
import { buildPurchaseEntry, invoiceTotals } from '../lib/purchaseInvoice';
import { splitVat, type VatBasis } from '../lib/vat';
import {
  assertAccountsInCompany,
  assertCostCentersInCompany,
  assertVatAllowed,
  createJournalEntryInTx,
  removeJournalEntryInTx,
} from './journal-entry.service';
import { storeFile } from './stored-file.service';

// A company's purchase invoices (ostolaskut). An invoice has rows of its own,
// the cost side of its booking (see lib/purchaseInvoice.ts), and reaches the
// books only when it is approved: approving books a PURCHASE entry from the
// rows on the invoice's entry date, and reopening takes that entry back. Until
// then nothing about it needs an open period or takes a voucher number.
//
// Every change reads the invoice's status under a row lock (lockInvoice), so
// of two changes at once the second sees what the first did.

export interface PurchaseInvoiceLineInput {
  accountId: string;
  // Net or gross according to the invoice's vatBasis.
  amount: number;
  vatRate: number;
  description: string;
  costCenterId: string | null;
}

export interface PurchaseInvoiceInput {
  supplierId: string;
  invoiceNumber: string;
  // Normalized and checked by the controller.
  paymentReference: string | null;
  invoiceDate: Date;
  entryDate: Date;
  dueDate: Date;
  // The invoice's total including VAT, as typed from the invoice. The rows
  // must come to it, to the cent, before the invoice can be approved.
  totalAmount: number;
  iban: string | null;
  bic: string | null;
  description: string;
  vatBasis: VatBasis;
  lines: PurchaseInvoiceLineInput[];
}

// The PDF (or image) of the invoice, when it is stored with the new invoice.
export interface InvoiceFileInput {
  content: Buffer;
  // The name the client gave the file; cleaned up before it is stored.
  originalName: string;
}

// The columns the list can be sorted by.
export const PURCHASE_INVOICE_SORT_FIELDS = [
  'invoiceNumber',
  'supplier',
  'paymentReference',
  'invoiceDate',
  'dueDate',
  'totalAmount',
  'status',
] as const;
export type PurchaseInvoiceSortField = (typeof PURCHASE_INVOICE_SORT_FIELDS)[number];

export interface ListPurchaseInvoicesFilter {
  // Any of these; all statuses when empty or left out.
  statuses?: PurchaseInvoiceStatus[] | undefined;
  supplierId?: string | undefined;
  // Both ends of each range are inclusive.
  invoiceDateFrom?: Date | undefined;
  invoiceDateTo?: Date | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  // Matched against the invoice number, the supplier's name, the payment
  // reference and the typed total (see searchConditions).
  search?: string | undefined;
  // By due date, earliest first, when left out.
  sort?: PurchaseInvoiceSortField | undefined;
  order?: Prisma.SortOrder | undefined;
  take: number;
  skip: number;
}

export type PurchaseInvoiceStatusChange =
  | { status: 'APPROVED' }
  | { status: 'REJECTED'; reason: string | null }
  | { status: 'PAID'; paymentDate: Date }
  | { status: 'NEW' };

export type AttachFileInput = InvoiceFileInput;

// What a list row shows: the rows (for the totals), not the files themselves.
const withSummary = {
  supplier: { select: { id: true, name: true } },
  lines: { orderBy: { position: 'asc' } },
  _count: { select: { files: true } },
} satisfies Prisma.PurchaseInvoiceInclude;

const withDetails = {
  ...withSummary,
  files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.PurchaseInvoiceInclude;

export type PurchaseInvoiceSummary = Prisma.PurchaseInvoiceGetPayload<{
  include: typeof withSummary;
}>;

export type PurchaseInvoiceWithDetails = Prisma.PurchaseInvoiceGetPayload<{
  include: typeof withDetails;
}>;

// The invoice with its details, read once a change has been committed. Never
// inside a transaction: Prisma fetches the rows and the files at once, and a
// transaction's single connection would have to queue one of the queries.
function readInvoice(id: string) {
  return prisma.purchaseInvoice.findUniqueOrThrow({ where: { id }, include: withDetails });
}

// Which status an invoice may move to from which. Approving books it and
// reopening an approved one (back to NEW) takes the booking back; the others
// only mark it.
const TRANSITIONS: Record<PurchaseInvoiceStatus, readonly PurchaseInvoiceStatus[]> = {
  NEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PAID', 'NEW'],
  PAID: ['APPROVED'],
  REJECTED: ['NEW'],
};

function invoiceNotFound(): AppError {
  return AppError.notFound('Purchase invoice not found');
}

// Locks the invoice's row for the rest of the transaction and returns its
// status. The company is in the query: another company's invoice is as good
// as nonexistent.
async function lockInvoice(
  tx: Prisma.TransactionClient,
  companyId: string,
  id: string,
): Promise<PurchaseInvoiceStatus> {
  const [row] = await tx.$queryRaw<{ status: PurchaseInvoiceStatus }[]>`
    SELECT "status"::text AS "status" FROM "PurchaseInvoice"
    WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
  if (!row) throw invoiceNotFound();
  return row.status;
}

// An invoice's details and rows are changed, and files attached to it, only
// while it is new: an approved one is in the books as it is.
function assertEditable(status: PurchaseInvoiceStatus): void {
  if (status !== 'NEW') {
    throw AppError.conflict('Only a new purchase invoice can be changed; reopen it first');
  }
}

// What the invoice refers to must be the company's own, and a company that is
// not VAT-registered enters no VAT on its rows either.
async function assertReferencesValid(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: PurchaseInvoiceInput,
): Promise<void> {
  const supplier = await tx.supplier.count({ where: { id: input.supplierId, companyId } });
  if (supplier === 0) throw AppError.badRequest('Supplier does not exist in this company');
  await assertAccountsInCompany(
    tx,
    companyId,
    input.lines.map((l) => l.accountId),
  );
  await assertCostCentersInCompany(tx, companyId, input.lines);
  await assertVatAllowed(tx, companyId, input.lines);
}

// The unique index decides in the end (a race gets the P2002 409); this gives
// the usual case a message of its own.
async function assertInvoiceNumberAvailable(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: Pick<PurchaseInvoiceInput, 'supplierId' | 'invoiceNumber'>,
  exceptId?: string,
): Promise<void> {
  const existing = await tx.purchaseInvoice.findFirst({
    where: {
      companyId,
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw AppError.conflict('The supplier already has an invoice with that number');
}

function invoiceColumns(input: PurchaseInvoiceInput) {
  return {
    supplierId: input.supplierId,
    invoiceNumber: input.invoiceNumber,
    paymentReference: input.paymentReference,
    invoiceDate: normalizeToUtcDate(input.invoiceDate),
    entryDate: normalizeToUtcDate(input.entryDate),
    dueDate: normalizeToUtcDate(input.dueDate),
    totalAmount: input.totalAmount,
    iban: input.iban,
    bic: input.bic,
    description: input.description,
    vatBasis: input.vatBasis,
  };
}

// Rows are stored like journal entry lines: net, with their VAT.
function storedLines(companyId: string, input: PurchaseInvoiceInput) {
  return input.lines.map((line, position) => {
    const { net, vat } = splitVat(line, input.vatBasis);
    return {
      companyId,
      position,
      accountId: line.accountId,
      amount: net,
      vatRate: line.vatRate,
      vatAmount: vat,
      description: line.description,
      costCenterId: line.costCenterId,
    };
  });
}

// The search text matches an invoice whose number or supplier's name contains
// it, whose payment reference contains it once written the way references are
// stored, or, when it reads as an amount, whose typed total is that amount.
function searchConditions(search: string): Prisma.PurchaseInvoiceWhereInput[] {
  const conditions: Prisma.PurchaseInvoiceWhereInput[] = [
    { invoiceNumber: { contains: search, mode: 'insensitive' } },
    { supplier: { name: { contains: search, mode: 'insensitive' } } },
  ];
  const reference = normalizePaymentReference(search);
  if (reference) conditions.push({ paymentReference: { contains: reference } });
  const cents = centsFromText(search);
  // Within half a cent either way: the totals are floats.
  if (cents !== null) {
    conditions.push({ totalAmount: { gte: (cents - 0.5) / 100, lt: (cents + 0.5) / 100 } });
  }
  return conditions;
}

// The invoice's dates are date-only columns, so both ends compare as days.
function dayRange(from: Date | undefined, to: Date | undefined): Prisma.DateTimeFilter {
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

function sortOrder(
  field: PurchaseInvoiceSortField,
  order: Prisma.SortOrder,
): Prisma.PurchaseInvoiceOrderByWithRelationInput {
  switch (field) {
    case 'supplier':
      return { supplier: { name: order } };
    case 'paymentReference':
      // Invoices without a reference come last either way.
      return { paymentReference: { sort: order, nulls: 'last' } };
    default:
      // The statuses sort in the enum's order: NEW, APPROVED, PAID, REJECTED.
      return { [field]: order };
  }
}

// Books the invoice: a PURCHASE entry on its entry date, debiting its rows and
// crediting its gross total to the trade payables account. The fiscal guard
// runs inside, in this transaction. The invoice's files become documents of
// the entry, as a voucher's are. Returns the entry's id.
async function bookInvoice(
  tx: Prisma.TransactionClient,
  companyId: string,
  userId: string,
  id: string,
): Promise<string> {
  const invoice = await tx.purchaseInvoice.findFirstOrThrow({
    where: { id, companyId },
    include: { supplier: { select: { name: true } }, lines: { orderBy: { position: 'asc' } } },
  });
  if (invoice.lines.length === 0) {
    throw AppError.badRequest('A purchase invoice needs at least one row to be approved');
  }
  const rowsTotal = invoiceTotals(invoice.lines).gross;
  if (toCents(rowsTotal) !== toCents(invoice.totalAmount)) {
    throw AppError.badRequest(
      `The rows come to ${rowsTotal.toFixed(2)}, not to the invoice's total of ${invoice.totalAmount.toFixed(2)}`,
    );
  }
  const chart = await tx.chartOfAccounts.findUnique({
    where: { companyId },
    select: { tradePayablesAccountId: true },
  });
  if (!chart?.tradePayablesAccountId) {
    throw AppError.badRequest('Trade payables account is not set in the chart of accounts');
  }
  const entry = await createJournalEntryInTx(
    tx,
    companyId,
    userId,
    buildPurchaseEntry(
      {
        invoiceNumber: invoice.invoiceNumber,
        entryDate: invoice.entryDate,
        description: invoice.description,
        // Only 'net' or 'gross' get past the column's CHECK constraint.
        vatBasis: invoice.vatBasis as VatBasis,
        lines: invoice.lines,
      },
      invoice.supplier.name,
      chart.tradePayablesAccountId,
    ),
  );
  await tx.storedFile.updateMany({
    where: { purchaseInvoiceId: id, companyId },
    data: { journalEntryId: entry.id },
  });
  return entry.id;
}

export const purchaseInvoiceService = {
  // A new invoice may have no rows yet: the coding can be done later, but an
  // invoice is approved only with some.
  //
  // With a file (the invoice's PDF), the file is stored with the invoice, the
  // way a bank statement's is (see storeFile): the invoice and its file are
  // both there or neither is.
  async create(
    companyId: string,
    userId: string,
    input: PurchaseInvoiceInput,
    file?: InvoiceFileInput,
  ) {
    const insert = async (tx: Prisma.TransactionClient) => {
      await assertReferencesValid(tx, companyId, input);
      await assertInvoiceNumberAvailable(tx, companyId, input);
      const { id } = await tx.purchaseInvoice.create({
        data: {
          companyId,
          createdById: userId,
          ...invoiceColumns(input),
          lines: { create: storedLines(companyId, input) },
        },
        select: { id: true },
      });
      return id;
    };
    if (!file) return readInvoice(await prisma.$transaction(insert));

    // Checked before the upload too, so nothing is stored only to be refused.
    await assertReferencesValid(prisma, companyId, input);
    await assertInvoiceNumberAvailable(prisma, companyId, input);
    const id = await storeFile(companyId, userId, file, async (tx, stored) => {
      const invoiceId = await insert(tx);
      await tx.storedFile.update({ where: { id: stored.id }, data: { purchaseInvoiceId: invoiceId } });
      return invoiceId;
    });
    return readInvoice(id);
  },

  async list(companyId: string, filter: ListPurchaseInvoicesFilter) {
    const where: Prisma.PurchaseInvoiceWhereInput = { companyId };
    if (filter.statuses?.length) where.status = { in: filter.statuses };
    if (filter.supplierId) where.supplierId = filter.supplierId;
    if (filter.invoiceDateFrom || filter.invoiceDateTo) {
      where.invoiceDate = dayRange(filter.invoiceDateFrom, filter.invoiceDateTo);
    }
    if (filter.dueFrom || filter.dueTo) where.dueDate = dayRange(filter.dueFrom, filter.dueTo);
    if (filter.search) where.OR = searchConditions(filter.search);

    // Created first, then by id: the same invoices on the same page each time.
    const orderBy: Prisma.PurchaseInvoiceOrderByWithRelationInput[] = [
      sortOrder(filter.sort ?? 'dueDate', filter.order ?? 'asc'),
      { createdAt: 'asc' },
      { id: 'asc' },
    ];

    const [invoices, total] = await prisma.$transaction([
      prisma.purchaseInvoice.findMany({
        where,
        orderBy,
        take: filter.take,
        skip: filter.skip,
        include: withSummary,
      }),
      prisma.purchaseInvoice.count({ where }),
    ]);
    return { invoices, total };
  },

  async getById(companyId: string, id: string) {
    const invoice = await prisma.purchaseInvoice.findFirst({
      where: { id, companyId },
      include: withDetails,
    });
    if (!invoice) throw invoiceNotFound();
    return invoice;
  },

  // Full replace, rows swapped wholesale like a journal entry's lines.
  async update(companyId: string, id: string, input: PurchaseInvoiceInput) {
    await prisma.$transaction(async (tx) => {
      assertEditable(await lockInvoice(tx, companyId, id));
      await assertReferencesValid(tx, companyId, input);
      await assertInvoiceNumberAvailable(tx, companyId, input, id);
      await tx.purchaseInvoiceLine.deleteMany({ where: { purchaseInvoiceId: id } });
      await tx.purchaseInvoice.update({
        where: { id },
        data: {
          ...invoiceColumns(input),
          lines: { create: storedLines(companyId, input) },
        },
      });
    });
    return readInvoice(id);
  },

  // A booked invoice is reopened before it can go. Its rows go with it; its
  // files stay with the company, unlinked (StoredFile.purchaseInvoiceId,
  // SetNull), as a deleted entry's do.
  async remove(companyId: string, id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const status = await lockInvoice(tx, companyId, id);
      if (status === 'APPROVED' || status === 'PAID') {
        throw AppError.conflict('An approved purchase invoice cannot be deleted; reopen it first');
      }
      await tx.purchaseInvoice.delete({ where: { id } });
    });
  },

  async setStatus(
    companyId: string,
    userId: string,
    id: string,
    change: PurchaseInvoiceStatusChange,
  ) {
    await prisma.$transaction(async (tx) => {
      const from = await lockInvoice(tx, companyId, id);
      const to = change.status;
      if (!TRANSITIONS[from].includes(to)) {
        throw AppError.conflict(`A purchase invoice that is ${from} cannot be changed to ${to}`);
      }
      const now = new Date();
      let data: Prisma.PurchaseInvoiceUncheckedUpdateInput;
      // The entry an approved invoice is reopened from, taken back once the
      // invoice no longer points at it.
      let entryToRemove: string | null = null;

      if (change.status === 'APPROVED' && from === 'NEW') {
        const journalEntryId = await bookInvoice(tx, companyId, userId, id);
        data = { status: to, journalEntryId, approvedById: userId, approvedAt: now };
      } else if (change.status === 'APPROVED') {
        // PAID -> APPROVED: the payment mark comes off.
        data = { status: to, paidById: null, paidAt: null, paymentDate: null };
      } else if (change.status === 'PAID') {
        data = {
          status: to,
          paidById: userId,
          paidAt: now,
          paymentDate: normalizeToUtcDate(change.paymentDate),
        };
      } else if (change.status === 'REJECTED') {
        data = { status: to, rejectedById: userId, rejectedAt: now, rejectionReason: change.reason };
      } else if (from === 'APPROVED') {
        const invoice = await tx.purchaseInvoice.findUniqueOrThrow({
          where: { id },
          select: { journalEntryId: true },
        });
        entryToRemove = invoice.journalEntryId;
        data = { status: to, journalEntryId: null, approvedById: null, approvedAt: null };
      } else {
        // REJECTED -> NEW.
        data = { status: to, rejectedById: null, rejectedAt: null, rejectionReason: null };
      }

      await tx.purchaseInvoice.update({ where: { id }, data });
      if (entryToRemove) {
        // Refused (and the reopening rolled back) once the entry's period is
        // closed, as any change to the entry would be.
        await removeJournalEntryInTx(tx, companyId, entryToRemove);
      }
    });
    return readInvoice(id);
  },

  // Stored like any of the company's files (see storeFile). The status is
  // checked before the upload too, so nothing is stored only to be refused.
  async attachFile(companyId: string, userId: string, id: string, input: AttachFileInput) {
    const invoice = await prisma.purchaseInvoice.findFirst({
      where: { id, companyId },
      select: { status: true },
    });
    if (!invoice) throw invoiceNotFound();
    assertEditable(invoice.status);
    return storeFile(companyId, userId, input, async (tx, file) => {
      assertEditable(await lockInvoice(tx, companyId, id));
      return tx.storedFile.update({ where: { id: file.id }, data: { purchaseInvoiceId: id } });
    });
  },
};
