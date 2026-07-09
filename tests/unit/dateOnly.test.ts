import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  endOfUtcMonth,
  formatDateOnly,
  normalizeToUtcDate,
  parseDateOnly,
} from '../../src/lib/dateOnly';

describe('parseDateOnly', () => {
  it('parses a valid date to UTC midnight', () => {
    const d = parseDateOnly('2025-01-15');
    expect(d.toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('rejects malformed strings', () => {
    expect(() => parseDateOnly('15.1.2025')).toThrow(RangeError);
    expect(() => parseDateOnly('2025-1-15')).toThrow(RangeError);
    expect(() => parseDateOnly('2025-01-15T00:00:00Z')).toThrow(RangeError);
  });

  it('rejects non-existent calendar dates', () => {
    expect(() => parseDateOnly('2025-02-30')).toThrow(RangeError);
    expect(() => parseDateOnly('2025-13-01')).toThrow(RangeError);
    expect(() => parseDateOnly('2025-04-31')).toThrow(RangeError);
  });

  it('accepts leap day only in leap years', () => {
    expect(formatDateOnly(parseDateOnly('2024-02-29'))).toBe('2024-02-29');
    expect(() => parseDateOnly('2025-02-29')).toThrow(RangeError);
  });
});

describe('formatDateOnly', () => {
  it('round-trips with parseDateOnly', () => {
    expect(formatDateOnly(parseDateOnly('2026-12-31'))).toBe('2026-12-31');
    expect(formatDateOnly(parseDateOnly('0999-01-05'))).toBe('0999-01-05');
  });
});

describe('normalizeToUtcDate', () => {
  it('drops the time component but keeps the UTC calendar date', () => {
    // Helsinki midnight 1.4.2025 stored as UTC timestamp is still 31.3. in UTC.
    const helsinkiMidnight = new Date('2025-03-31T22:00:00.000Z');
    expect(formatDateOnly(normalizeToUtcDate(helsinkiMidnight))).toBe('2025-03-31');
    const midDay = new Date('2025-03-31T12:34:56.789Z');
    expect(normalizeToUtcDate(midDay).toISOString()).toBe('2025-03-31T00:00:00.000Z');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(formatDateOnly(addDays(parseDateOnly('2025-01-31'), 1))).toBe('2025-02-01');
    expect(formatDateOnly(addDays(parseDateOnly('2025-01-01'), -1))).toBe('2024-12-31');
  });
});

describe('addMonthsClamped', () => {
  it('adds plain months', () => {
    expect(formatDateOnly(addMonthsClamped(parseDateOnly('2025-01-15'), 1))).toBe('2025-02-15');
    expect(formatDateOnly(addMonthsClamped(parseDateOnly('2025-01-15'), 18))).toBe('2026-07-15');
  });

  it('clamps day-of-month overflow instead of rolling over', () => {
    expect(formatDateOnly(addMonthsClamped(parseDateOnly('2025-01-31'), 1))).toBe('2025-02-28');
    expect(formatDateOnly(addMonthsClamped(parseDateOnly('2024-01-31'), 1))).toBe('2024-02-29');
    expect(formatDateOnly(addMonthsClamped(parseDateOnly('2025-03-31'), 1))).toBe('2025-04-30');
  });
});

describe('endOfUtcMonth', () => {
  it('returns the last day of the month', () => {
    expect(formatDateOnly(endOfUtcMonth(parseDateOnly('2025-02-01')))).toBe('2025-02-28');
    expect(formatDateOnly(endOfUtcMonth(parseDateOnly('2024-02-15')))).toBe('2024-02-29');
    expect(formatDateOnly(endOfUtcMonth(parseDateOnly('2025-12-31')))).toBe('2025-12-31');
  });
});
