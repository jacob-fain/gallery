import sharp from 'sharp';
import exifReader from 'exif-reader';

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

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number; // bytes
}

export interface ProcessedImageSet {
  original: ProcessedImage;
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

/**
 * Process an uploaded image into three sizes:
 * - Original: Preserved EXACTLY as uploaded (no re-encoding, no quality loss)
 * - Web: Max 1920px wide, 92% quality with 4:4:4 chroma (for lightbox viewing)
 * - Thumbnail: Max 600px wide, 85% quality (for grid display)
 *
 * Web and thumbnail versions use high-quality JPEG encoding optimized for
 * photography with no chroma subsampling.
 *
 * @param buffer - Raw image buffer from upload
 * @returns Object containing all three processed versions with metadata
 */
export const processImage = async (buffer: Buffer): Promise<ProcessedImageSet> => {
  const metadata = await sharp(buffer).metadata();
  // EXIF orientations 5 to 8 rotate the picture a quarter turn, so the
  // displayed width is the stored height. Dimensions are recorded as
  // displayed, because the grid lays photos out from them.
  const quarterTurn = (metadata.orientation ?? 1) >= 5;
  const originalWidth = (quarterTurn ? metadata.height : metadata.width) || 0;
  const originalHeight = (quarterTurn ? metadata.width : metadata.height) || 0;

  // IMPORTANT: Keep original EXACTLY as uploaded - no re-encoding!
  // This preserves full quality for downloads and future use.
  // We just need the metadata, the buffer stays unchanged.

  // Process web version - resize if larger than max width
  // rotate() with no angle turns the pixels upright from the EXIF
  // orientation. WebP output drops EXIF, so without it phone and camera
  // portraits came out sideways.
  const webProcessed = await sharp(buffer)
    .rotate()
    .resize({
      width: IMAGE_SIZES.web.maxWidth,
      withoutEnlargement: true, // Don't upscale small images
      fit: 'inside',
    })
    .webp({
      quality: IMAGE_SIZES.web.quality,
      ...WEBP_OPTIONS,
    })
    .toBuffer({ resolveWithObject: true });

  // Process thumbnail
  const thumbnailProcessed = await sharp(buffer)
    .rotate()
    .resize({
      width: IMAGE_SIZES.thumbnail.maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({
      quality: IMAGE_SIZES.thumbnail.quality,
      ...WEBP_OPTIONS,
    })
    .toBuffer({ resolveWithObject: true });

  return {
    original: {
      buffer: buffer, // Keep original unchanged - no quality loss!
      width: originalWidth,
      height: originalHeight,
      size: buffer.length,
    },
    web: {
      buffer: webProcessed.data,
      width: webProcessed.info.width,
      height: webProcessed.info.height,
      size: webProcessed.info.size,
    },
    thumbnail: {
      buffer: thumbnailProcessed.data,
      width: thumbnailProcessed.info.width,
      height: thumbnailProcessed.info.height,
      size: thumbnailProcessed.info.size,
    },
  };
};

/**
 * Extract just the metadata from an image without processing
 * Useful for validation before full processing
 *
 * @param buffer - Raw image buffer
 * @returns Image dimensions and format info
 */
export const getImageMetadata = async (
  buffer: Buffer
): Promise<{ width: number; height: number; format: string }> => {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || 'unknown',
  };
};

/**
 * Validate that a buffer is a supported image format
 * @param buffer - Raw file buffer
 * @returns true if valid image, false otherwise
 */
export const isValidImage = async (buffer: Buffer): Promise<boolean> => {
  try {
    const metadata = await sharp(buffer).metadata();
    const supportedFormats = ['jpeg', 'png', 'webp', 'tiff', 'heif'];
    return supportedFormats.includes(metadata.format || '');
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
    const metadata = await sharp(buffer).metadata();

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
