import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { addMember, createAccount, createCashAndBankAccount, createTestContext } from './helpers';
import { resetTestBucket } from './testStorage';

// Statements are PDFs in storage (see bank-statements.test.ts), so this needs
// the S3Mock of docker-compose.yml too. The CSV files are made up, in Nordea's
// current layout (see tests/unit/bankCsv.test.ts for the layouts themselves).

const app = createApp();

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');
const OWN_IBAN = 'FI1410093000123458';
const OWN_SPACED = 'FI14 1009 3000 1234 58';

const HEADER = 'Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viesti;Viitenumero;Saldo;Valuutta;';
const row = (date: string, amount: string, name: string, message = '', payee = '') =>
  `${date};${amount};${OWN_SPACED};${payee};${name};${name};${message};;;EUR;`;
const csv = (...rows: string[]) =>
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([HEADER, ...rows].join('\n'), 'utf8')]);

// Newest first, as Nordea lists them: a payment, two identical card
// payments, a pending one. All statements here are of the same bank account,
// where a transaction imported once is a duplicate ever after, so each test
// gets transactions of its own: the counterparties carry the test's tag.
const january = (tag: string) =>
  csv(
    'Varaus;-23,90;' + OWN_SPACED + ';;Kahvila;Kahvila;;;;EUR;',
    row('2025/01/15', '-120,00', `Vuokranantaja ${tag}`, 'Vuokra', 'FI5940008000123456'),
    row('2025/01/10', '-4,50', `Kioski ${tag}`),
    row('2025/01/10', '-4,50', `Kioski ${tag}`),
  );

type TestContext = Awaited<ReturnType<typeof createTestContext>>;

let cookie: string;
let companyId: string;
let other: TestContext;
let bankLedgerAccountId: string;
let expenseAccountId: string;
let bankAccountId: string;

async function newStatement(as: string, withBankAccount: string | null = bankAccountId): Promise<string> {
  const res = await request(app)
    .post('/api/bank-statements')
    .set('Cookie', as)
    .attach('file', PDF, { filename: 'tiliote.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  if (withBankAccount) {
    const patched = await request(app)
      .patch(`/api/bank-statements/${id}`)
      .set('Cookie', as)
      .send({ bankAccountId: withBankAccount });
    expect(patched.status).toBe(200);
  }
  return id;
}

function sendCsv(
  as: string,
  statementId: string,
  path: 'csv-preview' | 'lines',
  content: Buffer,
  options: { mapping?: unknown; filename?: string } = {},
) {
  const req = request(app).post(`/api/bank-statements/${statementId}/${path}`).set('Cookie', as);
  if (options.mapping !== undefined) req.field('mapping', JSON.stringify(options.mapping));
  return req.attach('file', content, {
    filename: options.filename ?? `Käyttötili ${OWN_SPACED} - 2025-01-31.csv`,
    contentType: 'text/csv',
  });
}

const listLines = (as: string, statementId: string) =>
  request(app).get(`/api/bank-statements/${statementId}/lines`).set('Cookie', as);

interface LineBody {
  id: string;
  bookingDate: string;
  amount: number;
  counterparty: string;
  journalEntry: { id: string; voucherType: string; voucherNumber: number } | null;
}

// An entry booking a payment from the bank: the bank line and the expense.
function bookingBody(line: { amount: number; bookingDate: string }, overrides: Record<string, unknown> = {}) {
  const amount = Math.abs(line.amount);
  return {
    voucherType: 'PAYMENT',
    date: line.bookingDate,
    description: 'Kirjattu tapahtumasta',
    accountId: bankLedgerAccountId,
    lines: [
      { accountId: expenseAccountId, amount, type: 'debit', vatRate: 0 },
      { accountId: bankLedgerAccountId, amount, type: 'credit', vatRate: 0 },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  await resetTestBucket();
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  other = await createTestContext('ADMIN');

  bankLedgerAccountId = (await createCashAndBankAccount(companyId, 'Pankkitili')).id;
  expenseAccountId = (await createAccount(companyId, 'Kulut')).id;
  bankAccountId = (
    await prisma.bankAccount.create({
      data: { companyId, name: 'Käyttötili', iban: OWN_IBAN, accountId: bankLedgerAccountId },
    })
  ).id;
  await fiscalYearService.create(companyId, {
    startDate: parseDateOnly('2025-01-01'),
    endDate: parseDateOnly('2025-12-31'),
    granularity: 'MONTH',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/bank-statements/:id/csv-preview', () => {
  it('shows what an import would do, and writes nothing', async () => {
    const statementId = await newStatement(cookie);
    const res = await sendCsv(cookie, statementId, 'csv-preview', january('T1'));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      layout: 'nordea',
      encoding: 'utf-8',
      delimiter: ';',
      mappingProblem: null,
      accountMismatch: null,
      skipped: [{ lineNumber: 2, reason: 'pending' }],
    });
    expect(res.body.data.columns[0]).toBe('Kirjauspäivä');
    expect(res.body.data.lines).toEqual([
      expect.objectContaining({ bookingDate: '2025-01-10', amount: -4.5, counterparty: 'Kioski T1', duplicate: false }),
      expect.objectContaining({ bookingDate: '2025-01-10', amount: -4.5, counterparty: 'Kioski T1', duplicate: false }),
      expect.objectContaining({
        bookingDate: '2025-01-15',
        amount: -120,
        counterparty: 'Vuokranantaja T1',
        counterpartyAccount: 'FI5940008000123456',
        message: 'Vuokra',
        duplicate: false,
      }),
    ]);
    expect(await prisma.bankStatementLine.count({ where: { bankStatementId: statementId } })).toBe(0);
  });

  it('reads the file with the columns chosen, and says what is missing', async () => {
    const statementId = await newStatement(cookie);
    // Name and message swapped by hand.
    const swapped = await sendCsv(cookie, statementId, 'csv-preview', january('T2'), {
      mapping: { bookingDate: [0], amount: [1], counterparty: [6], message: [4] },
    });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.lines[2]).toMatchObject({ counterparty: 'Vuokra', message: 'Vuokranantaja T2' });

    const noAmount = await sendCsv(cookie, statementId, 'csv-preview', january('T2'), {
      mapping: { bookingDate: [0] },
    });
    expect(noAmount.status).toBe(200);
    expect(noAmount.body.data.mappingProblem).toBe('Choose the column of the amount');
    expect(noAmount.body.data.lines).toEqual([]);

    const badMapping = await sendCsv(cookie, statementId, 'csv-preview', january('T2'), {
      mapping: { bookingDate: [0], amount: [1], colour: [2] },
    });
    expect(badMapping.status).toBe(400);
  });

  it("warns when the file is another account's", async () => {
    const statementId = await newStatement(cookie);
    const res = await sendCsv(cookie, statementId, 'csv-preview', january('T3'), {
      filename: 'Käyttötili FI59 4000 8000 1234 56 - 2025-01-31.csv',
    });
    expect(res.body.data.accountMismatch).toBe('FI5940008000123456');
  });

  it('refuses a file that is no CSV', async () => {
    const statementId = await newStatement(cookie);
    const res = await sendCsv(cookie, statementId, 'csv-preview', PDF);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The file is not a CSV file');
  });
});

describe('POST /api/bank-statements/:id/lines', () => {
  it('adds the transactions, and an import of the same file again adds none', async () => {
    const statementId = await newStatement(cookie);

    const first = await sendCsv(cookie, statementId, 'lines', january('T5'));
    expect(first.status).toBe(201);
    // Both identical card payments are kept.
    expect(first.body.data).toEqual({ imported: 3, duplicates: 0, skipped: 1 });

    const again = await sendCsv(cookie, statementId, 'lines', january('T5'));
    expect(again.body.data).toEqual({ imported: 0, duplicates: 3, skipped: 1 });

    const lines = await listLines(cookie, statementId);
    expect(lines.status).toBe(200);
    expect(lines.body.data.map((line: LineBody) => [line.bookingDate, line.amount, line.counterparty])).toEqual([
      ['2025-01-10', -4.5, 'Kioski T5'],
      ['2025-01-10', -4.5, 'Kioski T5'],
      ['2025-01-15', -120, 'Vuokranantaja T5'],
    ]);
    expect(lines.body.data[0].journalEntry).toBeNull();
  });

  it('skips what another statement of the same bank account already has', async () => {
    const earlier = await newStatement(cookie);
    expect((await sendCsv(cookie, earlier, 'lines', january('T6'))).status).toBe(201);

    const overlapping = await newStatement(cookie);
    const res = await sendCsv(
      cookie,
      overlapping,
      'lines',
      csv(row('2025/01/20', '-9,90', 'Uusi kauppa'), row('2025/01/15', '-120,00', 'Vuokranantaja T6', 'Vuokra', 'FI5940008000123456')),
    );
    expect(res.body.data).toEqual({ imported: 1, duplicates: 1, skipped: 0 });

    // The preview says the same before anything is imported.
    const preview = await sendCsv(cookie, (await newStatement(cookie)), 'csv-preview', january('T6'));
    expect(preview.body.data.lines.map((line: { duplicate: boolean }) => line.duplicate)).toEqual([true, true, true]);
  });

  it('needs the bank account of the statement first', async () => {
    const statementId = await newStatement(cookie, null);
    const res = await sendCsv(cookie, statementId, 'lines', january('T7'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      "Choose the bank statement's bank account before importing its transactions",
    );
  });

  it('refuses columns without a date or an amount', async () => {
    const statementId = await newStatement(cookie);
    const res = await sendCsv(cookie, statementId, 'lines', january('T8'), { mapping: { amount: [1] } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Choose the column of the booking date');
  });
});

describe('DELETE /api/bank-statements/:id/lines/:lineId', () => {
  it('deletes an unbooked transaction and refuses a booked one', async () => {
    const statementId = await newStatement(cookie);
    await sendCsv(cookie, statementId, 'lines', january('T9'));
    const [first, second] = (await listLines(cookie, statementId)).body.data as LineBody[];

    const booked = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(bookingBody(first!, { bankStatementLineId: first!.id }));
    expect(booked.status).toBe(201);

    const refused = await request(app)
      .delete(`/api/bank-statements/${statementId}/lines/${first!.id}`)
      .set('Cookie', cookie);
    expect(refused.status).toBe(409);

    const deleted = await request(app)
      .delete(`/api/bank-statements/${statementId}/lines/${second!.id}`)
      .set('Cookie', cookie);
    expect(deleted.status).toBe(204);
    expect((await listLines(cookie, statementId)).body.data).toHaveLength(2);
  });
});

describe('booking a transaction', () => {
  it('links the transaction to the entry, once, and frees it when the entry is deleted', async () => {
    const statementId = await newStatement(cookie);
    await sendCsv(cookie, statementId, 'lines', january('T10'));
    const line = ((await listLines(cookie, statementId)).body.data as LineBody[])[2]!;

    // The statement is taken from the transaction when it isn't given.
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(bookingBody(line, { bankStatementLineId: line.id }));
    expect(res.status).toBe(201);
    expect(res.body.data.bankStatementId).toBe(statementId);

    const linked = ((await listLines(cookie, statementId)).body.data as LineBody[])[2]!;
    expect(linked.journalEntry).toEqual({
      id: res.body.data.id,
      voucherType: 'PAYMENT',
      voucherNumber: res.body.data.voucherNumber,
    });

    const twice = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(bookingBody(line, { bankStatementLineId: line.id, bankStatementId: statementId }));
    expect(twice.status).toBe(409);
    expect(twice.body.error.message).toBe('The transaction is already booked');

    const removed = await request(app).delete(`/api/journal-entries/${res.body.data.id}`).set('Cookie', cookie);
    expect(removed.status).toBe(204);
    expect(((await listLines(cookie, statementId)).body.data as LineBody[])[2]!.journalEntry).toBeNull();
  });

  it('refuses a transaction of another statement or company', async () => {
    const statementId = await newStatement(cookie);
    const elsewhere = await newStatement(cookie);
    await sendCsv(cookie, statementId, 'lines', january('T11'));
    const line = ((await listLines(cookie, statementId)).body.data as LineBody[])[0]!;

    const wrongStatement = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(bookingBody(line, { bankStatementLineId: line.id, bankStatementId: elsewhere }));
    expect(wrongStatement.status).toBe(400);
    expect(wrongStatement.body.error.message).toBe('The transaction is not on this bank statement');

    for (const bankStatementLineId of [randomUUID(), line.id]) {
      const res = await request(app)
        .post('/api/journal-entries')
        .set('Cookie', bankStatementLineId === line.id ? other.cookie : cookie)
        .send(bookingBody(line, { bankStatementLineId }));
      expect(res.status).toBe(400);
    }
    expect(((await listLines(cookie, statementId)).body.data as LineBody[])[0]!.journalEntry).toBeNull();
  });
});

describe('company isolation and roles', () => {
  it("answers another company's member as for a statement that does not exist", async () => {
    const statementId = await newStatement(cookie);
    await sendCsv(cookie, statementId, 'lines', january('T12'));
    const line = ((await listLines(cookie, statementId)).body.data as LineBody[])[0]!;

    expect((await listLines(other.cookie, statementId)).status).toBe(404);
    expect((await sendCsv(other.cookie, statementId, 'csv-preview', january('T12'))).status).toBe(404);
    expect((await sendCsv(other.cookie, statementId, 'lines', january('T12'))).status).toBe(404);
    expect(
      (await request(app).delete(`/api/bank-statements/${statementId}/lines/${line.id}`).set('Cookie', other.cookie))
        .status,
    ).toBe(404);
    expect((await listLines(cookie, statementId)).body.data).toHaveLength(3);
  });

  it('lets a VIEWER read the transactions but not import or delete them', async () => {
    const statementId = await newStatement(cookie);
    await sendCsv(cookie, statementId, 'lines', january('T13'));
    const line = ((await listLines(cookie, statementId)).body.data as LineBody[])[0]!;
    const viewer = await addMember(companyId, 'VIEWER');

    expect((await listLines(viewer.cookie, statementId)).status).toBe(200);
    expect((await sendCsv(viewer.cookie, statementId, 'csv-preview', january('T13'))).status).toBe(403);
    expect((await sendCsv(viewer.cookie, statementId, 'lines', january('T13'))).status).toBe(403);
    expect(
      (await request(app).delete(`/api/bank-statements/${statementId}/lines/${line.id}`).set('Cookie', viewer.cookie))
        .status,
    ).toBe(403);
  });
});
