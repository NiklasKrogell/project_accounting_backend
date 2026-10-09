// IBAN handling. The UI mirrors these in its own src/lib/iban.ts, so change
// both together.

// IBANs are stored and compared without spaces, in upper case.
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

// Expects a normalized IBAN. Checks the general shape (country code, two check
// digits, 11-30 characters of account identifier) and the ISO 13616 mod-97
// checksum. Country-specific lengths are not checked.
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  // Move the country code and check digits to the end, read letters as
  // numbers (A = 10 ... Z = 35) and take the result modulo 97 a digit at a
  // time, since the full number does not fit a JS number.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}
