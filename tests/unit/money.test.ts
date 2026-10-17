import { describe, expect, it } from 'vitest';
import { centsFromText } from '../../src/lib/money';

describe('centsFromText', () => {
  it('reads an amount with a comma or a dot for the cents', () => {
    expect(centsFromText('125,50')).toBe(12550);
    expect(centsFromText('125.5')).toBe(12550);
    expect(centsFromText('99')).toBe(9900);
    expect(centsFromText('0,07')).toBe(7);
  });

  it('takes spaces between the thousands and a euro sign after', () => {
    expect(centsFromText('1 234,56')).toBe(123456);
    expect(centsFromText(' 12,00 € ')).toBe(1200);
    // As Intl formats an amount in Finnish: no-break spaces.
    expect(centsFromText(new Intl.NumberFormat('fi', { style: 'currency', currency: 'EUR' }).format(1234.56))).toBe(
      123456,
    );
  });

  it('is null for anything else', () => {
    expect(centsFromText('')).toBeNull();
    expect(centsFromText('A-1001')).toBeNull();
    expect(centsFromText('12,345')).toBeNull();
    expect(centsFromText('-5')).toBeNull();
    expect(centsFromText('1,2,3')).toBeNull();
    expect(centsFromText('€')).toBeNull();
  });
});
