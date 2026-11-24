import sharp, { type Metadata, type OutputInfo } from 'sharp';
import exifReader from 'exif-reader';
import { originalFormatFor, type OriginalFormat } from './imageFormats';
import { HEIC_NOT_SUPPORTED } from '../config/upload';
import { Semaphore } from '../utils/semaphore';

// Image size configurations optimized for photography portfolio
// Using WebP for ~30% smaller files at equivalent visual quality
const IMAGE_SIZES = {
  web: {
    maxWidth: 1920,      // Full HD width for modern displays
    quality: 88,         // WebP 88% ≈ JPEG 92% visual quality
  },
  thumbnail: {
    maxWidth: 600,       // Larger thumbnails for retina displays
    quality: 82,         // WebP 82% ≈ JPEG 85% visual quality
  },
} as const;

// WebP options optimized for photography
const WEBP_OPTIONS = {
  effort: 4,  // Compression effort 0-6 (4 is good balance of speed/size)
} as const;

// libvips threads per image. Uploads are also limited to UPLOAD_SLOTS at a
// time, so sharp work never holds more than UPLOAD_SLOTS * this many cores.
sharp.concurrency(Math.min(2, sharp.concurrency()));
// Every upload is a different image, so libvips' operation cache only holds
// memory that is never reused.
sharp.cache(false);

/**
 * Uploads being decoded and encoded at once, process wide. More wait their
 * turn. Each one peaks at a few hundred MB for a large original, and the
 * server runs Postgres alongside (#79).
 */
export const UPLOAD_SLOTS = 2;
export const uploadSlots = new Semaphore(UPLOAD_SLOTS);

/**
 * Largest original accepted, in pixels, well below sharp's default of 268 MP.
 * A 100 MP medium format file fits. A PNG or TIFF gets no shrink on decode,
 * so this bounds the memory one upload can take; an image within the 50 MB
 * upload limit with more pixels than this is almost certainly crafted to
 * exhaust memory.
 */
export const MAX_INPUT_PIXELS = 120_000_000;

const SHARP_INPUT = { limitInputPixels: MAX_INPUT_PIXELS } as const;

/** The bytes are not an image in a format uploads accept. */
export class UnsupportedImageError extends Error {}

/**
 * HEIF with HEVC compression (an iPhone photo). Its header reads, but sharp's
 * prebuilt libvips has no HEVC decoder, so it would fail in processing (#131).
 * The upload filter refuses it by type and name; this catches one renamed.
 */
export class HeicNotSupportedError extends UnsupportedImageError {
  constructor() {
    super(HEIC_NOT_SUPPORTED);
  }
}

/** The image has more pixels than MAX_INPUT_PIXELS. */
export class ImageTooLargeError extends Error {}

export interface ImageInfo {
  format: OriginalFormat;
  /** As displayed, after EXIF orientation. */
  width: number;
  height: number;
  metadata: Metadata;
}

/**
 * Reads the image header once: the format, the displayed size, and the EXIF
 * block, for everything later steps need. Throws UnsupportedImageError or
 * ImageTooLargeError instead of decoding anything it should not.
 */
export const readImageInfo = async (buffer: Buffer): Promise<ImageInfo> => {
  let metadata: Metadata;
  try {
    // Reading the header decodes no pixels. With the limit on, sharp would
    // refuse an oversized image here with an error that reads as corruption,
    // so the size is checked below instead.
    metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
  } catch {
    throw new UnsupportedImageError('Not a readable image');
  }
  if (metadata.format === 'heif' && metadata.compression === 'hevc') throw new HeicNotSupportedError();
  const format = originalFormatFor(metadata.format, metadata.compression);
  if (!format || !metadata.width || !metadata.height) {
    throw new UnsupportedImageError(`Unsupported image format: ${metadata.format ?? 'unknown'}`);
  }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new ImageTooLargeError(`Image is larger than ${MAX_INPUT_PIXELS / 1_000_000} megapixels`);
  }
  // EXIF orientations 5 to 8 rotate the picture a quarter turn, so the
  // displayed width is the stored height. Dimensions are recorded as
  // displayed, because the grid lays photos out from them.
  const quarterTurn = (metadata.orientation ?? 1) >= 5;
  return {
    format,
    width: quarterTurn ? metadata.height : metadata.width,
    height: quarterTurn ? metadata.width : metadata.height,
    metadata,
  };
};

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number; // bytes
}

export interface ProcessedImageSet {
  original: ProcessedImage & { format: OriginalFormat };
  web: ProcessedImage;
  thumbnail: ProcessedImage;
}

export interface ExifData {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  iso?: number;
  aperture?: number;
  shutterSpeed?: number;
  focalLength?: number;
  // Camera wall-clock time, with OffsetTimeOriginal appended when recorded.
  dateTaken?: string;
}

const toProcessed = ({ data, info }: { data: Buffer; info: OutputInfo }): ProcessedImage => ({
  buffer: data,
  width: info.width,
  height: info.height,
  size: info.size,
});

/**
 * Process an uploaded image into three sizes:
 * - Original: the uploaded bytes, unchanged (no re-encoding, no quality loss)
 * - Web: at most 1920px wide, WebP (for lightbox viewing)
 * - Thumbnail: at most 600px wide, WebP (for grid display)
 *
 * Runs in an upload slot, so at most UPLOAD_SLOTS of these decode at once.
 *
 * @param buffer - Raw image buffer from upload
 * @param info - The buffer's readImageInfo, when the caller already has it
 */
export const processImage = async (buffer: Buffer, info?: ImageInfo): Promise<ProcessedImageSet> => {
  const image = info ?? (await readImageInfo(buffer));
  return uploadSlots.run(async () => {
    // The full-size image is decoded once, straight down to the web size
    // (JPEG shrinks while decoding), into uncompressed 8-bit sRGB. Both
    // derivatives are cut from that copy, so the thumbnail is neither a
    // second full decode nor a resize of an already lossy WebP.
    // rotate() with no angle turns the pixels upright from the EXIF
    // orientation. WebP output drops EXIF, so without it phone and camera
    // portraits came out sideways.
    const decoded = await sharp(buffer, SHARP_INPUT)
      .rotate()
      .resize({
        width: IMAGE_SIZES.web.maxWidth,
        withoutEnlargement: true, // Don't upscale small images
        fit: 'inside',
      })
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = decoded.info;
    const webSized = sharp(decoded.data, { raw: { width, height, channels } });

    const [web, thumbnail] = await Promise.all([
      webSized
        .clone()
        .webp({ quality: IMAGE_SIZES.web.quality, ...WEBP_OPTIONS })
        .toBuffer({ resolveWithObject: true }),
      webSized
        .clone()
        .resize({
          width: IMAGE_SIZES.thumbnail.maxWidth,
          withoutEnlargement: true,
          fit: 'inside',
        })
        .webp({ quality: IMAGE_SIZES.thumbnail.quality, ...WEBP_OPTIONS })
        .toBuffer({ resolveWithObject: true }),
    ]);

    return {
      original: {
        buffer, // Keep original unchanged - no quality loss!
        width: image.width,
        height: image.height,
        size: buffer.length,
        format: image.format,
      },
      web: toProcessed(web),
      thumbnail: toProcessed(thumbnail),
    };
  });
};

/**
 * Validate that a buffer is a supported image format
 * @param buffer - Raw file buffer
 * @returns true if valid image, false otherwise
 */
export const isValidImage = async (buffer: Buffer): Promise<boolean> => {
  try {
    await readImageInfo(buffer);
    return true;
  } catch {
    return false;
  }
};

/**
 * ISOSpeedRatings is a SHORT tag with a count, so some cameras write several
 * values (e.g. [100, 100]). The first is the ISO the photo was taken at.
 */
export const normalizeIso = (value: unknown): number | undefined => {
  const iso = Array.isArray(value) ? value[0] : value;
  return typeof iso === 'number' && Number.isFinite(iso) && iso > 0 ? iso : undefined;
};

/**
 * DateTimeOriginal is the camera's wall-clock time with no zone. exif-reader
 * returns it as a Date whose UTC fields hold that wall-clock time, so the
 * digits are read back in UTC. The result carries OffsetTimeOriginal when the
 * camera recorded one (a real instant), and otherwise no zone at all, so
 * nothing downstream mistakes it for UTC.
 */
export const formatDateTaken = (date: unknown, offset: unknown): string | undefined => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  const wallClock = date.toISOString().slice(0, 19);
  if (typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset.trim())) {
    return wallClock + offset.trim();
  }
  return wallClock;
};

/**
 * Extract EXIF metadata from an image buffer
 * Returns null if no EXIF data is present or parsing fails
 */
export const extractExifData = async (buffer: Buffer): Promise<ExifData | null> => {
  try {
    return exifFromMetadata(await sharp(buffer).metadata());
  } catch {
    return null;
  }
};

/** extractExifData for metadata already read, such as ImageInfo.metadata. */
export const exifFromMetadata = (metadata: Metadata): ExifData | null => {
  try {
    if (!metadata.exif) {
      return null;
    }

    const exif = exifReader(metadata.exif);
    const result: ExifData = {};

    // Camera info
    if (exif.Image?.Make) {
      result.cameraMake = exif.Image.Make;
    }
    if (exif.Image?.Model) {
      result.cameraModel = exif.Image.Model;
    }

    // Lens info
    if (exif.Photo?.LensModel) {
      result.lensModel = exif.Photo.LensModel;
    }

    // Exposure settings
    const iso = normalizeIso(exif.Photo?.ISOSpeedRatings);
    if (iso !== undefined) {
      result.iso = iso;
    }
    if (exif.Photo?.FNumber) {
      result.aperture = exif.Photo.FNumber;
    }
    if (exif.Photo?.ExposureTime) {
      result.shutterSpeed = exif.Photo.ExposureTime;
    }
    if (exif.Photo?.FocalLength) {
      result.focalLength = exif.Photo.FocalLength;
    }

    // Date taken
    const dateTaken = formatDateTaken(exif.Photo?.DateTimeOriginal, exif.Photo?.OffsetTimeOriginal);
    if (dateTaken) {
      result.dateTaken = dateTaken;
    }

    // Only return if we got at least some data
    if (Object.keys(result).length === 0) {
      return null;
    }

    return result;
  } catch {
    // EXIF parsing failed - not a critical error
    return null;
  }
};
