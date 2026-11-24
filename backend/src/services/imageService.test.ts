import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { extractExifData, isValidImage, processImage } from './imageService';

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
});
