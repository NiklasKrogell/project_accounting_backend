// IBAN and BIC handling. The UI mirrors these in its own src/lib/iban.ts, so
// change both together.

import { mod97 } from './mod97';

// IBANs are stored and compared without spaces, in upper case.
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

// Expects a normalized IBAN. Checks the general shape (country code, two check
// digits, 11-30 characters of account identifier) and the ISO 13616 mod-97
// checksum. Country-specific lengths are not checked.
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  // Move the country code and check digits to the end.
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

// BICs (SWIFT codes) are stored like IBANs: without spaces, in upper case.
export function normalizeBic(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

// Expects a normalized BIC. ISO 9362: four letters of institution, a country
// code, two characters of location and an optional three of branch. A BIC has
// no check digits, so the shape is all there is to check.
export function isValidBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}
