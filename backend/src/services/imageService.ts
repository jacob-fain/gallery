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
  // Get original image metadata
  const metadata = await sharp(buffer).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;

  // IMPORTANT: Keep original EXACTLY as uploaded - no re-encoding!
  // This preserves full quality for downloads and future use.
  // We just need the metadata, the buffer stays unchanged.

  // Process web version - resize if larger than max width
  const webProcessed = await sharp(buffer)
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
    if (exif.Photo?.ISOSpeedRatings) {
      result.iso = exif.Photo.ISOSpeedRatings;
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
    if (exif.Photo?.DateTimeOriginal) {
      result.dateTaken = exif.Photo.DateTimeOriginal.toISOString();
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
