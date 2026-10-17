// The ISO 7064 mod-97 remainder used by IBANs (ISO 13616) and RF creditor
// references (ISO 11649). Both move their first four characters to the end
// before taking it; that is the caller's part.

// Expects digits and upper-case letters only. Letters read as numbers
// (A = 10 ... Z = 35), and the remainder is taken a digit at a time, since the
// full number does not fit a JS number.
export function mod97(value: string): number {
  let remainder = 0;
  for (const char of value) {
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}
