// Date-only semantics for accounting dates (fiscal years, accounting periods,
// journal entry dates):
// - Postgres stores them as DATE columns (@db.Date); the Prisma client reads
//   them back as JS Dates at 00:00:00.000 UTC.
// - Across the API they travel as 'YYYY-MM-DD' strings.
// - In JS they are always Dates at UTC midnight. Never build them with
//   local-time constructors like new Date('2025-01-15 00:00'); use
//   parseDateOnly / normalizeToUtcDate so a Helsinki-midnight timestamp
//   (e.g. 2025-03-31T22:00:00Z) never shifts the calendar date.
// - Range boundaries are inclusive: date d falls in [startDate, endDate]
//   when startDate <= d && d <= endDate.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parses a 'YYYY-MM-DD' string to a Date at UTC midnight. Throws RangeError on
// malformed input and on non-existent calendar dates such as 2025-02-30.
export function parseDateOnly(value: string): Date {
  if (!DATE_ONLY_RE.test(value)) {
    throw new RangeError(`Expected YYYY-MM-DD, got: ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC silently rolls invalid dates over (Feb 30 -> Mar 2); reject those.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return date;
}

export function formatDateOnly(d: Date): string {
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Drops the time-of-day component, keeping the UTC calendar date.
export function normalizeToUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

// Adds calendar months, clamping the day-of-month to the target month's length
// (Jan 31 + 1 month -> Feb 28/29) instead of rolling over into the next month.
export function addMonthsClamped(d: Date, months: number): Date {
  const targetFirst = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const daysInTarget = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetFirst.getUTCFullYear(),
      targetFirst.getUTCMonth(),
      Math.min(d.getUTCDate(), daysInTarget),
    ),
  );
}

export function endOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
