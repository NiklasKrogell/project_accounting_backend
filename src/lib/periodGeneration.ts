// Auto-generation of accounting periods (kirjanpitokaudet / ALV-kaudet) for a
// fiscal year. Pure date logic, no database access.
//
// Rules:
// 1. The fiscal year is sliced on calendar-month boundaries: the first slice
//    runs from startDate to the end of that calendar month (or endDate if
//    sooner); each following slice is a full calendar month; the last slice
//    ends at endDate. First and last slices may be partial when the fiscal
//    year starts or ends mid-month.
// 2. MONTH granularity: every slice becomes one period (an 18-month fiscal
//    year starting mid-month yields up to 19 periods).
// 3. QUARTER granularity: consecutive slices are grouped in threes from the
//    start; the final quarter may be shorter (1-2 months). Example:
//    15.1.-31.12.2025 -> 15.1-31.3, 1.4-30.6, 1.7-30.9, 1.10-31.12.
import { AppError } from './AppError';
import { addDays, addMonthsClamped, endOfUtcMonth, formatDateOnly } from './dateOnly';

// Matches the Prisma enum of the same name; kept as string literals here so
// this module stays independent of the generated client.
export type PeriodGranularity = 'MONTH' | 'QUARTER';

export interface GeneratedPeriod {
  index: number; // 1-based position within the fiscal year
  startDate: Date;
  endDate: Date; // inclusive
}

// Finnish accounting law: a fiscal year is normally 12 months but may be
// shorter or longer when starting/ending operations or changing the fiscal
// year — at minimum 1 month and at most 18 months.
export function validateFiscalYearLength(startDate: Date, endDate: Date): void {
  if (endDate.getTime() < startDate.getTime()) {
    throw AppError.badRequest('Fiscal year end date must not be before its start date');
  }
  const minEnd = addDays(addMonthsClamped(startDate, 1), -1);
  if (endDate.getTime() < minEnd.getTime()) {
    throw AppError.badRequest('Fiscal year must be at least 1 month long');
  }
  const maxEnd = addDays(addMonthsClamped(startDate, 18), -1);
  if (endDate.getTime() > maxEnd.getTime()) {
    throw AppError.badRequest('Fiscal year must be at most 18 months long');
  }
}

export function generatePeriods(
  startDate: Date,
  endDate: Date,
  granularity: PeriodGranularity,
): GeneratedPeriod[] {
  // Calendar-month slices covering [startDate, endDate].
  const slices: { startDate: Date; endDate: Date }[] = [];
  let cursor = startDate;
  while (cursor.getTime() <= endDate.getTime()) {
    const monthEnd = endOfUtcMonth(cursor);
    const sliceEnd = monthEnd.getTime() < endDate.getTime() ? monthEnd : endDate;
    slices.push({ startDate: cursor, endDate: sliceEnd });
    cursor = addDays(sliceEnd, 1);
  }

  const groupSize = granularity === 'MONTH' ? 1 : 3;
  const periods: GeneratedPeriod[] = [];
  for (let i = 0; i < slices.length; i += groupSize) {
    const chunk = slices.slice(i, i + groupSize);
    periods.push({
      index: periods.length + 1,
      startDate: chunk[0]!.startDate,
      endDate: chunk[chunk.length - 1]!.endDate,
    });
  }

  assertContiguous(periods, startDate, endDate);
  return periods;
}

// Invariants: periods cover exactly [startDate, endDate] with no gaps or
// overlaps. A violation is a bug in this module, not a user error.
function assertContiguous(periods: GeneratedPeriod[], startDate: Date, endDate: Date): void {
  const fail = (detail: string): never => {
    throw new Error(`Period generation invariant violated: ${detail}`);
  };
  if (periods.length === 0) fail('no periods generated');
  const first = periods[0]!;
  const last = periods[periods.length - 1]!;
  if (first.startDate.getTime() !== startDate.getTime()) {
    fail(`first period starts ${formatDateOnly(first.startDate)}, expected ${formatDateOnly(startDate)}`);
  }
  if (last.endDate.getTime() !== endDate.getTime()) {
    fail(`last period ends ${formatDateOnly(last.endDate)}, expected ${formatDateOnly(endDate)}`);
  }
  for (let i = 1; i < periods.length; i++) {
    const expectedStart = addDays(periods[i - 1]!.endDate, 1);
    if (periods[i]!.startDate.getTime() !== expectedStart.getTime()) {
      fail(`period ${i + 1} starts ${formatDateOnly(periods[i]!.startDate)}, expected ${formatDateOnly(expectedStart)}`);
    }
  }
}
