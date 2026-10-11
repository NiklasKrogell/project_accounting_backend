import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { MAX_FILE_SIZE_BYTES } from '../../src/lib/fileType';
import { objectStorage } from '../../src/lib/objectStorage';
import { companyKeyPrefix, companyObjectKey } from '../../src/lib/storageKey';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { addMember, createAccount, createCashAndBankAccount, createTestContext } from './helpers';
import { listObjectKeys, resetTestBucket } from './testStorage';

// Like files.test.ts, this runs against the S3Mock of docker-compose.yml: a
// bank statement is a stored file with a row of its own beside it.

const app = createApp();

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('ei oikeasti kuva'),
]);

const STATEMENT_NOT_FOUND = { error: { message: 'Bank statement not found' } };

type TestContext = Awaited<ReturnType<typeof createTestContext>>;

// The suite's company has FY 2025 open, both VAT accounts set and one bank
// account booked on `bankLedgerAccountId`.
let cookie: string;
let companyId: string;
let other: TestContext;
let bankLedgerAccountId: string;
let bankAccountId: string;
let salesAccountId: string;
let expenseAccountId: string;

interface ImportOptions {
  content?: Buffer;
  filename?: string;
}

function importStatement(as: string, options: ImportOptions = {}) {
  return request(app)
    .post('/api/bank-statements')
    .set('Cookie', as)
    .attach('file', options.content ?? PDF, {
      filename: options.filename ?? 'tiliote.pdf',
      contentType: 'application/pdf',
    });
}

interface StatementBody {
  id: string;
  posted: boolean;
  bankAccountId: string | null;
  file: { id: string; originalName: string; size: number };
  entryCount: number;
}

async function importedStatement(as: string, options: ImportOptions = {}): Promise<StatementBody> {
  const res = await importStatement(as, options);
  expect(res.status).toBe(201);
  return res.body.data as StatementBody;
}

const getStatement = (as: string, id: string) =>
  request(app).get(`/api/bank-statements/${id}`).set('Cookie', as);
const getSummary = (as: string, id: string) =>
  request(app).get(`/api/bank-statements/${id}/summary`).set('Cookie', as);
const patchStatement = (as: string, id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/bank-statements/${id}`).set('Cookie', as).send(body);
const listStatements = (as: string, query: Record<string, string> = {}) =>
  request(app).get('/api/bank-statements').query(query).set('Cookie', as);

// A sale of 100,00 at 25,5 % paid to the bank; amounts are net.
function saleBody(overrides: Record<string, unknown> = {}) {
  return {
    voucherType: 'PAYMENT',
    date: '2025-01-15',
    description: 'Myyntisuoritus',
    accountId: bankLedgerAccountId,
    lines: [
      { accountId: bankLedgerAccountId, amount: 125.5, type: 'debit', vatRate: 0 },
      { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5 },
    ],
    ...overrides,
  };
}

// A purchase of 200,00 at 13,5 % paid from the bank.
function purchaseBody(overrides: Record<string, unknown> = {}) {
  return {
    voucherType: 'PAYMENT',
    date: '2025-01-20',
    description: 'Ostolaskun maksu',
    accountId: bankLedgerAccountId,
    lines: [
      { accountId: expenseAccountId, amount: 200, type: 'debit', vatRate: 13.5 },
      { accountId: bankLedgerAccountId, amount: 227, type: 'credit', vatRate: 0 },
    ],
    ...overrides,
  };
}

const postEntry = (as: string, body: Record<string, unknown>) =>
  request(app).post('/api/journal-entries').set('Cookie', as).send(body);

const objectsOf = (ofCompanyId: string) => listObjectKeys(companyKeyPrefix(ofCompanyId));

const silenceErrorLog = () => vi.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  await resetTestBucket();
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  other = await createTestContext('ADMIN');

  bankLedgerAccountId = (await createCashAndBankAccount(companyId, 'Pankkitili')).id;
  salesAccountId = (await createAccount(companyId, 'Myynti')).id;
  expenseAccountId = (await createAccount(companyId, 'Kulut')).id;
  const vatReceivableAccountId = (await createAccount(companyId, 'Arvonlisäverosaaminen')).id;
  const vatPayableAccountId = (await createAccount(companyId, 'Arvonlisäverovelka')).id;
  await prisma.chartOfAccounts.update({
    where: { companyId },
    data: { vatReceivableAccountId, vatPayableAccountId },
  });
  bankAccountId = (
    await prisma.bankAccount.create({
      data: {
        companyId,
        name: 'Käyttötili',
        iban: 'FI2112345600000785',
        accountId: bankLedgerAccountId,
      },
    })
  ).id;
  await fiscalYearService.create(companyId, {
    startDate: parseDateOnly('2025-01-01'),
    endDate: parseDateOnly('2025-12-31'),
    granularity: 'MONTH',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/bank-statements', () => {
  it('stores the PDF as a file of the company and makes an unposted statement of it', async () => {
    const res = await importStatement(cookie, { filename: 'tiliote_tammikuu.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      posted: false,
      bankAccountId: null,
      bankAccount: null,
      file: { originalName: 'tiliote_tammikuu.pdf', size: PDF.length },
      entryCount: 0,
    });

    const fileId = res.body.data.file.id as string;
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.companyId).toBe(companyId);
    expect(file.mimeType).toBe('application/pdf');
    expect(await objectsOf(companyId)).toContain(companyObjectKey(companyId, fileId));

    // The bytes are read through the file API, like any other file's.
    const content = await request(app)
      .get(`/api/files/${fileId}/content`)
      .set('Cookie', cookie)
      .responseType('blob');
    expect(content.status).toBe(200);
    expect(Buffer.compare(content.body as Buffer, PDF)).toBe(0);
  });

  it('takes only a PDF, whatever the file is called', async () => {
    const fresh = await createTestContext('ADMIN');
    // An image is a storable file, but not a bank statement.
    const image = await importStatement(fresh.cookie, { content: PNG, filename: 'tiliote.pdf' });
    expect(image.status).toBe(415);
    expect(image.body.error.message).toBe('Unsupported file type: a bank statement must be a PDF');
    const html = await importStatement(fresh.cookie, {
      content: Buffer.from('<!doctype html><script>alert(1)</script>'),
    });
    expect(html.status).toBe(415);

    expect(await prisma.bankStatement.count({ where: { companyId: fresh.company.id } })).toBe(0);
    expect(await prisma.storedFile.count({ where: { companyId: fresh.company.id } })).toBe(0);
    expect(await objectsOf(fresh.company.id)).toEqual([]);
  });

  it('refuses a request without a usable file with 400', async () => {
    const noFile = await request(app).post('/api/bank-statements').set('Cookie', cookie).send({});
    expect(noFile.status).toBe(400);

    const empty = await importStatement(cookie, { content: Buffer.alloc(0) });
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('File is empty');
  });

  it('refuses a file over the size limit with 413', async () => {
    const fresh = await createTestContext('ADMIN');
    const tooLarge = await importStatement(fresh.cookie, {
      content: Buffer.concat([PDF, Buffer.alloc(MAX_FILE_SIZE_BYTES - PDF.length + 1)]),
    });
    expect(tooLarge.status).toBe(413);
    expect(await objectsOf(fresh.company.id)).toEqual([]);
  });

  it('records neither a statement nor a file when the object cannot be stored', async () => {
    silenceErrorLog();
    const fresh = await createTestContext('ADMIN');
    vi.spyOn(objectStorage, 'put').mockRejectedValueOnce(new Error('storage is down'));

    const res = await importStatement(fresh.cookie);
    expect(res.status).toBe(500);
    expect(await prisma.bankStatement.count({ where: { companyId: fresh.company.id } })).toBe(0);
    expect(await prisma.storedFile.count({ where: { companyId: fresh.company.id } })).toBe(0);
  });
});

describe('GET /api/bank-statements', () => {
  it('pages the statements newest first and filters them by posted', async () => {
    const fresh = await createTestContext('ADMIN');
    const first = await importedStatement(fresh.cookie, { filename: 'a.pdf' });
    const second = await importedStatement(fresh.cookie, { filename: 'b.pdf' });
    const third = await importedStatement(fresh.cookie, { filename: 'c.pdf' });
    expect((await patchStatement(fresh.cookie, second.id, { posted: true })).status).toBe(200);

    const all = await listStatements(fresh.cookie);
    expect(all.status).toBe(200);
    expect(all.body.data.map((s: StatementBody) => s.id)).toEqual([third.id, second.id, first.id]);
    expect(all.body.meta).toEqual({ total: 3, take: 100, skip: 0 });

    const unposted = await listStatements(fresh.cookie, { posted: 'false' });
    expect(unposted.body.data.map((s: StatementBody) => s.id)).toEqual([third.id, first.id]);
    expect(unposted.body.meta.total).toBe(2);

    const posted = await listStatements(fresh.cookie, { posted: 'true' });
    expect(posted.body.data.map((s: StatementBody) => s.id)).toEqual([second.id]);

    const lastPage = await listStatements(fresh.cookie, { take: '2', skip: '2' });
    expect(lastPage.body.data.map((s: StatementBody) => s.id)).toEqual([first.id]);
    expect(lastPage.body.meta).toEqual({ total: 3, take: 2, skip: 2 });

    expect((await listStatements(fresh.cookie, { posted: 'maybe' })).status).toBe(400);
    expect((await listStatements(fresh.cookie, { take: '0' })).status).toBe(400);
  });
});

describe('PATCH /api/bank-statements/:id', () => {
  it('sets and clears the bank account and the posted mark, each on its own', async () => {
    const statement = await importedStatement(cookie);

    const withAccount = await patchStatement(cookie, statement.id, { bankAccountId });
    expect(withAccount.status).toBe(200);
    expect(withAccount.body.data.bankAccountId).toBe(bankAccountId);
    expect(withAccount.body.data.bankAccount).toEqual({
      id: bankAccountId,
      name: 'Käyttötili',
      iban: 'FI2112345600000785',
      accountId: bankLedgerAccountId,
    });
    expect(withAccount.body.data.posted).toBe(false);

    const posted = await patchStatement(cookie, statement.id, { posted: true });
    expect(posted.status).toBe(200);
    expect(posted.body.data.posted).toBe(true);
    // Left out of the body, the bank account stays.
    expect(posted.body.data.bankAccountId).toBe(bankAccountId);

    const cleared = await patchStatement(cookie, statement.id, { bankAccountId: null, posted: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ bankAccountId: null, bankAccount: null, posted: false });
  });

  it("refuses a bank account that is not the company's, and anything else in the body", async () => {
    const statement = await importedStatement(cookie);
    const foreignLedgerAccount = await createCashAndBankAccount(other.company.id, 'Pankkitili');
    const foreignBankAccount = await prisma.bankAccount.create({
      data: {
        companyId: other.company.id,
        name: 'Vieras tili',
        iban: 'FI2112345600000785',
        accountId: foreignLedgerAccount.id,
      },
    });

    const foreign = await patchStatement(cookie, statement.id, {
      bankAccountId: foreignBankAccount.id,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.message).toBe('Bank account does not exist in this company');
    expect((await patchStatement(cookie, statement.id, { bankAccountId: randomUUID() })).status).toBe(400);

    expect((await patchStatement(cookie, statement.id, { fileId: randomUUID() })).status).toBe(400);
    expect((await patchStatement(cookie, statement.id, { posted: 'yes' })).status).toBe(400);
    expect((await getStatement(cookie, statement.id)).body.data.bankAccountId).toBeNull();
  });
});

describe('company isolation and roles', () => {
  it("answers another company's member as for a statement that does not exist", async () => {
    const statement = await importedStatement(cookie);

    for (const target of [statement.id, randomUUID()]) {
      const answers = [
        await getStatement(other.cookie, target),
        await getSummary(other.cookie, target),
        await patchStatement(other.cookie, target, { posted: true }),
      ];
      for (const res of answers) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(STATEMENT_NOT_FOUND);
      }
    }
    expect((await getStatement(other.cookie, 'not-an-id')).status).toBe(400);

    const theirs = await listStatements(other.cookie);
    expect(theirs.body.data.map((s: StatementBody) => s.id)).not.toContain(statement.id);
    expect((await getStatement(cookie, statement.id)).body.data.posted).toBe(false);
    // Nor does the file open to them.
    const content = await request(app)
      .get(`/api/files/${statement.file.id}/content`)
      .set('Cookie', other.cookie);
    expect(content.status).toBe(404);
  });

  it('lets a VIEWER read but answers 403 to importing and changing', async () => {
    const statement = await importedStatement(cookie);
    const viewer = await addMember(companyId, 'VIEWER');

    expect((await listStatements(viewer.cookie)).status).toBe(200);
    expect((await getStatement(viewer.cookie, statement.id)).status).toBe(200);
    expect((await getSummary(viewer.cookie, statement.id)).status).toBe(200);

    expect((await importStatement(viewer.cookie)).status).toBe(403);
    expect((await patchStatement(viewer.cookie, statement.id, { posted: true })).status).toBe(403);
    expect((await getStatement(cookie, statement.id)).body.data.posted).toBe(false);
  });

  it('lets a LEDGER import and change', async () => {
    const ledger = await addMember(companyId, 'LEDGER');
    const statement = await importedStatement(ledger.cookie);
    expect((await patchStatement(ledger.cookie, statement.id, { posted: true })).status).toBe(200);
  });

  it('answers 401 without a session', async () => {
    expect((await request(app).get('/api/bank-statements')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/bank-statements')
          .attach('file', PDF, { filename: 'tiliote.pdf' })
      ).status,
    ).toBe(401);
  });
});

describe('journal entries of a bank statement', () => {
  const listEntries = (query: Record<string, string>) =>
    request(app).get('/api/journal-entries').query(query).set('Cookie', cookie);

  it('books an entry from the statement and lists the entries of that statement only', async () => {
    const statement = await importedStatement(cookie);
    const anotherStatement = await importedStatement(cookie);

    const booked = await postEntry(cookie, saleBody({ bankStatementId: statement.id }));
    expect(booked.status).toBe(201);
    expect(booked.body.data.bankStatementId).toBe(statement.id);
    const elsewhere = await postEntry(cookie, saleBody({ bankStatementId: anotherStatement.id }));
    expect(elsewhere.status).toBe(201);
    const loose = await postEntry(cookie, saleBody());
    expect(loose.status).toBe(201);
    expect(loose.body.data.bankStatementId).toBeNull();

    const ofStatement = await listEntries({ bankStatementId: statement.id });
    expect(ofStatement.status).toBe(200);
    expect(ofStatement.body.data.map((e: { id: string }) => e.id)).toEqual([booked.body.data.id]);
    expect(ofStatement.body.meta.total).toBe(1);
    expect((await listEntries({ bankStatementId: 'not-an-id' })).status).toBe(400);

    expect((await getStatement(cookie, statement.id)).body.data.entryCount).toBe(1);
  });

  it('keeps an entry with its statement when the entry is changed', async () => {
    const statement = await importedStatement(cookie);
    const anotherStatement = await importedStatement(cookie);
    const booked = await postEntry(cookie, saleBody({ bankStatementId: statement.id }));
    expect(booked.status).toBe(201);

    const { voucherType: _voucherType, ...update } = saleBody({
      description: 'Korjattu selite',
      bankStatementId: anotherStatement.id,
    });
    const changed = await request(app)
      .put(`/api/journal-entries/${booked.body.data.id}`)
      .set('Cookie', cookie)
      .send(update);
    expect(changed.status).toBe(200);
    expect(changed.body.data.description).toBe('Korjattu selite');
    expect(changed.body.data.bankStatementId).toBe(statement.id);
  });

  it("refuses a statement that is not the company's", async () => {
    const theirs = await importedStatement(other.cookie);
    for (const bankStatementId of [theirs.id, randomUUID()]) {
      const res = await postEntry(cookie, saleBody({ bankStatementId }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Bank statement does not exist in this company');
    }
    expect((await postEntry(cookie, saleBody({ bankStatementId: 'not-an-id' }))).status).toBe(400);
  });

  it('leaves the statement in place when its entry is deleted', async () => {
    const statement = await importedStatement(cookie);
    const booked = await postEntry(cookie, saleBody({ bankStatementId: statement.id }));
    expect(booked.status).toBe(201);

    const removed = await request(app)
      .delete(`/api/journal-entries/${booked.body.data.id}`)
      .set('Cookie', cookie);
    expect(removed.status).toBe(204);

    const after = await getStatement(cookie, statement.id);
    expect(after.status).toBe(200);
    expect(after.body.data.entryCount).toBe(0);
  });
});

describe('GET /api/bank-statements/:id/summary', () => {
  it("sums the statement's own entries on the bank account and their VAT by rate", async () => {
    const statement = await importedStatement(cookie);
    const anotherStatement = await importedStatement(cookie);
    expect((await postEntry(cookie, saleBody({ bankStatementId: statement.id }))).status).toBe(201);
    expect((await postEntry(cookie, purchaseBody({ bankStatementId: statement.id }))).status).toBe(201);
    // Neither another statement's entries nor loose ones are counted.
    expect((await postEntry(cookie, saleBody({ bankStatementId: anotherStatement.id }))).status).toBe(201);
    expect((await postEntry(cookie, saleBody())).status).toBe(201);

    // Without a bank account there is nothing to say which lines are the bank's.
    const withoutAccount = await getSummary(cookie, statement.id);
    expect(withoutAccount.status).toBe(200);
    expect(withoutAccount.body.data.bank).toBeNull();

    expect((await patchStatement(cookie, statement.id, { bankAccountId })).status).toBe(200);
    const summary = await getSummary(cookie, statement.id);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({
      bank: { deposits: 125.5, withdrawals: 227, net: -101.5 },
      vat: {
        receivable: 27,
        payable: 25.5,
        byRate: [
          { vatRate: 13.5, side: 'debit', base: 200, vat: 27 },
          { vatRate: 25.5, side: 'credit', base: 100, vat: 25.5 },
        ],
      },
    });
  });

  it('is all zeros for a statement nothing has been booked from', async () => {
    const statement = await importedStatement(cookie);
    expect((await patchStatement(cookie, statement.id, { bankAccountId })).status).toBe(200);
    const summary = await getSummary(cookie, statement.id);
    expect(summary.body.data).toEqual({
      bank: { deposits: 0, withdrawals: 0, net: 0 },
      vat: { receivable: 0, payable: 0, byRate: [] },
    });
  });
});

describe("a bank statement's file in the file API", () => {
  const deleteFile = (id: string) => request(app).delete(`/api/files/${id}`).set('Cookie', cookie);
  const listFiles = (query: Record<string, string> = {}) =>
    request(app).get('/api/files').query(query).set('Cookie', cookie);

  it('cannot be deleted from under the statement', async () => {
    const statement = await importedStatement(cookie);

    const res = await deleteFile(statement.file.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('File is the PDF of a bank statement');

    expect((await getStatement(cookie, statement.id)).status).toBe(200);
    const content = await request(app)
      .get(`/api/files/${statement.file.id}/content`)
      .set('Cookie', cookie);
    expect(content.status).toBe(200);
  });

  it('cannot be made the document of a voucher', async () => {
    const statement = await importedStatement(cookie);
    const entry = await postEntry(cookie, saleBody());
    expect(entry.status).toBe(201);

    const linked = await request(app)
      .patch(`/api/files/${statement.file.id}`)
      .set('Cookie', cookie)
      .send({ journalEntryId: entry.body.data.id });
    expect(linked.status).toBe(409);
    expect(linked.body.error.message).toBe('File is the PDF of a bank statement');
  });

  it("is one of the company's files, but not one waiting for an entry", async () => {
    const statement = await importedStatement(cookie);

    const all = await listFiles({ take: '500' });
    expect(all.body.data.map((file: { id: string }) => file.id)).toContain(statement.file.id);
    const unlinked = await listFiles({ unlinked: 'true', take: '500' });
    expect(unlinked.body.data.map((file: { id: string }) => file.id)).not.toContain(
      statement.file.id,
    );
  });
});
