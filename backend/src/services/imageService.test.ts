import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { extractExifData, formatDateTaken, isValidImage, normalizeIso, processImage } from './imageService';

const image = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    [format]()
    .toBuffer();

describe('processImage', () => {
  it('keeps the original byte for byte and derives web and thumbnail WebP files', async () => {
    const original = await image(4000, 3000);
    const result = await processImage(original);

    expect(result.original.buffer.equals(original)).toBe(true);
    expect(result.original).toMatchObject({ width: 4000, height: 3000, size: original.length });

    const web = await sharp(result.web.buffer).metadata();
    expect(web).toMatchObject({ format: 'webp', width: 1920, height: 1440 });
    expect(result.web).toMatchObject({ width: 1920, height: 1440 });

    const thumb = await sharp(result.thumbnail.buffer).metadata();
    expect(thumb).toMatchObject({ format: 'webp', width: 600, height: 450 });
  });

  it('never enlarges an image smaller than a derived size', async () => {
    const result = await processImage(await image(800, 600));
    expect(result.web).toMatchObject({ width: 800, height: 600 });
    expect(result.thumbnail).toMatchObject({ width: 600, height: 450 });
  });

  it('strips metadata from the derived files', async () => {
    const withExif = await sharp(await image(1000, 750))
      .withExif({ IFD0: { Make: 'FUJIFILM', Model: 'X-T5' } })
      .jpeg()
      .toBuffer();
    const result = await processImage(withExif);
    expect((await sharp(result.web.buffer).metadata()).exif).toBeUndefined();
    expect((await sharp(result.thumbnail.buffer).metadata()).exif).toBeUndefined();
  });
});

describe('processImage orientation', () => {
  // 300x200 pixels stored, tagged "rotate 90 degrees clockwise" (EXIF 6), so
  // it displays as 200x300: how phones and many cameras save portraits.
  const sideways = () =>
    sharp({ create: { width: 300, height: 200, channels: 3, background: '#468' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

  it('records the displayed dimensions, not the stored ones', async () => {
    const result = await processImage(await sideways());
    expect(result.original).toMatchObject({ width: 200, height: 300 });
  });

  it('turns the derived files upright', async () => {
    const result = await processImage(await sideways());
    expect(result.web).toMatchObject({ width: 200, height: 300 });
    expect(result.thumbnail).toMatchObject({ width: 200, height: 300 });
    const web = await sharp(result.web.buffer).metadata();
    expect(web).toMatchObject({ width: 200, height: 300 });
    // WebP carries no orientation tag, so upright pixels are all a viewer has.
    expect(web.orientation).toBeUndefined();
  });

  it('keeps the original byte for byte, tag included', async () => {
    const input = await sideways();
    const result = await processImage(input);
    expect(result.original.buffer.equals(input)).toBe(true);
    expect((await sharp(result.original.buffer).metadata()).orientation).toBe(6);
  });
});

describe('isValidImage', () => {
  it('accepts the supported formats', async () => {
    expect(await isValidImage(await image(10, 10, 'jpeg'))).toBe(true);
    expect(await isValidImage(await image(10, 10, 'png'))).toBe(true);
    expect(await isValidImage(await image(10, 10, 'webp'))).toBe(true);
  });

  it('rejects bytes that are not an image and unsupported formats', async () => {
    expect(await isValidImage(Buffer.from('definitely not an image'))).toBe(false);
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    expect(await isValidImage(gif)).toBe(false);
  });
});

describe('extractExifData', () => {
  it('reads the camera make and model', async () => {
    const jpeg = await sharp(await image(100, 100))
      .withExif({ IFD0: { Make: 'FUJIFILM', Model: 'X-T5' } })
      .jpeg()
      .toBuffer();
    expect(await extractExifData(jpeg)).toMatchObject({ cameraMake: 'FUJIFILM', cameraModel: 'X-T5' });
  });

  it('returns null when there is no EXIF', async () => {
    expect(await extractExifData(await image(100, 100))).toBeNull();
  });

  const withDate = (exifIfd: Record<string, string>) =>
    image(100, 100).then((jpeg) =>
      sharp(jpeg).withExif({ IFD0: { Make: 'FUJIFILM' }, IFD2: exifIfd }).jpeg().toBuffer()
    );

  it('keeps the camera wall-clock time with no zone when no offset was recorded', async () => {
    const jpeg = await withDate({ DateTimeOriginal: '2024:06:01 14:30:00' });
    expect((await extractExifData(jpeg))?.dateTaken).toBe('2024-06-01T14:30:00');
  });

  it('attaches OffsetTimeOriginal when the camera recorded one', async () => {
    const jpeg = await withDate({ DateTimeOriginal: '2024:06:01 14:30:00', OffsetTimeOriginal: '+02:00' });
    const { dateTaken } = (await extractExifData(jpeg))!;
    expect(dateTaken).toBe('2024-06-01T14:30:00+02:00');
    expect(new Date(dateTaken!).toISOString()).toBe('2024-06-01T12:30:00.000Z');
  });

  it('reads the ISO', async () => {
    const jpeg = await withDate({ ISOSpeedRatings: '400' });
    expect(await extractExifData(jpeg)).toMatchObject({ iso: 400 });
  });
});

describe('normalizeIso', () => {
  it('takes the first value when the camera wrote several', () => {
    expect(normalizeIso([100, 100])).toBe(100);
    expect(normalizeIso([800])).toBe(800);
  });

  it('passes a single value through', () => {
    expect(normalizeIso(3200)).toBe(3200);
  });

  it('drops values that are not a positive number', () => {
    expect(normalizeIso(undefined)).toBeUndefined();
    expect(normalizeIso([])).toBeUndefined();
    expect(normalizeIso(0)).toBeUndefined();
    expect(normalizeIso('100')).toBeUndefined();
  });
});

describe('formatDateTaken', () => {
  // exif-reader builds DateTimeOriginal with Date.UTC from the wall-clock digits.
  const wallClock = new Date(Date.UTC(2024, 5, 1, 14, 30, 0));

  it('has no zone without an offset', () => {
    expect(formatDateTaken(wallClock, undefined)).toBe('2024-06-01T14:30:00');
  });

  it('appends a valid offset', () => {
    expect(formatDateTaken(wallClock, '-07:00')).toBe('2024-06-01T14:30:00-07:00');
    expect(formatDateTaken(wallClock, ' +05:30 ')).toBe('2024-06-01T14:30:00+05:30');
  });

  it('ignores an offset that is not +HH:MM', () => {
    expect(formatDateTaken(wallClock, '   :  ')).toBe('2024-06-01T14:30:00');
    expect(formatDateTaken(wallClock, 'Z')).toBe('2024-06-01T14:30:00');
  });

  it('drops a missing or unparseable date', () => {
    expect(formatDateTaken(null, '+02:00')).toBeUndefined();
    expect(formatDateTaken(new Date(NaN), undefined)).toBeUndefined();
  });
});
