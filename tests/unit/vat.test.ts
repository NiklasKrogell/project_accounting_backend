import { describe, expect, it } from 'vitest';
import { buildVatLines, lineVatAmount, vatCents } from '../../src/lib/vat';

const line = (type: 'debit' | 'credit', amount: number, vatRate: number, description = '') => ({
  type,
  amount,
  vatRate,
  description,
});

describe('vatCents', () => {
  it('computes VAT on a net amount', () => {
    expect(vatCents(10000, 25.5)).toBe(2550);
    expect(vatCents(10000, 13.5)).toBe(1350);
    expect(vatCents(10000, 10)).toBe(1000);
    expect(vatCents(10000, 0)).toBe(0);
  });

  it('rounds a half cent up rather than losing it to binary rounding', () => {
    // 1,00 x 25,5 % = 0,255: multiplying by 0.255 gives 25.499999999999996.
    expect(vatCents(100, 25.5)).toBe(26);
    // 3,00 x 13,5 % = 0,405.
    expect(vatCents(300, 13.5)).toBe(41);
    // 0,10 x 25,5 % = 0,0255.
    expect(vatCents(10, 25.5)).toBe(3);
  });

  it('rounds to the nearest cent otherwise', () => {
    expect(vatCents(1999, 25.5)).toBe(510); // 509.745
    expect(vatCents(333, 10)).toBe(33); // 33.3
  });
});

describe('lineVatAmount', () => {
  it('returns the VAT of a line in euros', () => {
    expect(lineVatAmount({ amount: 100, vatRate: 25.5 })).toBe(25.5);
    expect(lineVatAmount({ amount: 19.99, vatRate: 25.5 })).toBe(5.1);
    expect(lineVatAmount({ amount: 100, vatRate: 0 })).toBe(0);
  });
});

describe('buildVatLines', () => {
  it('posts VAT on a credit line to the payable account, on the credit side', () => {
    expect(buildVatLines([line('debit', 125.5, 0), line('credit', 100, 25.5, 'Myynti')])).toEqual([
      { vatAccount: 'payable', amount: 25.5, type: 'credit', vatRate: 25.5, description: 'Myynti' },
    ]);
  });

  it('posts VAT on a debit line to the receivable account, on the debit side', () => {
    expect(buildVatLines([line('debit', 100, 13.5, 'Osto'), line('credit', 113.5, 0)])).toEqual([
      { vatAccount: 'receivable', amount: 13.5, type: 'debit', vatRate: 13.5, description: 'Osto' },
    ]);
  });

  it('generates one row per line with VAT, in line order', () => {
    const vatLines = buildVatLines([
      line('credit', 100, 25.5),
      line('credit', 50, 0),
      line('credit', 200, 10),
      line('debit', 395.5, 0),
    ]);
    expect(vatLines.map((l) => [l.vatRate, l.amount])).toEqual([
      [25.5, 25.5],
      [10, 20],
    ]);
  });

  it('generates nothing for lines without VAT or whose VAT rounds to zero', () => {
    expect(buildVatLines([line('debit', 100, 0), line('credit', 100, 0)])).toEqual([]);
    expect(buildVatLines([line('credit', 0.01, 25.5)])).toEqual([]);
  });
});
