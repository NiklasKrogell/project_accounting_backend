import { describe, expect, it } from 'vitest';
import { isValidBic, isValidIban, normalizeBic, normalizeIban } from '../../src/lib/iban';

describe('normalizeIban', () => {
  it('strips whitespace and upper-cases', () => {
    expect(normalizeIban(' fi21 1234 5600 0007 85\t')).toBe('FI2112345600000785');
  });
});

describe('isValidIban', () => {
  it.each([
    'FI2112345600000785',
    'DE89370400440532013000',
    'GB82WEST12345698765432',
    'NL91ABNA0417164300',
    'FR1420041010050500013M02606',
    'NO9386011117947',
  ])('accepts %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it('rejects a wrong checksum', () => {
    expect(isValidIban('FI2212345600000785')).toBe(false);
    // Two digits swapped.
    expect(isValidIban('FI2112345600000758')).toBe(false);
  });

  it('rejects a wrong shape', () => {
    expect(isValidIban('')).toBe(false);
    expect(isValidIban('not-an-iban')).toBe(false);
    expect(isValidIban('FI21')).toBe(false);
    expect(isValidIban('2112345600000785FI')).toBe(false);
    // Not normalized.
    expect(isValidIban('FI21 1234 5600 0007 85')).toBe(false);
    expect(isValidIban('fi2112345600000785')).toBe(false);
  });
});

describe('normalizeBic', () => {
  it('strips whitespace and upper-cases', () => {
    expect(normalizeBic(' nda sfihh ')).toBe('NDASFIHH');
  });
});

describe('isValidBic', () => {
  it.each(['NDEAFIHH', 'OKOYFIHH', 'DEUTDEFF500', 'HELSFIHH'])('accepts %s', (bic) => {
    expect(isValidBic(bic)).toBe(true);
  });

  it('rejects a wrong shape', () => {
    expect(isValidBic('')).toBe(false);
    expect(isValidBic('NDEAFI')).toBe(false);
    expect(isValidBic('NDEAFIHH5')).toBe(false);
    expect(isValidBic('1DEAFIHH')).toBe(false);
    expect(isValidBic('ndeafihh')).toBe(false);
  });
});
