// Amounts are Floats in the schema (DOUBLE PRECISION), so all arithmetic on
// them is done in integer cents and converted back exactly once at the end.
// Adding two euro floats anywhere in a chain is how 0.1 + 0.2 becomes
// 0.30000000000000004 in a report.

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

// A positive euro amount typed as text, in cents: '1 234,56', '1234.5', '99'
// or '12,00 €'. Spaces (also the no-break ones Intl puts in a Finnish amount)
// group thousands, a comma or a dot marks the cents. Null when the text is not
// such an amount.
export function centsFromText(text: string): number | null {
  const compact = text.replace(/[\s  ]/g, '').replace(/€$/, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(compact)) return null;
  return toCents(Number(compact.replace(',', '.')));
}
