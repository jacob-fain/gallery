/**
 * Formats a `YYYY-MM-DD` day key as "Nov 23". The key already names a
 * calendar day, so it is formatted in UTC, the zone `new Date()` parses a
 * date-only string in; formatting it in the browser's zone would show the
 * previous day anywhere west of UTC.
 */
export function formatDayLabel(day: string): string {
  return new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
