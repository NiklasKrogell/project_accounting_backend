import { describe, expect, it } from 'vitest';
import {
  finnishVatNumberOf,
  isValidFinnishBusinessId,
  isValidVatNumber,
  normalizeFinnishBusinessId,
  normalizeVatNumber,
} from '../../src/lib/businessId';

describe('normalizeFinnishBusinessId', () => {
  it('keeps the canonical form', () => {
    expect(normalizeFinnishBusinessId('0112038-9')).toBe('0112038-9');
  });

  it('drops spaces and adds a missing hyphen', () => {
    expect(normalizeFinnishBusinessId(' 0112038 - 9 ')).toBe('0112038-9');
    expect(normalizeFinnishBusinessId('01120389')).toBe('0112038-9');
  });

  it('pads the old six-digit form', () => {
    expect(normalizeFinnishBusinessId('112038-9')).toBe('0112038-9');
  });

  it('returns anything else trimmed', () => {
    expect(normalizeFinnishBusinessId(' HRB 12345 ')).toBe('HRB 12345');
  });
});

describe('isValidFinnishBusinessId', () => {
  it.each(['0112038-9', '2617416-4', '1234567-1', '0737546-2', '1572860-0'])(
    'accepts %s',
    (businessId) => {
      expect(isValidFinnishBusinessId(businessId)).toBe(true);
    },
  );

  it('rejects a wrong check digit', () => {
    expect(isValidFinnishBusinessId('0112038-8')).toBe(false);
    expect(isValidFinnishBusinessId('1234567-8')).toBe(false);
  });

  it('rejects a body whose remainder is 1, whatever the check digit', () => {
    // 6 * 2 = 12, and 12 mod 11 = 1: no check digit is ever issued for it.
    for (let check = 0; check <= 9; check++) {
      expect(isValidFinnishBusinessId(`0000006-${check}`)).toBe(false);
    }
  });

  it('rejects a wrong shape', () => {
    expect(isValidFinnishBusinessId('')).toBe(false);
    expect(isValidFinnishBusinessId('01120389')).toBe(false);
    expect(isValidFinnishBusinessId('112038-9')).toBe(false);
    expect(isValidFinnishBusinessId('A112038-9')).toBe(false);
  });
});

describe('VAT numbers', () => {
  it('normalizes spaces, dots and hyphens away and upper-cases', () => {
    expect(normalizeVatNumber(' fi 0112 0389 ')).toBe('FI01120389');
    expect(normalizeVatNumber('SE5560-1234.5601')).toBe('SE556012345601');
  });

  it('checks the common shape', () => {
    expect(isValidVatNumber('FI01120389')).toBe(true);
    expect(isValidVatNumber('DE123456789')).toBe(true);
    expect(isValidVatNumber('ATU12345678')).toBe(true);
    expect(isValidVatNumber('FI')).toBe(false);
    expect(isValidVatNumber('0112038')).toBe(false);
    expect(isValidVatNumber('fi01120389')).toBe(false);
  });

  it('derives the Finnish VAT number from the business ID', () => {
    expect(finnishVatNumberOf('0112038-9')).toBe('FI01120389');
  });
});
