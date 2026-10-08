import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { journalEntryService } from '../../src/services/journal-entry.service';
import { addMember, createCostCenter, createTestContext } from './helpers';

const app = createApp();

// Fiscal calendar: FY 2025, monthly periods, all left OPEN (every fixture entry
// must be bookable). The ledger itself ignores fiscal state — the guards only
// constrain what the fixtures can post.
//
// Postings, chosen so one February query exercises opening balances and both
// range boundaries at once:
//   2025-01-10  bank +1000 / sales -1000        (before February -> opening)
//   2025-02-01  bank  +124 / sales  -124        (exactly `from`)
//   2025-02-28  expense +24 / bank    -24       (exactly `to`)
//   2025-03-05  float +0.1, +0.2 / sales -0.3   (float accumulation)
// The bank lines of the first two entries are tagged with a cost center; the
// 2025-02-28 bank line is not.
let cookie: string;
let companyId: string;
let bankId: string;
let salesId: string;
let expenseId: string;
let floatId: string;
let costCenterId: string;

// The shared createAccount helper randomises account numbers; ordering
// assertions need known ones, since accounts are paged in lexicographic
// `number` order.
async function numberedAccount(company: string, number: string, name: string) {
  const chart = await prisma.chartOfAccounts.findUniqueOrThrow({
    where: { companyId: company },
  });
  return prisma.account.create({
    data: { companyId: company, chartOfAccountsId: chart.id, number, name },
  });
}

interface LedgerAccountBody {
  accountId: string;
  accountNumber: string;
  accountGroup: unknown;
  openingBalance: number;
  debitTotal: number;
  creditTotal: number;
  closingBalance: number;
  lineCount: number;
  lines: Array<{ date: string; debit: number; credit: number; runningBalance: number }>;
}

function ledgerFor(body: { data: LedgerAccountBody[] }, accountId: string): LedgerAccountBody {
  const found = body.data.find((a) => a.accountId === accountId);
  if (!found) throw new Error(`account ${accountId} not in ledger response`);
  return found;
}

const accountIdsIn = (body: { data: LedgerAccountBody[] }) => body.data.map((a) => a.accountId);

beforeAll(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;

  bankId = (await numberedAccount(companyId, '1910', 'Pankkitili')).id;
  floatId = (await numberedAccount(companyId, '1950', 'Senttitili')).id;
  salesId = (await numberedAccount(companyId, '3000', 'Myynti')).id;
  expenseId = (await numberedAccount(companyId, '7700', 'Hallinnon kulut')).id;

  await fiscalYearService.create(companyId, {
    startDate: parseDateOnly('2025-01-01'),
    endDate: parseDateOnly('2025-12-31'),
    granularity: 'MONTH',
  });

  costCenterId = (await createCostCenter(companyId, '100')).id;

  const line = (
    accountId: string,
    amount: number,
    type: 'debit' | 'credit',
    description = '',
    lineCostCenterId: string | null = null,
  ) => ({
    accountId,
    amount,
    description,
    type,
    vatRate: 0,
    vatAmount: 0,
    costCenterId: lineCostCenterId,
  });

  const post = (
    date: string,
    description: string,
    lines: ReturnType<typeof line>[],
  ) =>
    journalEntryService.create(companyId, ctx.user.id, {
      voucherType: 'MEMOVOUCHER',
      date: parseDateOnly(date),
      description,
      accountId: bankId,
      lines,
    });

  await post('2025-01-10', 'Avaava', [
    line(bankId, 1000, 'debit', '', costCenterId),
    line(salesId, 1000, 'credit'),
  ]);
  await post('2025-02-01', 'Helmikuun myynti', [
    line(bankId, 124, 'debit', 'Asiakas Oy', costCenterId),
    line(salesId, 124, 'credit'),
  ]);
  await post('2025-02-28', 'Pankkikulu', [
    line(expenseId, 24, 'debit'),
    line(bankId, 24, 'credit'),
  ]);
  await post('2025-03-05', 'Sentit', [
    line(floatId, 0.1, 'debit'),
    line(floatId, 0.2, 'debit'),
    line(salesId, 0.3, 'credit'),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const february = { from: '2025-02-01', to: '2025-02-28' };

const getLedger = (query: Record<string, string | number> = {}, as = cookie) =>
  request(app).get('/api/general-ledger').query(query).set('Cookie', as);

describe('GET /api/general-ledger', () => {
  it('returns only accounts with movement in the range, ordered by account number', async () => {
    const res = await getLedger(february);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: LedgerAccountBody) => a.accountNumber)).toEqual([
      '1910',
      '3000',
      '7700',
    ]);
    // The float account only moved in March.
    expect(accountIdsIn(res.body)).not.toContain(floatId);
    expect(res.body.meta).toEqual({ total: 3, take: 50, skip: 0 });
  });

  it('opens each account at the net of everything posted strictly before `from`', async () => {
    const res = await getLedger(february);
    // January's 1000 is the opening, not a line of the period.
    expect(ledgerFor(res.body, bankId).openingBalance).toBe(1000);
    expect(ledgerFor(res.body, bankId).lines.map((l) => l.date)).toEqual([
      '2025-02-01',
      '2025-02-28',
    ]);
    // Credit-nature account: the debit-positive convention makes it negative.
    expect(ledgerFor(res.body, salesId).openingBalance).toBe(-1000);
    expect(ledgerFor(res.body, expenseId).openingBalance).toBe(0);
  });

  it('counts an entry dated exactly `from` as a line, not as opening balance', async () => {
    const res = await getLedger(february);
    const bank = ledgerFor(res.body, bankId);
    expect(bank.lines[0]!.date).toBe('2025-02-01');
    expect(bank.lines[0]!.debit).toBe(124);
    // Would be 1124 if the opening filter were not strictly before `from`.
    expect(bank.openingBalance).toBe(1000);
  });

  it('includes an entry dated exactly `to` (inclusive end on a timestamp column)', async () => {
    const res = await getLedger(february);
    const bank = ledgerFor(res.body, bankId);
    // Regression guard: `lte: to` would drop any row with a time component.
    expect(bank.lines.map((l) => l.date)).toContain('2025-02-28');
    expect(bank.lines.at(-1)!.credit).toBe(24);
  });

  it('splits debit and credit totals by side instead of summing raw amounts', async () => {
    const res = await getLedger(february);
    const bank = ledgerFor(res.body, bankId);
    expect(bank.debitTotal).toBe(124);
    expect(bank.creditTotal).toBe(24);
    expect(bank.closingBalance).toBe(bank.openingBalance + 100);

    // A credit-only account must not come back as positive turnover.
    const sales = ledgerFor(res.body, salesId);
    expect(sales.debitTotal).toBe(0);
    expect(sales.creditTotal).toBe(124);
    expect(sales.closingBalance).toBe(-1124);
  });

  it('carries a running balance that ends at the closing balance', async () => {
    const res = await getLedger(february);
    const bank = ledgerFor(res.body, bankId);
    expect(bank.lines.map((l) => l.runningBalance)).toEqual([1124, 1100]);
    expect(bank.lines.at(-1)!.runningBalance).toBe(bank.closingBalance);
    expect(bank.lineCount).toBe(2);
  });

  it('does not accumulate float error across lines', async () => {
    const res = await getLedger({ from: '2025-03-01', to: '2025-03-31', accountId: floatId });
    expect(res.status).toBe(200);
    const float = ledgerFor(res.body, floatId);
    expect(float.debitTotal).toBe(0.3);
    expect(float.closingBalance).toBe(0.3);
    // Both lines sit in the same entry, so they share a date and createdAt and
    // the only tie-break left is a random uuid — their relative order is not
    // guaranteed. Assert the running balance against the order actually
    // returned rather than a hardcoded one.
    let expected = 0;
    for (const l of float.lines) {
      expected = Math.round((expected + l.debit - l.credit) * 100) / 100;
      expect(l.runningBalance).toBe(expected);
    }
    expect(float.lines.at(-1)!.runningBalance).toBe(0.3);
  });

  it('treats every opening balance as zero when no `from` is given', async () => {
    const res = await getLedger({ to: '2025-12-31' });
    expect(res.status).toBe(200);
    for (const account of res.body.data as LedgerAccountBody[]) {
      expect(account.openingBalance).toBe(0);
    }
    // Everything that ever moved is in range now, including the float account.
    expect(accountIdsIn(res.body)).toContain(floatId);
  });

  it('narrows to a single account with accountId', async () => {
    const res = await getLedger({ ...february, accountId: bankId });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].accountId).toBe(bankId);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns a requested account with no movement in range but a carried balance', async () => {
    const res = await getLedger({ from: '2025-04-01', to: '2025-04-30', accountId: bankId });
    expect(res.status).toBe(200);
    const bank = ledgerFor(res.body, bankId);
    expect(bank.lines).toEqual([]);
    expect(bank.lineCount).toBe(0);
    expect(bank.debitTotal).toBe(0);
    expect(bank.creditTotal).toBe(0);
    // 1000 (Jan) + 124 - 24 (Feb)
    expect(bank.openingBalance).toBe(1100);
    expect(bank.closingBalance).toBe(1100);
  });

  it('always emits accountGroup, as null for an ungrouped account', async () => {
    const res = await getLedger({ ...february, accountId: bankId });
    expect(res.body.data[0]).toHaveProperty('accountGroup');
    expect(res.body.data[0].accountGroup).toBeNull();
  });

  it('pages over accounts, never splitting an account across pages', async () => {
    const first = await getLedger({ ...february, take: 1, skip: 0 });
    const second = await getLedger({ ...february, take: 1, skip: 1 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].accountNumber).toBe('1910');
    // The whole account arrives with its page, not a row-sliced fragment.
    expect(first.body.data[0].lines).toHaveLength(2);

    expect(second.body.data[0].accountNumber).toBe('3000');
    expect(first.body.data[0].accountId).not.toBe(second.body.data[0].accountId);

    // total counts accounts (3), not lines (4), and is stable across pages.
    expect(first.body.meta.total).toBe(3);
    expect(second.body.meta).toEqual({ total: 3, take: 1, skip: 1 });
  });

  it('narrows opening balance, lines and totals to a cost center', async () => {
    const res = await getLedger({ ...february, costCenterId });
    expect(res.status).toBe(200);
    // Only the bank account has lines tagged with the cost center.
    expect(accountIdsIn(res.body)).toEqual([bankId]);
    const bank = ledgerFor(res.body, bankId);
    expect(bank.openingBalance).toBe(1000);
    expect(bank.lineCount).toBe(1);
    expect(bank.debitTotal).toBe(124);
    // The untagged 2025-02-28 credit of 24 is outside the cost center.
    expect(bank.creditTotal).toBe(0);
    expect(bank.closingBalance).toBe(1124);
  });

  it("exposes each line's cost center, null when untagged", async () => {
    const res = await getLedger({ ...february, accountId: bankId });
    const lines = res.body.data[0].lines as Array<{ costCenterId: string | null }>;
    expect(lines.map((l) => l.costCenterId)).toEqual([costCenterId, null]);
  });

  it('404s for a cost center belonging to another company', async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await createCostCenter(other.company.id, '100');
    const res = await getLedger({ ...february, costCenterId: foreign.id });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Cost center not found');
  });

  it('rejects an inverted date range', async () => {
    const res = await getLedger({ from: '2025-03-01', to: '2025-02-01' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/after to/);
  });

  it('404s for an account belonging to another company', async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await numberedAccount(other.company.id, '1910', 'Vieras pankki');
    const res = await getLedger({ ...february, accountId: foreign.id });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Account not found');
  });

  it('does not leak the accounts of another company', async () => {
    const other = await createTestContext('ADMIN');
    const foreignBank = await numberedAccount(other.company.id, '1910', 'Vieras pankki');
    const foreignSales = await numberedAccount(other.company.id, '3000', 'Vieras myynti');
    await fiscalYearService.create(other.company.id, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
    await journalEntryService.create(other.company.id, other.user.id, {
      voucherType: 'MEMOVOUCHER',
      date: parseDateOnly('2025-02-10'),
      description: 'Vieras kirjaus',
      accountId: foreignBank.id,
      lines: [
        { accountId: foreignBank.id, amount: 50, description: '', type: 'debit', vatRate: 0, vatAmount: 0 },
        { accountId: foreignSales.id, amount: 50, description: '', type: 'credit', vatRate: 0, vatAmount: 0 },
      ],
    });

    // Tests share one database with no truncation, so assert by membership of
    // known ids rather than on absolute counts.
    const ours = await getLedger(february);
    expect(accountIdsIn(ours.body)).not.toContain(foreignBank.id);
    expect(accountIdsIn(ours.body)).not.toContain(foreignSales.id);

    const theirs = await getLedger(february, other.cookie);
    expect(accountIdsIn(theirs.body)).toContain(foreignBank.id);
    expect(accountIdsIn(theirs.body)).not.toContain(bankId);
  });

  it('allows a VIEWER to read and rejects an unauthenticated request', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    const allowed = await getLedger(february, viewer.cookie);
    expect(allowed.status).toBe(200);

    const anonymous = await request(app).get('/api/general-ledger').query(february);
    expect(anonymous.status).toBe(401);
  });
});
