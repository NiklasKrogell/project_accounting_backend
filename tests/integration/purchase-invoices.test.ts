import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { accountingPeriodService } from '../../src/services/accounting-period.service';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import {
  addMember,
  createAccount,
  createCostCenter,
  createSupplier,
  createTestContext,
} from './helpers';
import { resetTestBucket } from './testStorage';

// The file part of this suite runs against the S3Mock of docker-compose.yml,
// like files.test.ts.

const app = createApp();

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');

type TestContext = Awaited<ReturnType<typeof createTestContext>>;

// The suite's company has FY 2025 with monthly periods, February closed, both
// VAT accounts and the trade payables account set.
let cookie: string;
let companyId: string;
let userId: string;
let other: TestContext;
let expenseAccountId: string;
let vatReceivableAccountId: string;
let payablesAccountId: string;
let supplierId: string;
let otherSupplierId: string;
let novemberPeriodId: string;

let invoiceCounter = 0;

// A new invoice of 100,00 + 25,5 % VAT, entered net, booked in March.
function invoiceBody(overrides: Record<string, unknown> = {}) {
  invoiceCounter += 1;
  return {
    supplierId,
    invoiceNumber: `INV-${invoiceCounter}`,
    invoiceDate: '2025-03-10',
    entryDate: '2025-03-12',
    dueDate: '2025-03-24',
    lines: [{ accountId: expenseAccountId, amount: 100, vatRate: 25.5, description: 'Paperia' }],
    ...overrides,
  };
}

const postInvoice = (body: Record<string, unknown>, as = cookie) =>
  request(app).post('/api/purchase-invoices').set('Cookie', as).send(body);
const putInvoice = (id: string, body: Record<string, unknown>, as = cookie) =>
  request(app).put(`/api/purchase-invoices/${id}`).set('Cookie', as).send(body);
const getInvoice = (id: string, as = cookie) =>
  request(app).get(`/api/purchase-invoices/${id}`).set('Cookie', as);
const deleteInvoice = (id: string, as = cookie) =>
  request(app).delete(`/api/purchase-invoices/${id}`).set('Cookie', as);
const setStatus = (id: string, body: Record<string, unknown>, as = cookie) =>
  request(app).post(`/api/purchase-invoices/${id}/status`).set('Cookie', as).send(body);
const attachFile = (id: string, as = cookie) =>
  request(app)
    .post(`/api/purchase-invoices/${id}/files`)
    .set('Cookie', as)
    .attach('file', PDF, { filename: 'lasku.pdf', contentType: 'application/pdf' });
const getEntry = (id: string) => request(app).get(`/api/journal-entries/${id}`).set('Cookie', cookie);

const APPROVE = { status: 'APPROVED' };

interface InvoiceBody {
  id: string;
  status: string;
  journalEntryId: string | null;
  invoiceNumber: string;
  files: { id: string }[];
}

async function newInvoice(overrides: Record<string, unknown> = {}, as = cookie): Promise<InvoiceBody> {
  const res = await postInvoice(invoiceBody(overrides), as);
  expect(res.status).toBe(201);
  return res.body.data as InvoiceBody;
}

async function approvedInvoice(overrides: Record<string, unknown> = {}): Promise<InvoiceBody> {
  const invoice = await newInvoice(overrides);
  const res = await setStatus(invoice.id, APPROVE);
  expect(res.status).toBe(200);
  return res.body.data as InvoiceBody;
}

beforeAll(async () => {
  await resetTestBucket();
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  userId = ctx.user.id;
  other = await createTestContext('ADMIN');

  expenseAccountId = (await createAccount(companyId, 'Toimistotarvikkeet')).id;
  vatReceivableAccountId = (await createAccount(companyId, 'Arvonlisäverosaaminen')).id;
  const vatPayableAccountId = (await createAccount(companyId, 'Arvonlisäverovelka')).id;
  payablesAccountId = (await createAccount(companyId, 'Ostovelat')).id;
  await prisma.chartOfAccounts.update({
    where: { companyId },
    data: { vatReceivableAccountId, vatPayableAccountId, tradePayablesAccountId: payablesAccountId },
  });
  supplierId = (await createSupplier(companyId, 'Paperitukku Oy')).id;
  otherSupplierId = (await createSupplier(companyId, 'Toinen Oy')).id;

  const fy = await fiscalYearService.create(companyId, {
    startDate: parseDateOnly('2025-01-01'),
    endDate: parseDateOnly('2025-12-31'),
    granularity: 'MONTH',
  });
  const february = fy.periods.find((p) => p.index === 2)!;
  await accountingPeriodService.closePeriod(companyId, february.id);
  novemberPeriodId = fy.periods.find((p) => p.index === 11)!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('purchase invoices CRUD', () => {
  it('creates a new invoice with its rows stored net and its totals', async () => {
    const costCenter = await createCostCenter(companyId, 'PI-1');
    const res = await postInvoice(
      invoiceBody({
        paymentReference: '12 344',
        iban: 'fi21 1234 5600 0007 85',
        bic: 'ndeafihh',
        description: 'Toimistotarvikkeet maaliskuu',
        lines: [
          { accountId: expenseAccountId, amount: 100, vatRate: 25.5, costCenterId: costCenter.id },
          { accountId: expenseAccountId, amount: 40, vatRate: 0 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      supplierId,
      supplier: { id: supplierId, name: 'Paperitukku Oy' },
      paymentReference: '12344',
      invoiceDate: '2025-03-10',
      entryDate: '2025-03-12',
      dueDate: '2025-03-24',
      iban: 'FI2112345600000785',
      bic: 'NDEAFIHH',
      description: 'Toimistotarvikkeet maaliskuu',
      vatBasis: 'net',
      status: 'NEW',
      netTotal: 140,
      vatTotal: 25.5,
      grossTotal: 165.5,
      journalEntryId: null,
      createdById: userId,
      approvedById: null,
      files: [],
    });
    expect(res.body.data.lines).toMatchObject([
      { accountId: expenseAccountId, amount: 100, vatRate: 25.5, vatAmount: 25.5, costCenterId: costCenter.id },
      { accountId: expenseAccountId, amount: 40, vatRate: 0, vatAmount: 0, costCenterId: null },
    ]);

    const got = await getInvoice(res.body.data.id);
    expect(got.status).toBe(200);
    expect(got.body.data.grossTotal).toBe(165.5);
  });

  it('takes rows entered gross apart into net and VAT', async () => {
    const invoice = await newInvoice({
      vatBasis: 'gross',
      lines: [{ accountId: expenseAccountId, amount: 125.5, vatRate: 25.5 }],
    });
    const got = (await getInvoice(invoice.id)).body.data;
    expect(got).toMatchObject({ vatBasis: 'gross', netTotal: 100, vatTotal: 25.5, grossTotal: 125.5 });
    expect(got.lines[0]).toMatchObject({ amount: 100, vatAmount: 25.5 });
  });

  it('saves a new invoice without rows', async () => {
    const invoice = await newInvoice({ lines: [] });
    expect((await getInvoice(invoice.id)).body.data).toMatchObject({ lines: [], grossTotal: 0 });
  });

  it('replaces a new invoice wholesale', async () => {
    const invoice = await newInvoice();
    const res = await putInvoice(
      invoice.id,
      invoiceBody({
        invoiceNumber: invoice.invoiceNumber,
        supplierId: otherSupplierId,
        lines: [{ accountId: expenseAccountId, amount: 10, vatRate: 13.5 }],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ supplierId: otherSupplierId, grossTotal: 11.35 });
    expect(res.body.data.lines).toHaveLength(1);
  });

  it('lists by status, supplier and due date', async () => {
    const ctx = await createTestContext('ADMIN');
    const account = await createAccount(ctx.company.id, 'Kulut');
    const a = await createSupplier(ctx.company.id, 'A Oy');
    const b = await createSupplier(ctx.company.id, 'B Oy');
    const line = { accountId: account.id, amount: 10, vatRate: 0 };
    const post = (fields: Record<string, unknown>) =>
      postInvoice(invoiceBody({ lines: [line], ...fields }), ctx.cookie);
    const late = (await post({ supplierId: a.id, dueDate: '2025-04-30' })).body.data;
    const early = (await post({ supplierId: b.id, dueDate: '2025-03-20' })).body.data;
    const rejected = (await post({ supplierId: a.id, dueDate: '2025-03-25' })).body.data;
    await setStatus(rejected.id, { status: 'REJECTED' }, ctx.cookie);

    const list = (query: Record<string, string>) =>
      request(app).get('/api/purchase-invoices').query(query).set('Cookie', ctx.cookie);
    const ids = (res: request.Response) => res.body.data.map((i: { id: string }) => i.id);

    const all = await list({});
    expect(ids(all)).toEqual([early.id, rejected.id, late.id]);
    expect(all.body.meta).toEqual({ total: 3, take: 100, skip: 0 });
    // A list row counts the files; the invoice read on its own lists them.
    expect(all.body.data[0]).toMatchObject({ fileCount: 0, grossTotal: 10 });
    expect(all.body.data[0].files).toBeUndefined();
    expect(ids(await list({ status: 'NEW' }))).toEqual([early.id, late.id]);
    expect(ids(await list({ supplierId: a.id }))).toEqual([rejected.id, late.id]);
    expect(ids(await list({ dueTo: '2025-03-25' }))).toEqual([early.id, rejected.id]);
  });

  it('deletes a new or a rejected invoice', async () => {
    const fresh = await newInvoice();
    expect((await deleteInvoice(fresh.id)).status).toBe(204);
    expect((await getInvoice(fresh.id)).status).toBe(404);

    const rejected = await newInvoice();
    await setStatus(rejected.id, { status: 'REJECTED' });
    expect((await deleteInvoice(rejected.id)).status).toBe(204);
  });
});

describe('purchase invoice validation', () => {
  it('refuses a due date before the invoice date with 400', async () => {
    const res = await postInvoice(invoiceBody({ invoiceDate: '2025-03-10', dueDate: '2025-03-09' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.dueDate).toBeDefined();
  });

  it.each([
    ['a payment reference with a wrong check digit', { paymentReference: '12345' }],
    ['an RF reference with wrong check digits', { paymentReference: 'RF19539007547034' }],
    ['an IBAN with a wrong checksum', { iban: 'FI2212345600000785' }],
    ['a BIC of the wrong shape', { bic: 'NDEA' }],
    ['an empty invoice number', { invoiceNumber: ' ' }],
    ['a row of no amount', { lines: [{ accountId: '00000000-0000-4000-8000-000000000000', amount: 0, vatRate: 0 }] }],
    ['an unknown basis', { vatBasis: 'brutto' }],
  ])('refuses %s with 400', async (_what, fields) => {
    expect((await postInvoice(invoiceBody(fields))).status).toBe(400);
  });

  it("refuses another company's supplier, account or cost center with 400", async () => {
    const foreignSupplier = await createSupplier(other.company.id);
    const foreignAccount = await createAccount(other.company.id, 'Vieras tili');
    const foreignCostCenter = await createCostCenter(other.company.id, 'X-1');
    expect((await postInvoice(invoiceBody({ supplierId: foreignSupplier.id }))).status).toBe(400);
    expect(
      (await postInvoice(invoiceBody({ lines: [{ accountId: foreignAccount.id, amount: 1, vatRate: 0 }] })))
        .status,
    ).toBe(400);
    expect(
      (
        await postInvoice(
          invoiceBody({
            lines: [{ accountId: expenseAccountId, amount: 1, vatRate: 0, costCenterId: foreignCostCenter.id }],
          }),
        )
      ).status,
    ).toBe(400);
  });

  it('refuses the same invoice number from the same supplier with 409, not from another', async () => {
    const first = await newInvoice();
    const again = await postInvoice(invoiceBody({ invoiceNumber: first.invoiceNumber }));
    expect(again.status).toBe(409);
    const fromAnother = await postInvoice(
      invoiceBody({ invoiceNumber: first.invoiceNumber, supplierId: otherSupplierId }),
    );
    expect(fromAnother.status).toBe(201);

    const second = await newInvoice();
    const renumbered = await putInvoice(second.id, invoiceBody({ invoiceNumber: first.invoiceNumber }));
    expect(renumbered.status).toBe(409);
  });

  it('refuses VAT on the rows of a company that is not VAT-registered', async () => {
    const ctx = await createTestContext('ADMIN');
    await prisma.companySettings.create({ data: { companyId: ctx.company.id, vatRegistered: false } });
    const account = await createAccount(ctx.company.id, 'Kulut');
    const supplier = await createSupplier(ctx.company.id);
    const body = (vatRate: number) =>
      invoiceBody({ supplierId: supplier.id, lines: [{ accountId: account.id, amount: 10, vatRate }] });
    expect((await postInvoice(body(25.5), ctx.cookie)).status).toBe(400);
    expect((await postInvoice(body(0), ctx.cookie)).status).toBe(201);
  });

  it("404s on another company's invoice", async () => {
    const account = await createAccount(other.company.id, 'Kulut');
    const supplier = await createSupplier(other.company.id);
    const foreign = await newInvoice(
      { supplierId: supplier.id, lines: [{ accountId: account.id, amount: 1, vatRate: 0 }] },
      other.cookie,
    );
    expect((await getInvoice(foreign.id)).status).toBe(404);
    expect((await putInvoice(foreign.id, invoiceBody())).status).toBe(404);
    expect((await deleteInvoice(foreign.id)).status).toBe(404);
    expect((await setStatus(foreign.id, APPROVE)).status).toBe(404);
    expect((await attachFile(foreign.id)).status).toBe(404);
  });

  it('lets a VIEWER read but not write or change the status, and a LEDGER approve', async () => {
    const invoice = await newInvoice();
    const viewer = await addMember(companyId, 'VIEWER');
    expect((await getInvoice(invoice.id, viewer.cookie)).status).toBe(200);
    expect((await postInvoice(invoiceBody(), viewer.cookie)).status).toBe(403);
    expect((await setStatus(invoice.id, APPROVE, viewer.cookie)).status).toBe(403);

    const ledger = await addMember(companyId, 'LEDGER');
    expect((await setStatus(invoice.id, APPROVE, ledger.cookie)).status).toBe(200);
  });
});

describe('approving a purchase invoice', () => {
  it('books a PURCHASE entry: rows debited, VAT receivable, gross credited to trade payables', async () => {
    const invoice = await newInvoice({ description: 'Paperit' });
    const res = await setStatus(invoice.id, APPROVE);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'APPROVED', approvedById: userId });
    expect(res.body.data.approvedAt).not.toBeNull();
    const entryId = res.body.data.journalEntryId as string;

    const entry = (await getEntry(entryId)).body.data;
    expect(entry).toMatchObject({
      voucherType: 'PURCHASE',
      date: '2025-03-12',
      description: `Paperitukku Oy ${invoice.invoiceNumber}: Paperit`,
      accountId: payablesAccountId,
      createdById: userId,
    });
    expect(entry.lines).toHaveLength(3);
    expect(entry.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: expenseAccountId,
          type: 'debit',
          amount: 100,
          vatRate: 25.5,
          vatAmount: 25.5,
          isVat: false,
        }),
        expect.objectContaining({ accountId: vatReceivableAccountId, type: 'debit', amount: 25.5, isVat: true }),
        expect.objectContaining({ accountId: payablesAccountId, type: 'credit', amount: 125.5, isVat: false }),
      ]),
    );
  });

  it('books the stored VAT to the cent for rows entered gross', async () => {
    const invoice = await newInvoice({
      vatBasis: 'gross',
      lines: [
        { accountId: expenseAccountId, amount: 10, vatRate: 25.5 },
        { accountId: expenseAccountId, amount: 19.99, vatRate: 25.5 },
        { accountId: expenseAccountId, amount: 3, vatRate: 13.5 },
      ],
    });
    const stored = (await getInvoice(invoice.id)).body.data;
    const approved = (await setStatus(invoice.id, APPROVE)).body.data;
    const entry = (await getEntry(approved.journalEntryId)).body.data;

    const vatRows = entry.lines.filter((l: { isVat: boolean }) => l.isVat);
    expect(vatRows.map((l: { amount: number }) => l.amount)).toEqual(
      stored.lines.map((l: { vatAmount: number }) => l.vatAmount),
    );
    const credit = entry.lines.find((l: { type: string }) => l.type === 'credit');
    expect(credit.amount).toBe(stored.grossTotal);
    // Gross rows entered as 10,00, 19,99 and 3,00.
    expect(stored.grossTotal).toBe(32.99);
  });

  it('refuses an invoice without rows with 400 and leaves it new', async () => {
    const invoice = await newInvoice({ lines: [] });
    const res = await setStatus(invoice.id, APPROVE);
    expect(res.status).toBe(400);
    expect((await getInvoice(invoice.id)).body.data.status).toBe('NEW');
  });

  it('refuses with 400 while no trade payables account is set', async () => {
    const ctx = await createTestContext('ADMIN');
    const account = await createAccount(ctx.company.id, 'Kulut');
    const supplier = await createSupplier(ctx.company.id);
    await fiscalYearService.create(ctx.company.id, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
    const invoice = await newInvoice(
      { supplierId: supplier.id, lines: [{ accountId: account.id, amount: 10, vatRate: 0 }] },
      ctx.cookie,
    );
    const res = await setStatus(invoice.id, APPROVE, ctx.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Trade payables account is not set in the chart of accounts');
  });

  it('refuses an entry date in a closed period (409) or no fiscal year (400)', async () => {
    const closed = await newInvoice({ invoiceDate: '2025-02-01', entryDate: '2025-02-10', dueDate: '2025-02-20' });
    const inClosed = await setStatus(closed.id, APPROVE);
    expect(inClosed.status).toBe(409);
    expect(inClosed.body.error.message).toBe('Accounting period is closed');

    const uncovered = await newInvoice({ invoiceDate: '2024-06-01', entryDate: '2024-06-01', dueDate: '2024-06-15' });
    const noYear = await setStatus(uncovered.id, APPROVE);
    expect(noYear.status).toBe(400);
    expect((await getInvoice(uncovered.id)).body.data).toMatchObject({ status: 'NEW', journalEntryId: null });
  });

  it('books only once when approved twice at the same time', async () => {
    const invoice = await newInvoice();
    const results = await Promise.all([setStatus(invoice.id, APPROVE), setStatus(invoice.id, APPROVE)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const entries = await prisma.journalEntry.count({
      where: { companyId, voucherType: 'PURCHASE', description: `Paperitukku Oy ${invoice.invoiceNumber}` },
    });
    expect(entries).toBe(1);
  });

  it('locks the invoice and its entry against direct changes', async () => {
    const invoice = await approvedInvoice();
    expect((await putInvoice(invoice.id, invoiceBody())).status).toBe(409);
    expect((await deleteInvoice(invoice.id)).status).toBe(409);

    const entry = (await getEntry(invoice.journalEntryId!)).body.data;
    const put = await request(app)
      .put(`/api/journal-entries/${entry.id}`)
      .set('Cookie', cookie)
      .send({
        date: entry.date,
        description: 'Muutettu',
        accountId: entry.accountId,
        lines: [
          { accountId: expenseAccountId, amount: 1, vatRate: 0, type: 'debit' },
          { accountId: payablesAccountId, amount: 1, vatRate: 0, type: 'credit' },
        ],
      });
    expect(put.status).toBe(409);
    const del = await request(app).delete(`/api/journal-entries/${entry.id}`).set('Cookie', cookie);
    expect(del.status).toBe(409);
  });
});

describe('purchase invoice status changes', () => {
  it('reopens an approved invoice: the entry goes and it can be changed again', async () => {
    const invoice = await approvedInvoice();
    const res = await setStatus(invoice.id, { status: 'NEW' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'NEW',
      journalEntryId: null,
      approvedById: null,
      approvedAt: null,
    });
    expect((await getEntry(invoice.journalEntryId!)).status).toBe(404);
    expect((await putInvoice(invoice.id, invoiceBody({ invoiceNumber: invoice.invoiceNumber }))).status).toBe(200);
  });

  it('refuses to reopen once the entry period is closed, and keeps it approved', async () => {
    const invoice = await approvedInvoice({
      invoiceDate: '2025-11-03',
      entryDate: '2025-11-05',
      dueDate: '2025-11-30',
    });
    await accountingPeriodService.closePeriod(companyId, novemberPeriodId);
    const res = await setStatus(invoice.id, { status: 'NEW' });
    expect(res.status).toBe(409);
    expect((await getInvoice(invoice.id)).body.data).toMatchObject({
      status: 'APPROVED',
      journalEntryId: invoice.journalEntryId,
    });
    expect((await getEntry(invoice.journalEntryId!)).status).toBe(200);
  });

  it('rejects with a reason and takes it back', async () => {
    const invoice = await newInvoice();
    const rejected = await setStatus(invoice.id, { status: 'REJECTED', reason: 'Ei meidän tilaus' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      rejectedById: userId,
      rejectionReason: 'Ei meidän tilaus',
      journalEntryId: null,
    });
    expect((await putInvoice(invoice.id, invoiceBody())).status).toBe(409);

    const reopened = await setStatus(invoice.id, { status: 'NEW' });
    expect(reopened.body.data).toMatchObject({
      status: 'NEW',
      rejectedById: null,
      rejectedAt: null,
      rejectionReason: null,
    });
  });

  it('marks an approved invoice paid on a date and takes the mark off', async () => {
    const invoice = await approvedInvoice();
    expect((await setStatus(invoice.id, { status: 'PAID' })).status).toBe(400);

    const paid = await setStatus(invoice.id, { status: 'PAID', paymentDate: '2025-03-20' });
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({
      status: 'PAID',
      paymentDate: '2025-03-20',
      paidById: userId,
      journalEntryId: invoice.journalEntryId,
    });
    expect((await deleteInvoice(invoice.id)).status).toBe(409);

    const unpaid = await setStatus(invoice.id, APPROVE);
    expect(unpaid.status).toBe(200);
    expect(unpaid.body.data).toMatchObject({
      status: 'APPROVED',
      paymentDate: null,
      paidById: null,
      journalEntryId: invoice.journalEntryId,
    });
  });

  it.each([
    ['NEW', 'PAID'],
    ['REJECTED', 'APPROVED'],
    ['REJECTED', 'PAID'],
    ['PAID', 'NEW'],
    ['PAID', 'REJECTED'],
    ['APPROVED', 'REJECTED'],
    ['NEW', 'NEW'],
  ])('refuses %s -> %s with 409', async (from, to) => {
    const invoice = await newInvoice();
    if (from === 'REJECTED') await setStatus(invoice.id, { status: 'REJECTED' });
    if (from === 'APPROVED' || from === 'PAID') await setStatus(invoice.id, APPROVE);
    if (from === 'PAID') await setStatus(invoice.id, { status: 'PAID', paymentDate: '2025-03-20' });
    const body = to === 'PAID' ? { status: to, paymentDate: '2025-03-20' } : { status: to };
    const res = await setStatus(invoice.id, body);
    expect(res.status).toBe(409);
    expect((await getInvoice(invoice.id)).body.data.status).toBe(from);
  });

  it('refuses an unknown status or extra fields with 400', async () => {
    const invoice = await newInvoice();
    expect((await setStatus(invoice.id, { status: 'ARCHIVED' })).status).toBe(400);
    expect((await setStatus(invoice.id, { status: 'APPROVED', reason: 'x' })).status).toBe(400);
  });
});

describe('purchase invoice files', () => {
  const getFile = (id: string) => request(app).get(`/api/files/${id}`).set('Cookie', cookie);

  it('attaches a file to a new invoice and makes it the voucher document on approval', async () => {
    const invoice = await newInvoice();
    const attached = await attachFile(invoice.id);
    expect(attached.status).toBe(201);
    expect(attached.body.data).toMatchObject({
      originalName: 'lasku.pdf',
      mimeType: 'application/pdf',
      purchaseInvoiceId: invoice.id,
      journalEntryId: null,
    });
    const fileId = attached.body.data.id as string;
    expect((await getInvoice(invoice.id)).body.data.files.map((f: { id: string }) => f.id)).toEqual([
      fileId,
    ]);

    // An invoice's file isn't waiting for a voucher.
    const unlinked = await request(app).get('/api/files').query({ unlinked: 'true' }).set('Cookie', cookie);
    expect(unlinked.body.data.map((f: { id: string }) => f.id)).not.toContain(fileId);

    const approved = (await setStatus(invoice.id, APPROVE)).body.data;
    expect((await getFile(fileId)).body.data.journalEntryId).toBe(approved.journalEntryId);
    const entryFiles = await request(app)
      .get('/api/files')
      .query({ journalEntryId: approved.journalEntryId })
      .set('Cookie', cookie);
    expect(entryFiles.body.data.map((f: { id: string }) => f.id)).toEqual([fileId]);

    // Approved: nothing more is attached, and the file stays where it is.
    expect((await attachFile(invoice.id)).status).toBe(409);
    expect((await request(app).delete(`/api/files/${fileId}`).set('Cookie', cookie)).status).toBe(409);
    const unlink = await request(app)
      .patch(`/api/files/${fileId}`)
      .set('Cookie', cookie)
      .send({ journalEntryId: null });
    expect(unlink.status).toBe(409);

    // Reopened, the file leaves the deleted entry but stays with the invoice.
    await setStatus(invoice.id, { status: 'NEW' });
    expect((await getFile(fileId)).body.data).toMatchObject({
      journalEntryId: null,
      purchaseInvoiceId: invoice.id,
    });
  });

  it('keeps the files of a deleted invoice with the company, unlinked', async () => {
    const invoice = await newInvoice();
    const fileId = (await attachFile(invoice.id)).body.data.id as string;
    expect((await deleteInvoice(invoice.id)).status).toBe(204);
    const file = await getFile(fileId);
    expect(file.status).toBe(200);
    expect(file.body.data).toMatchObject({ purchaseInvoiceId: null, journalEntryId: null });
  });

  it('lets a file of a new invoice be deleted through the file API', async () => {
    const invoice = await newInvoice();
    const fileId = (await attachFile(invoice.id)).body.data.id as string;
    expect((await request(app).delete(`/api/files/${fileId}`).set('Cookie', cookie)).status).toBe(204);
    expect((await getInvoice(invoice.id)).body.data.files).toEqual([]);
  });
});

describe('what purchase invoice rows hold on to', () => {
  it('blocks deleting an account or a cost center used on an invoice row', async () => {
    const account = await createAccount(companyId, 'Rivitili');
    const costCenter = await createCostCenter(companyId, 'PI-2');
    await newInvoice({
      lines: [{ accountId: account.id, amount: 5, vatRate: 0, costCenterId: costCenter.id }],
    });
    expect((await request(app).delete(`/api/accounts/${account.id}`).set('Cookie', cookie)).status).toBe(409);
    expect(
      (await request(app).delete(`/api/cost-centers/${costCenter.id}`).set('Cookie', cookie)).status,
    ).toBe(409);
  });
});
