import sharp from 'sharp';

// Image size configurations
const IMAGE_SIZES = {
  web: {
    maxWidth: 1600,
    quality: 85,
  },
  thumbnail: {
    maxWidth: 400,
    quality: 80,
  },
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

/**
 * Process an uploaded image into three sizes:
 * - Original: Preserved as-is (converted to JPEG if needed)
 * - Web: Max 1600px wide, 85% quality (for lightbox viewing)
 * - Thumbnail: Max 400px wide, 80% quality (for grid display)
 *
 * All images maintain aspect ratio and are converted to JPEG.
 *
 * @param buffer - Raw image buffer from upload
 * @returns Object containing all three processed versions with metadata
 */
export const processImage = async (buffer: Buffer): Promise<ProcessedImageSet> => {
  // Get original image metadata
  const metadata = await sharp(buffer).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;

  // Process original - convert to JPEG, strip metadata for privacy
  const originalProcessed = await sharp(buffer)
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });

  // Process web version - resize if larger than max width
  const webProcessed = await sharp(buffer)
    .resize({
      width: IMAGE_SIZES.web.maxWidth,
      withoutEnlargement: true, // Don't upscale small images
      fit: 'inside',
    })
    .jpeg({ quality: IMAGE_SIZES.web.quality })
    .toBuffer({ resolveWithObject: true });

  // Process thumbnail
  const thumbnailProcessed = await sharp(buffer)
    .resize({
      width: IMAGE_SIZES.thumbnail.maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .jpeg({ quality: IMAGE_SIZES.thumbnail.quality })
    .toBuffer({ resolveWithObject: true });

  return {
    original: {
      buffer: originalProcessed.data,
      width: originalWidth,
      height: originalHeight,
      size: originalProcessed.info.size,
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
    const supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'heif'];
    return supportedFormats.includes(metadata.format || '');
  } catch {
    return false;
  }
};
