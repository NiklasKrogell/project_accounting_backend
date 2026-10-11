import { describe, expect, it } from 'vitest';
import { companyKeyPrefix, companyObjectKey, keyBelongsToCompany } from '../../src/lib/storageKey';

const COMPANY = '0b9f6f0e-4a57-4c0c-9d3b-1f2a3b4c5d6e';
const FILE = '7c1d2e3f-8a9b-4c0d-8e1f-2a3b4c5d6e7f';

describe('companyObjectKey', () => {
  it("puts a file under its company's prefix", () => {
    expect(companyKeyPrefix(COMPANY)).toBe(`companies/${COMPANY}/`);
    expect(companyObjectKey(COMPANY, FILE)).toBe(`companies/${COMPANY}/${FILE}`);
  });

  it.each(['', '..', 'a/b', '../other', 'a\\b', 'a b', 'a.b'])(
    'refuses %j as a company or file id',
    (id) => {
      expect(() => companyObjectKey(id, FILE)).toThrow();
      expect(() => companyObjectKey(COMPANY, id)).toThrow();
    },
  );
});

describe('keyBelongsToCompany', () => {
  it("accepts the company's own keys only", () => {
    const other = '11111111-2222-4333-8444-555555555555';
    expect(keyBelongsToCompany(companyObjectKey(COMPANY, FILE), COMPANY)).toBe(true);
    expect(keyBelongsToCompany(companyObjectKey(other, FILE), COMPANY)).toBe(false);
    expect(keyBelongsToCompany(FILE, COMPANY)).toBe(false);
    expect(keyBelongsToCompany(`other/${COMPANY}/${FILE}`, COMPANY)).toBe(false);
  });

  it('does not take a longer id that starts with its own for its own', () => {
    expect(keyBelongsToCompany(companyObjectKey('abc', FILE), 'ab')).toBe(false);
    expect(keyBelongsToCompany(companyObjectKey('ab', FILE), 'abc')).toBe(false);
  });
});
