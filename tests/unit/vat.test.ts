import { describe, expect, it } from 'vitest';
import { buildVatLines, splitVat, vatCents, vatCentsInGross } from '../../src/lib/vat';
import { toCents } from '../../src/lib/money';

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

describe('vatCentsInGross', () => {
  it('computes the VAT contained in a gross amount', () => {
    expect(vatCentsInGross(12550, 25.5)).toBe(2550);
    expect(vatCentsInGross(11350, 13.5)).toBe(1350);
    expect(vatCentsInGross(11000, 10)).toBe(1000);
    expect(vatCentsInGross(10000, 0)).toBe(0);
  });

  it('rounds to the nearest cent', () => {
    expect(vatCentsInGross(1000, 25.5)).toBe(203); // 203.187...
    expect(vatCentsInGross(9999, 13.5)).toBe(1189); // 1189.308...
  });
});

describe('splitVat', () => {
  it('adds the VAT on top of a net amount', () => {
    expect(splitVat({ amount: 100, vatRate: 25.5 }, 'net')).toEqual({ net: 100, vat: 25.5 });
    expect(splitVat({ amount: 19.99, vatRate: 25.5 }, 'net')).toEqual({ net: 19.99, vat: 5.1 });
    expect(splitVat({ amount: 100, vatRate: 0 }, 'net')).toEqual({ net: 100, vat: 0 });
  });

  it('takes the VAT out of a gross amount', () => {
    expect(splitVat({ amount: 125.5, vatRate: 25.5 }, 'gross')).toEqual({ net: 100, vat: 25.5 });
    expect(splitVat({ amount: 100, vatRate: 0 }, 'gross')).toEqual({ net: 100, vat: 0 });
  });

  it('keeps net + VAT equal to the gross amount even where net x rate is a cent off', () => {
    // 19,91 gross at 25,5 % holds 4,05 of VAT, leaving 15,86 net — on which
    // VAT computed the net way would be 4,04.
    expect(splitVat({ amount: 19.91, vatRate: 25.5 }, 'gross')).toEqual({ net: 15.86, vat: 4.05 });
    expect(splitVat({ amount: 15.86, vatRate: 25.5 }, 'net').vat).toBe(4.04);
    for (let cents = 1; cents <= 3000; cents += 1) {
      const { net, vat } = splitVat({ amount: cents / 100, vatRate: 25.5 }, 'gross');
      expect(toCents(net) + toCents(vat)).toBe(cents);
    }
  });
});

describe('buildVatLines', () => {
  it('posts VAT on a credit line to the payable account, on the credit side', () => {
    expect(
      buildVatLines([line('debit', 125.5, 0), line('credit', 100, 25.5, 'Myynti')], 'net'),
    ).toEqual([
      {
        vatAccount: 'payable',
        amount: 25.5,
        type: 'credit',
        description: 'Myynti',
        costCenterId: null,
      },
    ]);
  });

  it('posts VAT on a debit line to the receivable account, on the debit side', () => {
    expect(
      buildVatLines([line('debit', 100, 13.5, 'Osto'), line('credit', 113.5, 0)], 'net'),
    ).toEqual([
      {
        vatAccount: 'receivable',
        amount: 13.5,
        type: 'debit',
        description: 'Osto',
        costCenterId: null,
      },
    ]);
  });

  it('takes the VAT out of the amount on a gross basis', () => {
    const vatLines = buildVatLines(
      [line('debit', 125.5, 0), line('credit', 125.5, 25.5, 'Myynti')],
      'gross',
    );
    expect(vatLines).toHaveLength(1);
    expect(vatLines[0]).toMatchObject({ vatAccount: 'payable', amount: 25.5, type: 'credit' });
  });

  it('gives the VAT row the cost center of the line it comes from', () => {
    const vatLines = buildVatLines(
      [
        { ...line('credit', 100, 25.5), costCenterId: 'cc-1' },
        { ...line('credit', 100, 25.5), costCenterId: 'cc-2' },
        line('credit', 100, 25.5),
        line('debit', 376.5, 0),
      ],
      'net',
    );
    expect(vatLines.map((l) => l.costCenterId)).toEqual(['cc-1', 'cc-2', null]);
  });

  it('generates one row per line with VAT, in line order', () => {
    const vatLines = buildVatLines(
      [
        line('credit', 100, 25.5),
        line('credit', 50, 0),
        line('credit', 200, 10),
        line('debit', 395.5, 0),
      ],
      'net',
    );
    expect(vatLines.map((l) => l.amount)).toEqual([25.5, 20]);
  });

  it('generates nothing for lines without VAT or whose VAT rounds to zero', () => {
    expect(buildVatLines([line('debit', 100, 0), line('credit', 100, 0)], 'net')).toEqual([]);
    expect(buildVatLines([line('credit', 0.01, 25.5)], 'net')).toEqual([]);
    expect(buildVatLines([line('credit', 0.01, 25.5)], 'gross')).toEqual([]);
  });
});
