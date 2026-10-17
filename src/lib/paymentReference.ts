// The payment reference of a purchase invoice: a Finnish reference number
// (viitenumero) or an international RF creditor reference (ISO 11649). Both
// carry check digits, so a mistyped reference is caught before the invoice is
// paid with it.

import { mod97 } from './mod97';

// References are stored without spaces, in upper case (RF).
export function normalizePaymentReference(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

// Expects a normalized reference.
export function isValidPaymentReference(reference: string): boolean {
  return reference.startsWith('RF')
    ? isValidRfReference(reference)
    : isValidFinnishReference(reference);
}

const FINNISH_WEIGHTS = [7, 3, 1];

// A Finnish reference is 4-20 digits, the last of them the check digit: the
// digits before it are weighted 7, 3, 1, 7, 3, 1 ... from the right, and the
// check digit takes the sum up to the next multiple of ten.
function isValidFinnishReference(reference: string): boolean {
  if (!/^\d{4,20}$/.test(reference)) return false;
  const body = reference.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * FINNISH_WEIGHTS[i % 3]!;
  }
  return (10 - (sum % 10)) % 10 === Number(reference.slice(-1));
}

// An RF reference is RF, two check digits and 1-21 letters or digits; like an
// IBAN, it is valid when moving its first four characters to the end leaves a
// number that is 1 modulo 97.
function isValidRfReference(reference: string): boolean {
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(reference)) return false;
  return mod97(reference.slice(4) + reference.slice(0, 4)) === 1;
}
