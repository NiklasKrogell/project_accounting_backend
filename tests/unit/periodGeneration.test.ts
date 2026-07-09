import { describe, expect, it } from 'vitest';
import { formatDateOnly, parseDateOnly } from '../../src/lib/dateOnly';
import {
  generatePeriods,
  validateFiscalYearLength,
  type GeneratedPeriod,
} from '../../src/lib/periodGeneration';
import { AppError } from '../../src/lib/AppError';

const d = parseDateOnly;

function ranges(periods: GeneratedPeriod[]): string[] {
  return periods.map((p) => `${formatDateOnly(p.startDate)}..${formatDateOnly(p.endDate)}`);
}

describe('generatePeriods MONTH', () => {
  it('splits a calendar-aligned year into 12 months', () => {
    const periods = generatePeriods(d('2025-01-01'), d('2025-12-31'), 'MONTH');
    expect(periods).toHaveLength(12);
    expect(ranges(periods)[0]).toBe('2025-01-01..2025-01-31');
    expect(ranges(periods)[1]).toBe('2025-02-01..2025-02-28');
    expect(ranges(periods)[11]).toBe('2025-12-01..2025-12-31');
    expect(periods.map((p) => p.index)).toEqual([...Array(12)].map((_, i) => i + 1));
  });

  it('handles a mid-month 18-month fiscal year with partial first and last periods', () => {
    const periods = generatePeriods(d('2025-01-15'), d('2026-07-14'), 'MONTH');
    expect(periods).toHaveLength(19);
    expect(ranges(periods)[0]).toBe('2025-01-15..2025-01-31');
    expect(ranges(periods)[18]).toBe('2026-07-01..2026-07-14');
  });

  it('covers a leap-year February without gaps', () => {
    const periods = generatePeriods(d('2024-01-01'), d('2024-03-31'), 'MONTH');
    expect(ranges(periods)).toEqual([
      '2024-01-01..2024-01-31',
      '2024-02-01..2024-02-29',
      '2024-03-01..2024-03-31',
    ]);
  });

  it('handles a one-month fiscal year', () => {
    const periods = generatePeriods(d('2025-02-01'), d('2025-02-28'), 'MONTH');
    expect(ranges(periods)).toEqual(['2025-02-01..2025-02-28']);
  });
});

describe('generatePeriods QUARTER', () => {
  it('groups a mid-month year into quarters with a partial first month', () => {
    const periods = generatePeriods(d('2025-01-15'), d('2025-12-31'), 'QUARTER');
    expect(ranges(periods)).toEqual([
      '2025-01-15..2025-03-31',
      '2025-04-01..2025-06-30',
      '2025-07-01..2025-09-30',
      '2025-10-01..2025-12-31',
    ]);
  });

  it('leaves a short final quarter when months are not divisible by three', () => {
    const periods = generatePeriods(d('2025-01-01'), d('2025-04-30'), 'QUARTER');
    expect(ranges(periods)).toEqual(['2025-01-01..2025-03-31', '2025-04-01..2025-04-30']);
  });

  it('handles an 18-month fiscal year as 6 full quarters', () => {
    const periods = generatePeriods(d('2025-01-01'), d('2026-06-30'), 'QUARTER');
    expect(periods).toHaveLength(6);
    expect(ranges(periods)[5]).toBe('2026-04-01..2026-06-30');
  });
});

describe('validateFiscalYearLength', () => {
  it('accepts exactly 1 month and exactly 18 months', () => {
    expect(() => validateFiscalYearLength(d('2025-01-15'), d('2025-02-14'))).not.toThrow();
    expect(() => validateFiscalYearLength(d('2025-01-15'), d('2026-07-14'))).not.toThrow();
    expect(() => validateFiscalYearLength(d('2025-01-01'), d('2025-12-31'))).not.toThrow();
  });

  it('rejects a fiscal year shorter than 1 month', () => {
    expect(() => validateFiscalYearLength(d('2025-01-15'), d('2025-02-13'))).toThrow(AppError);
    expect(() => validateFiscalYearLength(d('2025-01-15'), d('2025-01-15'))).toThrow(AppError);
  });

  it('rejects a fiscal year longer than 18 months', () => {
    expect(() => validateFiscalYearLength(d('2025-01-15'), d('2026-07-15'))).toThrow(AppError);
  });

  it('rejects end before start', () => {
    expect(() => validateFiscalYearLength(d('2025-01-15'), d('2025-01-14'))).toThrow(AppError);
  });

  it('handles clamped month boundaries (fiscal year starting Jan 31)', () => {
    // 1 month from 31.1. clamps to 28.2.; minimum end is 27.2.
    expect(() => validateFiscalYearLength(d('2025-01-31'), d('2025-02-27'))).not.toThrow();
    expect(() => validateFiscalYearLength(d('2025-01-31'), d('2025-02-26'))).toThrow(AppError);
  });
});
