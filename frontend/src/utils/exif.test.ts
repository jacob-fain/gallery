// These tests set process.env.TZ, so they need Node types, which the app
// tsconfig keeps out of browser code.
/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTaken, formatShutterSpeed, normalizeIso } from './exif';

describe('formatShutterSpeed', () => {
  it('shows slow speeds with no whole reciprocal as decimal seconds', () => {
    expect(formatShutterSpeed(0.8)).toBe('0.8s');
    expect(formatShutterSpeed(0.6)).toBe('0.6s');
    expect(formatShutterSpeed(0.4)).toBe('0.4s');
    expect(formatShutterSpeed(0.3)).toBe('0.3s');
  });

  it('shows speeds with a whole reciprocal as a fraction', () => {
    expect(formatShutterSpeed(1 / 125)).toBe('1/125s');
    expect(formatShutterSpeed(0.5)).toBe('1/2s');
    expect(formatShutterSpeed(0.25)).toBe('1/4s');
    expect(formatShutterSpeed(1 / 3)).toBe('1/3s');
    expect(formatShutterSpeed(0.333)).toBe('1/3s');
    expect(formatShutterSpeed(1 / 8000)).toBe('1/8000s');
  });

  it('shows a second or longer in seconds', () => {
    expect(formatShutterSpeed(1)).toBe('1s');
    expect(formatShutterSpeed(2.5)).toBe('2.5s');
    expect(formatShutterSpeed(30)).toBe('30s');
  });
});

describe('normalizeIso', () => {
  it('takes the first value of a stored array', () => {
    expect(normalizeIso([100, 100])).toBe(100);
  });

  it('passes a single value through', () => {
    expect(normalizeIso(400)).toBe(400);
  });

  it('drops missing or empty values', () => {
    expect(normalizeIso(undefined)).toBeUndefined();
    expect(normalizeIso([])).toBeUndefined();
    expect(normalizeIso(0)).toBeUndefined();
  });
});

describe('formatDateTaken', () => {
  // ICU versions differ on a plain or narrow no-break space before "PM".
  const shownAs = (value: string) => formatDateTaken(value)?.replace(/\s/g, ' ');
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it.each(['America/Los_Angeles', 'UTC', 'Asia/Tokyo'])(
    'shows the camera clock time in %s, whatever the stored form',
    (tz) => {
      process.env.TZ = tz;
      const shown = 'Jun 1, 2024, 2:30 PM';
      expect(shownAs('2024-06-01T14:30:00')).toBe(shown);
      expect(shownAs('2024-06-01T14:30:00+02:00')).toBe(shown);
      expect(shownAs('2024-06-01T14:30:00-07:00')).toBe(shown);
      // Uploads before the fix stored the wall-clock digits with a "Z".
      expect(shownAs('2024-06-01T14:30:00.000Z')).toBe(shown);
      expect(shownAs('2024-12-31T23:59:00.000Z')).toBe('Dec 31, 2024, 11:59 PM');
    }
  );

  it('returns undefined for a missing or malformed value', () => {
    expect(formatDateTaken(undefined)).toBeUndefined();
    expect(formatDateTaken('')).toBeUndefined();
    expect(formatDateTaken('June 1')).toBeUndefined();
  });
});
