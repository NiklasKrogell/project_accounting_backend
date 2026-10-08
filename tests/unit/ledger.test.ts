import { describe, expect, it } from 'vitest';
import {
  EMPTY_OPENING,
  buildAccountLedger,
  groupByAccountId,
  signedCents,
} from '../../src/lib/ledger';

const debit = (amount: number) => ({ amount, type: 'debit' });
const credit = (amount: number) => ({ amount, type: 'credit' });

describe('signedCents', () => {
  it('signs a debit positive and a credit negative', () => {
    expect(signedCents(debit(12.34))).toBe(1234);
    expect(signedCents(credit(12.34))).toBe(-1234);
  });

  it('throws on an unrecognised type rather than guessing a side', () => {
    // `type` is a free String column; mis-signing silently would corrupt a
    // ledger, so these must be loud.
    expect(() => signedCents({ amount: 1, type: 'DEBIT' })).toThrow(/Unknown journal entry line type/);
    expect(() => signedCents({ amount: 1, type: '' })).toThrow(/Unknown journal entry line type/);
  });
});

describe('buildAccountLedger', () => {
  it('reports the opening balance when there are no lines in the period', () => {
    const ledger = buildAccountLedger({ debit: 1000, credit: 400 }, []);
    expect(ledger.openingBalance).toBe(600);
    expect(ledger.debitTotal).toBe(0);
    expect(ledger.creditTotal).toBe(0);
    expect(ledger.closingBalance).toBe(600);
    expect(ledger.lines).toEqual([]);
  });

  it('accumulates a running balance and closes at opening + debits - credits', () => {
    const ledger = buildAccountLedger({ debit: 1000, credit: 0 }, [debit(124), credit(24)]);
    expect(ledger.openingBalance).toBe(1000);
    expect(ledger.debitTotal).toBe(124);
    expect(ledger.creditTotal).toBe(24);
    expect(ledger.closingBalance).toBe(1100);
    expect(ledger.lines.map((l) => l.runningBalance)).toEqual([1124, 1100]);
    expect(ledger.lines.at(-1)!.runningBalance).toBe(ledger.closingBalance);
    expect(ledger.closingBalance).toBe(
      ledger.openingBalance + ledger.debitTotal - ledger.creditTotal,
    );
  });

  it('goes negative for a credit-nature account (debit-positive convention)', () => {
    const ledger = buildAccountLedger(EMPTY_OPENING, [credit(124)]);
    expect(ledger.debitTotal).toBe(0);
    expect(ledger.creditTotal).toBe(124);
    expect(ledger.closingBalance).toBe(-124);
  });

  it('does not accumulate float error', () => {
    expect(buildAccountLedger(EMPTY_OPENING, [debit(0.1), debit(0.2)]).closingBalance).toBe(0.3);
    expect(buildAccountLedger(EMPTY_OPENING, [debit(0.1), debit(0.2)]).debitTotal).toBe(0.3);

    const hundredCents = Array.from({ length: 100 }, () => debit(0.01));
    expect(buildAccountLedger(EMPTY_OPENING, hundredCents).closingBalance).toBe(1);

    const threeSevens = [credit(0.07), credit(0.07), credit(0.07)];
    expect(buildAccountLedger(EMPTY_OPENING, threeSevens).creditTotal).toBe(0.21);
    expect(buildAccountLedger(EMPTY_OPENING, threeSevens).closingBalance).toBe(-0.21);
  });

  it('preserves input order instead of sorting', () => {
    const lines = [
      { amount: 1, type: 'debit', date: '2025-03-01' },
      { amount: 2, type: 'debit', date: '2025-01-01' },
    ];
    const ledger = buildAccountLedger(EMPTY_OPENING, lines);
    expect(ledger.lines.map((l) => l.date)).toEqual(['2025-03-01', '2025-01-01']);
    expect(ledger.lines.map((l) => l.runningBalance)).toEqual([1, 3]);
  });

  it('propagates the throw from an unrecognised line type', () => {
    expect(() => buildAccountLedger(EMPTY_OPENING, [{ amount: 1, type: 'x' }])).toThrow(
      /Unknown journal entry line type/,
    );
  });
});

describe('groupByAccountId', () => {
  it('buckets by account and keeps per-bucket order', () => {
    const grouped = groupByAccountId([
      { accountId: 'a', n: 1 },
      { accountId: 'b', n: 2 },
      { accountId: 'a', n: 3 },
    ]);
    expect([...grouped.keys()]).toEqual(['a', 'b']);
    expect(grouped.get('a')!.map((l) => l.n)).toEqual([1, 3]);
    expect(grouped.get('b')!.map((l) => l.n)).toEqual([2]);
  });

  it('returns an empty map for no lines', () => {
    expect(groupByAccountId([]).size).toBe(0);
  });
});
