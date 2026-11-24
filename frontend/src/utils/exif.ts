/**
 * Formats an EXIF exposure time in seconds. Fractions of a second read as
 * 1/N only when N is (nearly) whole; slow speeds such as 0.8 s have no whole
 * reciprocal, and rounding one would show 0.8 s as "1/1s".
 */
export function formatShutterSpeed(speed: number): string {
  if (speed >= 1) {
    return `${Number(speed.toPrecision(3))}s`;
  }
  const reciprocal = 1 / speed;
  const whole = Math.round(reciprocal);
  if (Math.abs(reciprocal - whole) < 0.05) {
    return `1/${whole}s`;
  }
  return `${Number(speed.toPrecision(2))}s`;
}

/**
 * Photos uploaded before the parser normalized ISO can hold the raw
 * ISOSpeedRatings array (e.g. [100, 100]); the first value is the ISO.
 */
export function normalizeIso(iso: number | number[] | undefined): number | undefined {
  const value = Array.isArray(iso) ? iso[0] : iso;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * Formats dateTaken as the time on the camera's clock ("Jun 1, 2024, 2:30 PM"),
 * the same for every viewer. The leading digits are always that wall-clock
 * time: new uploads store it with the camera's offset or with no zone, and
 * older uploads store it with a "Z" that never meant UTC. Parsing the string
 * as a Date would shift it by the viewer's zone, so only the digits are read.
 */
export function formatDateTaken(dateTaken: string | undefined): string | undefined {
  const match = dateTaken ? WALL_CLOCK.exec(dateTaken) : null;
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
