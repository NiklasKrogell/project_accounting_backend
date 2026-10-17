import { describe, expect, it } from 'vitest';
import {
  isValidPaymentReference,
  normalizePaymentReference,
} from '../../src/lib/paymentReference';

describe('normalizePaymentReference', () => {
  it('strips whitespace and upper-cases', () => {
    expect(normalizePaymentReference(' 12 3456 1 ')).toBe('1234561');
    expect(normalizePaymentReference('rf18 5390 0754 7034')).toBe('RF18539007547034');
  });
});

describe('Finnish reference numbers', () => {
  it.each(['12344', '1234561', '10003', '98765432103'])('accepts %s', (ref) => {
    expect(isValidPaymentReference(ref)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidPaymentReference('12345')).toBe(false);
    expect(isValidPaymentReference('1234562')).toBe(false);
  });

  it('takes 4 to 20 digits', () => {
    // 13 + its check digit 6 is valid arithmetic but too short.
    expect(isValidPaymentReference('136')).toBe(false);
    expect(isValidPaymentReference('1'.repeat(21))).toBe(false);
    expect(isValidPaymentReference('12A44')).toBe(false);
  });
});

describe('RF creditor references', () => {
  it.each(['RF18539007547034', 'RF712348231'])('accepts %s', (ref) => {
    expect(isValidPaymentReference(ref)).toBe(true);
  });

  it('rejects wrong check digits', () => {
    expect(isValidPaymentReference('RF19539007547034')).toBe(false);
  });

  it('rejects a wrong shape', () => {
    expect(isValidPaymentReference('RF18')).toBe(false);
    expect(isValidPaymentReference('RFXX539007547034')).toBe(false);
    expect(isValidPaymentReference(`RF18${'1'.repeat(22)}`)).toBe(false);
  });
});
