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
