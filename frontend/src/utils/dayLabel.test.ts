// These tests set process.env.TZ, so they need Node types, which the app
// tsconfig keeps out of browser code.
/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest';
import { formatDayLabel } from './dayLabel';

describe('formatDayLabel', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it.each(['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo'])(
    'shows the day the key names in %s',
    (tz) => {
      process.env.TZ = tz;
      expect(formatDayLabel('2026-11-23')).toBe('Nov 23');
      expect(formatDayLabel('2026-03-01')).toBe('Mar 1');
    }
  );
});
